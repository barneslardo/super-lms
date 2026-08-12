# Campus LMS (Okta demo)

Learning management demo that mirrors the [SIS demo](../sisDemo) stack and integrates with it via **Okta Cross App Access (ID-JAG)**.

## What it demonstrates

1. **OIDC login** — Students in the Okta **Students** group (`00gzd1cnuwCW6LvaV1d7`) sign in; the LMS JIT-provisions a local user.
2. **Cross App Access (LMS → SIS)** — After login, the LMS exchanges the user’s `id_token` for an ID-JAG, then a delegated SIS access token, and calls `GET /api/v1/students/me`.
3. **Content from course of study** — `enrolledClasses` / major from SIS drive generated modules and assignments.

## Stack

| Piece | Port | Public host |
|-------|------|-------------|
| API (`apps/api`) | `3041` | `https://lmsapi.skylarbarnes.com` |
| Web (`apps/web`) | `5174` | `https://superlms.skylarbarnes.com` |
| Postgres | `5440` | **not public** |

Same patterns as SIS: pnpm monorepo, Express + Passport session, React/Vite, Prisma.

> **Proxy check:** `lmsapi` must terminate on the **API (:3041)**. Port **5440** is Postgres only — do not point a public CNAME there.

## Production hosts (private_key_jwt)

Configured for:

| Env | Value |
|-----|--------|
| `APP_URL` | `https://superlms.skylarbarnes.com` |
| `API_PUBLIC_URL` | `https://lmsapi.skylarbarnes.com` |
| `OKTA_OIDC_REDIRECT_URI` | `https://lmsapi.skylarbarnes.com/auth/oidc/callback` |
| `OKTA_OIDC_AUTH_METHOD` | `private_key_jwt` |
| `OKTA_OIDC_PRIVATE_KEY_PATH` | `secrets/app-sign-on-key.json` |
| `SESSION_COOKIE_DOMAIN` | `.skylarbarnes.com` |

**Okta app (Client authentication = Public key / Private key):**

1. Ensure `OKTA_OIDC_CLIENT_ID` is set in `.env`.
2. Upload the public JWK from `secrets/app-sign-on-key.public.json` (or run the registrar below).
3. Sign-in redirect URI: `https://lmsapi.skylarbarnes.com/auth/oidc/callback`
4. Assign **Students** group; enable **groups** claim on the ID token.

```bash
# Requires OKTA_API_TOKEN in .env
python3 scripts/register_okta_oidc_jwk.py
```

**Reverse proxy:**

- `superlms.skylarbarnes.com` → `127.0.0.1:5174` (Vite) **or** a static build of `apps/web`
- `lmsapi.skylarbarnes.com` → `127.0.0.1:3041` (API)

If the UI is on Vite, keep same-origin `/auth` + `/api` proxying to `:3041` (already in `vite.config.ts`). Session cookies use `Domain=.skylarbarnes.com` so the OIDC callback on `lmsapi` still authenticates the UI on `superlms`.

For Cross App Access, also place `secrets/agent-private-key.json` (reuse SIS agent key) so ID-JAG can run.

## Quick start (local)

```bash
cd ~/lms
cp .env.example .env
# Fill OKTA_OIDC_* and optionally copy agent key from SIS:
#   cp ~/sisDemo/secrets/agent-private-key.json ~/lms/secrets/

docker compose up -d
pnpm install
pnpm --filter @lms/shared build
pnpm db:push
pnpm db:seed   # optional catalog seed
pnpm dev
```

- UI: http://localhost:5174  
- API health: http://localhost:3041/health  

**Dev login** is disabled when `NODE_ENV=production`. Use a non-production `NODE_ENV` locally if you need the Dev login form.

## Okta setup checklist

### 1. LMS OIDC web application

Create a new OIDC app in the same org as SIS (`sledai.oktapreview.com`):

- Grant type: Authorization Code + PKCE (+ Refresh / `offline_access`)
- Client authentication: **Public key / Private key** (`private_key_jwt`)
- Sign-in redirect: `https://lmsapi.skylarbarnes.com/auth/oidc/callback`
- Assign the **Students** group (and Enrollment Admins if you want admin persona)
- Enable a **groups** claim on the ID token (or set `OKTA_API_TOKEN` for Management API fallback)
- Set `OKTA_OIDC_CLIENT_ID` in `.env`; keep private JWK at `secrets/app-sign-on-key.json`
- Register public JWK: `python3 scripts/register_okta_oidc_jwk.py`

### 2. Agent / ID-JAG client (Cross App Access)

Reuse the SIS UD AI agent registration (or clone it):

- `AGENT_CLIENT_ID` / `OKTA_AGENT_REGISTRATION_ID` must **differ** from `OKTA_OIDC_CLIENT_ID`
- Place the agent private JWK at `secrets/agent-private-key.json` (same shape as SIS)
- `RESOURCE_AS_ISSUER` / `OKTA_ISSUER` = SIS custom AS, e.g.  
  `https://sledai.oktapreview.com/oauth2/auszblykhlQkrnOmA1d7`
- `AGENT_TOKEN_SCOPE` should include at least:  
  `sis.students.read.self sis.students.academic` (and `sis.students.read` if your policies require it)

The LMS OIDC app’s `id_token` is the **subject** of hop 1; the agent client signs both hops with `private_key_jwt`.

### 3. Point at SIS

```env
SIS_API_URL=https://sis-api.skylarbarnes.com
SIS_APP_URL=https://sis.skylarbarnes.com
```

SIS must be reachable and the user must exist there (same email / Okta subject) for `/students/me` to succeed.

## Demo walkthrough

1. Start SIS (`~/sisDemo`) and this LMS.
2. Sign in to LMS with a Students-group user (Okta or Dev login).
3. On the dashboard, confirm the **SIS profile** panel and course cards.
4. Click **Sync from SIS** to re-run ID-JAG → SIS fetch → content generation.
5. Open a course, mark modules/assignments complete.
6. Optional probes:  
   - `GET /auth/oidc/agent-status`  
   - `GET /auth/oidc/delegation-probe` (while signed in)

## Key API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/oidc/login` | Start Okta OIDC |
| GET | `/auth/me` | Session user |
| GET | `/api/v1/me` | Dashboard + SIS snapshot |
| GET | `/api/v1/courses` | Enrolled courses |
| GET | `/api/v1/courses/:id` | Modules + assignments |
| POST | `/api/v1/sync-from-sis` | ID-JAG sync + content |
| POST | `/api/v1/progress` | Mark module/assignment complete |

## Project layout

```
apps/api          Express API, OIDC, ID-JAG, content sync
apps/web          Student dashboard + course viewer
packages/shared   Groups, catalog, Zod types
docker-compose.yml  Postgres :5440
```
