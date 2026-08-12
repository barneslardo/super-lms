import { decodeJwt } from "jose";
import { config } from "../config.js";
import { signClientAssertion } from "./signing-key.js";

export function isAgentExchangeEnabled(): boolean {
  return config.agent.enabled;
}

function agentExchangeScopes(scope?: string): string {
  const raw = scope || config.agent.tokenScope;
  return raw
    .split(/\s+/)
    .filter((s) => s.startsWith("sis."))
    .join(" ");
}

export async function getIdJag(idToken: string, scope?: string): Promise<string> {
  const clientId = config.agent.clientId;
  const orgUrl = config.agent.orgUrl.replace(/\/$/, "");
  const tokenEndpoint = `${orgUrl}/oauth2/v1/token`;
  const audience = config.agent.resourceAsIssuer;

  const clientAssertion = await signClientAssertion({
    keyPath: config.agent.privateKeyPath,
    clientId,
    audience: tokenEndpoint,
  });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    audience,
    scope: agentExchangeScopes(scope),
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    errorSummary?: string;
  };
  if (!res.ok) {
    throw new Error(
      `ID-JAG exchange failed (${res.status}): ${data.error_description ?? data.errorSummary ?? data.error ?? JSON.stringify(data)}`
    );
  }
  if (!data.access_token) throw new Error("ID-JAG response missing access_token");
  return data.access_token;
}

export async function exchangeIdJagForAccessToken(idJag: string) {
  const clientId = config.agent.clientId;
  const issuer = config.agent.resourceAsIssuer.replace(/\/$/, "");
  const tokenEndpoint = `${issuer}/v1/token`;
  const clientAssertion = await signClientAssertion({
    keyPath: config.agent.privateKeyPath,
    clientId,
    audience: tokenEndpoint,
  });

  try {
    const claims = decodeJwt(idJag) as Record<string, unknown>;
    console.log(
      `[agent-exchange] hop2 id-jag aud=${claims.aud} iss=${claims.iss} sub=${claims.sub}`
    );
  } catch {
    /* ignore */
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: idJag,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
    errorSummary?: string;
  };
  if (!res.ok) {
    throw new Error(
      `Agent access token exchange failed (${res.status}): ${data.error_description ?? data.errorSummary ?? data.error ?? JSON.stringify(data)}`
    );
  }
  return data;
}

export async function getDelegatedAccessToken(idToken: string, scope?: string) {
  const idJag = await getIdJag(idToken, scope);
  return exchangeIdJagForAccessToken(idJag);
}
