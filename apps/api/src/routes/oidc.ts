import { randomUUID } from "node:crypto";
import { Router } from "express";
import { resolveOidcUserRole } from "@lms/shared";
import { config } from "../config.js";
import {
  isAgentExchangeEnabled,
  getIdJag,
  exchangeIdJagForAccessToken,
  getDelegatedAccessToken,
} from "../lib/agent-token-exchange.js";
import { idTokenExpiresAt, isIdTokenExpired, ensureFreshIdToken } from "../lib/session-id-token.js";
import {
  buildAuthUrl,
  exchangeCode,
  resolveOidcGroups,
  isOidcEnabled,
  makePkce,
  verifyIdToken,
} from "../lib/oidc.js";
import { sessionUserFromIdentity } from "../lib/auth-user.js";
import { upsertUserFromIdentity } from "../lib/user-provision.js";
import { AppError } from "../lib/errors.js";
import { fetchSisStudentMe } from "../lib/sis-client.js";
import { syncUserContentFromSis } from "../lib/content-sync.js";

export const oidcRouter = Router();

function loginRedirect(res: import("express").Response, code: string, message?: string) {
  const qs = new URLSearchParams({ error: code });
  if (message) qs.set("message", message);
  return res.redirect(`${config.appUrl}/login?${qs.toString()}`);
}

oidcRouter.get("/login", async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(503).json({ error: { code: "OIDC_DISABLED", message: "OIDC is not configured" } });
  }
  try {
    const state = randomUUID();
    const nonce = randomUUID();
    const pkce = makePkce();
    req.session.oidc = { state, nonce, verifier: pkce.verifier };
    req.session.returnTo =
      typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
        ? req.query.returnTo
        : "/";
    const url = await buildAuthUrl({ state, nonce, codeChallenge: pkce.challenge });
    res.redirect(url);
  } catch (err) {
    console.error("OIDC login error:", err);
    loginRedirect(res, "oidc_start_failed", err instanceof Error ? err.message : "Unknown error");
  }
});

oidcRouter.get("/callback", async (req, res) => {
  if (!isOidcEnabled()) {
    return loginRedirect(res, "oidc_disabled");
  }
  const { code, state, error, error_description } = req.query;
  if (error) {
    return loginRedirect(res, String(error), error_description ? String(error_description) : undefined);
  }
  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    return loginRedirect(res, "invalid_callback");
  }
  const pending = req.session.oidc;
  if (!pending || pending.state !== state) {
    return loginRedirect(res, "state_mismatch");
  }

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    if (!tokens.id_token) throw new Error("OIDC response missing id_token");
    const payload = await verifyIdToken(tokens.id_token, pending.nonce);
    const email =
      (typeof payload.email === "string" && payload.email) ||
      (typeof payload.preferred_username === "string" && payload.preferred_username) ||
      null;
    if (!email?.includes("@")) throw new Error("OIDC token missing email claim");

    const groups = await resolveOidcGroups(payload as Record<string, unknown>);
    const role = resolveOidcUserRole(email.toLowerCase(), groups);
    if (!role) {
      return loginRedirect(
        res,
        "not_authorized",
        "Your account must be in the Okta Students group (or an LMS admin group) to use this app."
      );
    }
    const oktaId = typeof payload.sub === "string" ? payload.sub : null;
    const name =
      typeof payload.name === "string"
        ? payload.name
        : [payload.given_name, payload.family_name].filter(Boolean).join(" ") || email;

    const user = await upsertUserFromIdentity({
      email: email.toLowerCase(),
      oktaId,
      role,
      firstName: typeof payload.given_name === "string" ? payload.given_name : undefined,
      lastName: typeof payload.family_name === "string" ? payload.family_name : undefined,
    });

    delete req.session.oidc;
    const returnTo = req.session.returnTo || "/";
    delete req.session.returnTo;

    const sessionUser = sessionUserFromIdentity({
      id: user.id,
      email: user.email,
      role: user.role,
      oktaId: user.oktaId,
      name,
      firstName: typeof payload.given_name === "string" ? payload.given_name : undefined,
      lastName: typeof payload.family_name === "string" ? payload.family_name : undefined,
      groups,
    });

    await new Promise<void>((resolve, reject) => {
      req.login(sessionUser, (err) => (err ? reject(err) : resolve()));
    });
    req.session.idToken = tokens.id_token;
    if (typeof tokens.refresh_token === "string") {
      req.session.refreshToken = tokens.refresh_token;
    }
    req.session.authMethod = "oidc";
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    // Best-effort JIT content sync via Cross App Access (non-blocking for login success)
    if (isAgentExchangeEnabled() && role === "student") {
      try {
        const profile = await fetchSisStudentMe(tokens.id_token);
        await syncUserContentFromSis(user.id, profile);
      } catch (err) {
        console.warn(
          "[oidc] post-login SIS sync failed:",
          err instanceof Error ? err.message : err
        );
      }
    }

    const dest =
      returnTo && returnTo !== "/" && returnTo.startsWith("/") ? returnTo : "/";
    res.redirect(`${config.appUrl}${dest}`);
  } catch (err) {
    console.error("OIDC callback error:", err);
    loginRedirect(res, "oidc_callback_failed", err instanceof Error ? err.message : undefined);
  }
});

oidcRouter.get("/agent-status", (req, res) => {
  const idToken = req.session?.idToken;
  const exp = idToken ? idTokenExpiresAt(idToken) : null;
  res.json({
    data: {
      agentExchangeEnabled: isAgentExchangeEnabled(),
      hasIdToken: Boolean(idToken),
      idTokenExpired: idToken ? isIdTokenExpired(idToken) : null,
      idTokenExpiresAt: exp ? new Date(exp * 1000).toISOString() : null,
      hasRefreshToken: Boolean(req.session?.refreshToken),
      authMethod: req.session?.authMethod ?? null,
      oidcAppClientId: config.oidc.clientId || null,
      agentRegistrationId: config.agent.registrationId || null,
      agentClientId: config.agent.clientId || null,
      resourceAuthorizationServer: config.agent.resourceAsIssuer || null,
      sisApiUrl: config.sisApiUrl,
    },
  });
});

oidcRouter.get("/delegation-probe", async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Sign in required");
    }
    if (!isAgentExchangeEnabled()) {
      throw new AppError(503, "AGENT_DISABLED", "Agent exchange not configured");
    }
    const idToken = await ensureFreshIdToken(req);
    let hop1: Record<string, unknown> = { ok: false };
    let hop2: Record<string, unknown> = { ok: false };
    try {
      const idJag = await getIdJag(idToken);
      hop1 = { ok: true, idJagLength: idJag.length };
      try {
        const token = await exchangeIdJagForAccessToken(idJag);
        hop2 = { ok: true, scope: token.scope, expiresIn: token.expires_in };
      } catch (err) {
        hop2 = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    } catch (err) {
      hop1 = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    res.json({ data: { hop1, hop2 } });
  } catch (err) {
    next(err);
  }
});

oidcRouter.post("/agent-token", async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Sign in required");
    }
    if (!isAgentExchangeEnabled()) {
      throw new AppError(503, "AGENT_DISABLED", "Agent token exchange is not configured");
    }
    const idToken = await ensureFreshIdToken(req);
    const scope = typeof req.body?.scope === "string" ? req.body.scope : undefined;
    const delegated = await getDelegatedAccessToken(idToken, scope);
    res.json({
      data: {
        scope: delegated.scope,
        expiresIn: delegated.expires_in,
        tokenType: delegated.token_type,
      },
    });
  } catch (err) {
    next(err);
  }
});
