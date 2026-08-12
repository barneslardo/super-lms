import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SisOAuthScopes } from "@lms/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath, override: true });

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function resolveOktaOrgUrl(): string {
  const explicit = optional("OKTA_ORG_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  if (optional("OKTA_ISSUER")) {
    try {
      return new URL(optional("OKTA_ISSUER")).origin;
    } catch {
      /* fall through */
    }
  }
  return "";
}

const oktaOrgUrl = resolveOktaOrgUrl();
const oidcClientId = optional("OKTA_OIDC_CLIENT_ID");
const oidcRedirectUri =
  optional("OKTA_OIDC_REDIRECT_URI") ||
  `${optional("API_PUBLIC_URL", "http://localhost:3041").replace(/\/$/, "")}/auth/oidc/callback`;

const agentRegistrationId = optional("OKTA_AGENT_REGISTRATION_ID");
const agentClientId = optional("AGENT_CLIENT_ID") || agentRegistrationId;
const defaultAgentScopes = [
  SisOAuthScopes.STUDENTS_READ_SELF,
  SisOAuthScopes.STUDENTS_ACADEMIC,
  SisOAuthScopes.STUDENTS_READ,
].join(" ");

function resolveKeyPath(raw: string, fallback: string): string {
  const value = raw || fallback;
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(envPath), value);
}

const agentKeyPath = resolveKeyPath(
  optional("AGENT_PRIVATE_KEY_PATH"),
  "secrets/agent-private-key.json"
);
const oidcKeyPath = resolveKeyPath(
  optional("OKTA_OIDC_PRIVATE_KEY_PATH"),
  "secrets/app-sign-on-key.json"
);
const agentKeyOnDisk = fs.existsSync(agentKeyPath);
const oidcKeyOnDisk = fs.existsSync(oidcKeyPath);
const resourceAsIssuer = optional("RESOURCE_AS_ISSUER") || optional("OKTA_ISSUER");

function resolveOidcTokenAuthMethod(): "private_key_jwt" | "client_secret" {
  const explicit = optional("OKTA_OIDC_AUTH_METHOD").toLowerCase();
  if (explicit === "private_key_jwt" || explicit === "client_secret") {
    return explicit;
  }
  if (oidcKeyOnDisk && oidcClientId) {
    return "private_key_jwt";
  }
  return "client_secret";
}

const oidcTokenAuthMethod = resolveOidcTokenAuthMethod();

export const config = {
  port: parseInt(process.env.API_PORT ?? "3041", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: optional("APP_URL", "http://localhost:5174"),
  apiPublicUrl: optional("API_PUBLIC_URL", "http://localhost:3041"),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5174")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  sessionSecret: optional("SESSION_SECRET", "dev-session-secret-change-me"),
  sessionCookieDomain: optional("SESSION_COOKIE_DOMAIN"),
  databaseUrl: optional("DATABASE_URL", "postgresql://lms:lms@localhost:5440/lms_demo"),
  trustProxy: process.env.TRUST_PROXY !== "false",
  sisApiUrl: optional("SIS_API_URL", "http://127.0.0.1:3010").replace(/\/$/, ""),
  sisAppUrl: optional("SIS_APP_URL", "http://localhost:5173").replace(/\/$/, ""),
  oktaApiToken: optional("OKTA_API_TOKEN").trim().replace(/^SSWS\s+/i, ""),

  oidc: {
    orgUrl: oktaOrgUrl,
    issuer: optional("OKTA_ISSUER") || oktaOrgUrl,
    clientId: oidcClientId,
    clientSecret: optional("OKTA_OIDC_CLIENT_SECRET"),
    redirectUri: oidcRedirectUri,
    scopes: optional("OIDC_SCOPES", "openid profile email groups offline_access"),
    tokenAuthMethod: oidcTokenAuthMethod,
    privateKeyPath: oidcKeyOnDisk ? oidcKeyPath : "",
    enabled: Boolean(oidcClientId && oidcRedirectUri && oktaOrgUrl),
  },

  agent: {
    orgUrl: oktaOrgUrl,
    clientId: agentClientId,
    registrationId: agentRegistrationId,
    privateKeyPath: agentKeyPath,
    resourceAsIssuer,
    tokenScope: optional("AGENT_TOKEN_SCOPE", defaultAgentScopes),
    enabled: Boolean(
      agentClientId &&
        agentClientId !== oidcClientId &&
        resourceAsIssuer.includes("/oauth2/aus") &&
        oktaOrgUrl &&
        agentKeyOnDisk
    ),
  },

  studyChat: {
    apiKey: optional("XAI_API_KEY"),
    model: optional("XAI_MODEL", "grok-4.3"),
    enabled: Boolean(optional("XAI_API_KEY")),
  },
};

export function isProduction(): boolean {
  return config.nodeEnv === "production";
}
