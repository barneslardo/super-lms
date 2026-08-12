import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let cachedMeta: OidcDiscovery | null = null;

export function isOidcEnabled(): boolean {
  return config.oidc.enabled;
}

async function discovery(): Promise<OidcDiscovery> {
  if (cachedMeta) return cachedMeta;
  const issuerUrl = config.oidc.issuer.replace(/\/$/, "");
  try {
    const res = await fetch(`${issuerUrl}/.well-known/openid-configuration`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
    cachedMeta = (await res.json()) as OidcDiscovery;
    return cachedMeta;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[oidc] discovery fetch failed (${message}); using Okta issuer defaults`);
    cachedMeta = {
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/v1/authorize`,
      token_endpoint: `${issuerUrl}/v1/token`,
      jwks_uri: `${issuerUrl}/v1/keys`,
    };
    return cachedMeta;
  }
}

export function makePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function buildAuthUrl(opts: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<string> {
  const meta = await discovery();
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("client_id", config.oidc.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", config.oidc.scopes);
  u.searchParams.set("redirect_uri", config.oidc.redirectUri);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("nonce", opts.nonce);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function attachClientAuth(body: URLSearchParams, tokenEndpoint: string) {
  body.set("client_id", config.oidc.clientId);
  if (config.oidc.tokenAuthMethod === "private_key_jwt") {
    const { signClientAssertion } = await import("./signing-key.js");
    body.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    );
    body.set(
      "client_assertion",
      await signClientAssertion({
        keyPath: config.oidc.privateKeyPath,
        clientId: config.oidc.clientId,
        audience: tokenEndpoint,
      })
    );
  } else if (config.oidc.clientSecret) {
    body.set("client_secret", config.oidc.clientSecret);
  } else {
    throw new Error(
      "OIDC token exchange needs OKTA_OIDC_CLIENT_SECRET or private_key_jwt"
    );
  }
}

export async function exchangeCode(code: string, codeVerifier: string) {
  const meta = await discovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oidc.redirectUri,
    code_verifier: codeVerifier,
  });
  await attachClientAuth(body, meta.token_endpoint);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`OIDC code exchange failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export async function refreshOidcTokens(refreshToken: string) {
  const meta = await discovery();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  await attachClientAuth(body, meta.token_endpoint);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`OIDC refresh failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export async function verifyIdToken(idToken: string, expectedNonce: string) {
  const meta = await discovery();
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: meta.issuer,
    audience: config.oidc.clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("OIDC nonce mismatch");
  return payload;
}

export function extractGroupsFromClaims(payload: Record<string, unknown>): string[] {
  const candidates = [
    payload.groups,
    payload["https://okta.com/groups"],
    payload.group,
  ];
  const out = new Set<string>();
  for (const raw of candidates) {
    if (Array.isArray(raw)) {
      for (const g of raw) out.add(String(g));
    } else if (typeof raw === "string" && raw.trim()) {
      out.add(raw.trim());
    }
  }
  return [...out];
}

async function listOktaUserGroups(oktaUserId: string): Promise<string[]> {
  if (!config.oktaApiToken || !config.oidc.orgUrl) return [];
  const orgUrl = config.oidc.orgUrl.replace(/\/$/, "");
  const res = await fetch(`${orgUrl}/api/v1/users/${encodeURIComponent(oktaUserId)}/groups`, {
    headers: {
      Authorization: `SSWS ${config.oktaApiToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];
  const groups = (await res.json()) as Array<{ id?: string; profile?: { name?: string } }>;
  const tokens: string[] = [];
  for (const g of groups) {
    if (g.id) tokens.push(g.id);
    if (g.profile?.name) tokens.push(g.profile.name);
  }
  return tokens;
}

/** Resolve Okta groups from id_token claims, with optional Management API fallback. */
export async function resolveOidcGroups(payload: Record<string, unknown>): Promise<string[]> {
  const fromClaims = extractGroupsFromClaims(payload);
  if (fromClaims.length) return fromClaims;

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (sub && config.oktaApiToken) {
    try {
      const fromApi = await listOktaUserGroups(sub);
      if (fromApi.length) {
        console.log(
          `[oidc] groups claim missing; resolved ${fromApi.length} group(s) via Okta API for sub=${sub}`
        );
        return fromApi;
      }
    } catch (err) {
      console.warn("[oidc] Okta group lookup failed:", err instanceof Error ? err.message : err);
    }
  }
  return [];
}
