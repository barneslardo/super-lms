# README-AGENT.md — Super LMS setup guide for AI agents

You are an AI coding agent helping an engineer spin up this repo. This file is your operational runbook; [README.md](README.md) has full feature docs. Follow the phases in order and run every verification.

## What this is

A demo **Campus LMS** that mirrors the [sis-demo](https://github.com/barneslardo/sis-demo) stack: pnpm monorepo, Express API (`apps/api`, port **3041**), React/Vite web UI (`apps/web`, port **5174**), Postgres in Docker (host port **5440**). Its headline feature is **Okta Cross App Access (ID-JAG)**: after a student signs in, the LMS exchanges their `id_token` for a delegated SIS access token and pulls their SIS profile/courses to generate LMS content.

**Dependency:** basic LMS (login, courses, progress) runs standalone. The Cross App Access features require a running **sis-demo** with its custom authorization server configured — set that repo up first if the engineer wants the full demo. Both repos are designed for the **same Okta org**.

## Ground rules for agents

1. **Never commit** `.env` or private keys in `secrets/`. The two `secrets/*.public.json` files in the repo are public JWK halves and are intentionally tracked; their private counterparts are not.
2. **All `skylarbarnes.com` / `sledai.oktapreview.com` values are the original author's deployment** — substitute your engineer's values (table below). The Students group ID in README.md (`00gzd1cnuwCW6LvaV1d7`) is from the author's org; use your own group's ID.
3. **Ask your engineer for:** Okta org URL + admin access, an Okta API token (SSWS) if using the JWK registration script, an xAI API key only if they want the Study Helper chatbot, public DNS names if deploying.
4. Steps marked **[HUMAN]** happen in the Okta Admin Console.
5. Admin access in the app is partly gated by `HARDCODED_ADMIN_EMAILS` in `packages/shared/src/index.ts` — add your engineer's email there if they need the admin persona.

### Value substitution table

| Placeholder | Replace with |
|---|---|
| `https://superlms.skylarbarnes.com` | Your web UI public URL (`APP_URL`) — local: `http://localhost:5174` |
| `https://lmsapi.skylarbarnes.com` | Your API public URL (`API_PUBLIC_URL`) — local: `http://localhost:3041` |
| `https://sis.skylarbarnes.com` / `https://sis-api.skylarbarnes.com` | Your sis-demo web/API URLs (`SIS_APP_URL` / `SIS_API_URL`) |
| `https://sledai.oktapreview.com` | Your Okta org URL |
| `auszblykhlQkrnOmA1d7`, `wlpzfntwqat4SXBba1d7`, `00g…` IDs | Your org's SIS custom-AS ID, agent client ID, group IDs |

## Phase 0 — Prerequisites

```bash
node --version   # need 20+
pnpm --version   # need 10+
docker ps        # daemon running
```

Ports to be free: `3041` (API), `5174` (web), `5440` (Postgres). Note these deliberately differ from sis-demo's (3010/5173/5437) so both stacks run side by side.

## Phase 1 — Run locally, no Okta required

Dev login is available whenever `NODE_ENV` is not `production`.

```bash
cp .env.example .env
```

Minimal local `.env` (comment out the rest; do NOT set `SESSION_COOKIE_DOMAIN` on localhost):

```env
DATABASE_URL=postgresql://lms:lms@localhost:5440/lms_demo
APP_URL=http://localhost:5174
API_PUBLIC_URL=http://localhost:3041
CORS_ORIGIN=http://localhost:5174
SESSION_SECRET=<generate: openssl rand -hex 32>
API_PORT=3041
NODE_ENV=development
# Point at your local sis-demo if running it:
SIS_API_URL=http://localhost:3010
SIS_APP_URL=http://localhost:5173
```

Then (order matters — build `shared` before Prisma/dev):

```bash
docker compose up -d
pnpm install
pnpm --filter @lms/shared build
pnpm db:push
pnpm db:seed        # optional course catalog
pnpm dev            # API :3041 + web :5174
```

**Verify:**
1. `curl -s http://localhost:3041/health` returns ok.
2. Open `http://localhost:5174`, sign in via the dev login form (posts to `/auth/dev/login`).
3. Dashboard renders with course cards.

## Phase 2 — Okta wiring

### 2a. LMS OIDC app (`private_key_jwt` — no client secret)

This app authenticates to Okta with a **private key**, not a client secret.

1. Generate the sign-on key (repo ships only the author's public halves — generate your own):

   ```bash
   cd apps/api   # jose is installed here
   node --input-type=module -e "
   import { generateKeyPair, exportJWK } from 'jose';
   import { randomUUID } from 'node:crypto';
   const { privateKey } = await generateKeyPair('RS256', { extractable: true });
   const jwk = await exportJWK(privateKey);
   jwk.kid = randomUUID(); jwk.use = 'sig'; jwk.alg = 'RS256';
   console.log(JSON.stringify(jwk, null, 2));
   " > ../../secrets/app-sign-on-key.json
   chmod 600 ../../secrets/app-sign-on-key.json
   ```

2. **[HUMAN]** Okta: Applications → Create App Integration → OIDC Web App. Grant types: Authorization Code (+ Refresh Token). **Client authentication: Public key / Private key.** Sign-in redirect URI: `<API_PUBLIC_URL>/auth/oidc/callback`. Create/assign a **Students** group; enable a **groups** claim on the ID token.
3. Set `OKTA_OIDC_CLIENT_ID`, `OKTA_ORG_URL`, `OKTA_OIDC_AUTH_METHOD=private_key_jwt`, `OKTA_OIDC_REDIRECT_URI` in `.env`.
4. Upload the public JWK: either **[HUMAN]** paste it in the app's Client Credentials section, or run `python3 scripts/register_okta_oidc_jwk.py` (reads `.env`; needs `OKTA_API_TOKEN`).
5. **Verify:** `GET <API_PUBLIC_URL>/auth/oidc/login` completes a login for a Students-group user.

### 2b. Cross App Access into SIS (the headline demo)

Prereqs: sis-demo running with its custom AS + agent registration done (sis-demo README-AGENT Phase 2b/2c/2e), and the LMS user exists in SIS with the same email/Okta subject.

1. Copy the **same agent private key** used by sis-demo: `cp ../sis-demo/secrets/agent-private-key.json secrets/`.
2. Set in `.env`: `AGENT_CLIENT_ID` + `OKTA_AGENT_REGISTRATION_ID` (your org's agent registration — must **differ** from `OKTA_OIDC_CLIENT_ID`), `OKTA_ISSUER` + `RESOURCE_AS_ISSUER` = your SIS custom AS issuer, `AGENT_TOKEN_SCOPE=sis.students.read.self sis.students.academic`.
3. **Verify:** while signed in, `GET /auth/oidc/agent-status` then `GET /auth/oidc/delegation-probe` succeed; dashboard **Sync from SIS** populates the SIS profile panel. The probe response shows each hop (id_token → ID-JAG → delegated SIS token) — use it to localize failures.

### 2c. Study Helper chatbot (optional)

Set `XAI_API_KEY` (from the engineer). Model via `XAI_MODEL`.

## Phase 3 — Deploying (EC2 or similar)

Same pattern as sis-demo: reverse proxy in front, security group exposes only 80/443, never expose 5440 or raw app ports. Two hostnames — UI host → `127.0.0.1:5174` (or serve a static `pnpm build` of `apps/web`), API host → `127.0.0.1:3041`. Set `SESSION_COOKIE_DOMAIN` to the shared parent domain (OIDC callback lands on the API host; the UI host must read the session). Production `.env`: real `https://` URLs, `NODE_ENV=production` (disables dev login), `TRUST_PROXY=true`. If the Vite dev server serves the UI publicly, its `allowedHosts` in `apps/web/vite.config.ts` currently lists the author's hostnames — add your own.

No PM2 scripts in this repo (unlike sis-demo) — run under your own process manager (pm2/systemd), e.g. `pm2 start "pnpm dev:api" --name lms-api` plus a static file server for the built web app.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `@lms/shared` type errors on first run | Build order — run `pnpm --filter @lms/shared build` before `pnpm dev`/`db:push`. |
| OIDC login fails with client-auth error | Public JWK not registered on the app, or auth method not set to Public key/Private key. Re-run `scripts/register_okta_oidc_jwk.py`. |
| `delegation-probe` fails at hop 1 | Signed in via dev login (no `id_token`) — use Okta OIDC login; or agent client ID equals the OIDC client ID (they must differ). |
| `delegation-probe` fails at hop 2 | SIS custom AS missing the jwt-bearer access-policy rule / scopes — finish sis-demo Phase 2b, check `RESOURCE_AS_ISSUER`. |
| `/students/me` 404 from SIS | User doesn't exist in SIS with the same email — create the student there first. |
| UI 403/blocked on a public host | Add the hostname to `allowedHosts` in `apps/web/vite.config.ts` (or serve the static build instead). |

## File map (orientation)

```
apps/api/src/lib/agent-token-exchange.ts  ID-JAG hop 1 + 2
apps/api/src/lib/sis-client.ts            delegated SIS API calls
apps/api/src/lib/content-sync.ts          SIS courses → LMS modules/assignments
apps/api/src/routes/oidc.ts               OIDC login, agent-status, delegation-probe
packages/shared/src/index.ts              groups, scopes, HARDCODED_ADMIN_EMAILS
scripts/register_okta_oidc_jwk.py         uploads public JWK, sets private_key_jwt
```
