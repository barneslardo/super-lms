import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, apiUrl } from "../api";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authError = searchParams.get("error");
  const authMessage = searchParams.get("message");
  const [email, setEmail] = useState("alice.johnson@university.edu");
  const [persona, setPersona] = useState("student");
  const [error, setError] = useState("");

  const { data: authConfig } = useQuery({
    queryKey: ["auth", "config"],
    queryFn: api.getAuthConfig,
    retry: false,
  });

  const oidcEnabled = authConfig?.data.oidc ?? false;
  const isDev = import.meta.env.DEV;

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.devLogin(email, persona);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-landing">
      <section className="login-hero" aria-label="Campus LMS">
        <div className="login-hero-glow" />
        <div className="login-hero-content">
          <p className="eyebrow">Campus LMS</p>
          <h1>Learn with your SIS enrollment</h1>
          <p>
            Sign in with Okta. Students in the Students group are provisioned on first login; course
            content is generated from your SIS academic record via Cross App Access.
          </p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="subtitle">Use your university Okta account.</p>

          {authError && (
            <div className="error" style={{ marginBottom: "1rem" }}>
              Sign-in failed ({authError}
              {authMessage ? `): ${authMessage}` : ")"}
            </div>
          )}

          <div className="login-options">
            {oidcEnabled ? (
              <a className="btn btn-primary btn-wide" href={apiUrl("/auth/oidc/login?returnTo=/")}>
                Sign in with Okta
              </a>
            ) : (
              <p className="login-hint">Okta OIDC is not configured yet. Use dev login below.</p>
            )}

            {isDev && (
              <>
                <div className="login-divider">or dev login</div>
                <form className="dev-login-form" onSubmit={handleDevLogin}>
                  <label>
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Persona
                    <select value={persona} onChange={(e) => setPersona(e.target.value)}>
                      <option value="student">Student (Students group)</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  {error && <div className="error">{error}</div>}
                  <button type="submit" className="btn btn-secondary btn-wide">
                    Dev login
                  </button>
                </form>
                <p className="login-hint">
                  Dev seeds CS101 / MATH201 / ENG102 from a mock SIS profile when Cross App Access
                  keys are not present.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
