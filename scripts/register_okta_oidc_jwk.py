#!/usr/bin/env python3
"""Register LMS OIDC public JWK on the Okta app and set private_key_jwt auth."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        out[k.strip()] = v
    return out


def public_jwk(private: dict) -> dict:
    pub = {k: private[k] for k in ("kty", "use", "kid", "n", "e", "alg") if k in private}
    if "alg" not in pub:
        pub["alg"] = "RS256"
    if "use" not in pub:
        pub["use"] = "sig"
    return pub


def api(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"SSWS {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    env = load_env(repo / ".env")
    org = env.get("OKTA_ORG_URL", "").rstrip("/")
    token = env.get("OKTA_API_TOKEN", "").strip()
    app_id = env.get("OKTA_OIDC_CLIENT_ID", "").strip()
    key_path = repo / env.get("OKTA_OIDC_PRIVATE_KEY_PATH", "secrets/app-sign-on-key.json")

    if not org or not token or not app_id:
        sys.exit("Missing OKTA_ORG_URL, OKTA_API_TOKEN, or OKTA_OIDC_CLIENT_ID in .env")
    if not key_path.is_file():
        sys.exit(f"Missing private key at {key_path}")

    private = json.loads(key_path.read_text())
    pub = public_jwk(private)
    print(f"OIDC app: {app_id}  kid: {pub.get('kid')}")

    status, listed = api("GET", f"{org}/api/v1/apps/{app_id}/credentials/jwks", token)
    if status == 200:
        keys = listed.get("keys", [])
        for k in keys:
            if k.get("kid") == pub.get("kid"):
                print("Public key already registered in Okta.")
                break
        else:
            status, created = api(
                "POST", f"{org}/api/v1/apps/{app_id}/credentials/jwks", token, pub
            )
            if status not in (200, 201):
                print(f"Add JWK failed ({status}):", json.dumps(created, indent=2))
                sys.exit(1)
            print("Registered public JWK in Okta.")
    else:
        print(f"List JWKS failed ({status}):", listed)
        sys.exit(1)

    patch = {
        "credentials": {
            "oauthClient": {
                "token_endpoint_auth_method": "private_key_jwt",
            }
        }
    }
    status, updated = api("PATCH", f"{org}/api/v1/apps/{app_id}", token, patch)
    if status != 200:
        print(f"PATCH app auth method failed ({status}):", json.dumps(updated, indent=2))
        print("Set Client authentication to Public key / Private key manually in Admin Console.")
    else:
        auth = (
            updated.get("credentials", {})
            .get("oauthClient", {})
            .get("token_endpoint_auth_method")
        )
        print(f"App token_endpoint_auth_method: {auth}")

    print("Also set Sign-in redirect URI to:")
    print(" ", env.get("OKTA_OIDC_REDIRECT_URI", "https://lmsapi.skylarbarnes.com/auth/oidc/callback"))


if __name__ == "__main__":
    main()
