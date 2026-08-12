import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.getDashboard });
  const courses = useQuery({ queryKey: ["courses"], queryFn: api.getCourses });

  const sync = useMutation({
    mutationFn: api.syncFromSis,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  if (dash.isLoading || courses.isLoading) {
    return <div className="loading-screen">Loading dashboard…</div>;
  }

  if (dash.isError || !dash.data) {
    return <div className="error-banner">Could not load dashboard.</div>;
  }

  const me = dash.data.data;
  const list = courses.data?.data ?? [];

  return (
    <div className="dashboard">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Your learning path</p>
          <h1>Welcome, {me.user.displayName}</h1>
          <p className="lede">
            Courses below were generated from your SIS academic record
            {me.sis?.major ? ` (${me.sis.major})` : ""} using Okta Cross App Access.
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? "Syncing…" : "Sync from SIS"}
          </button>
          <a className="btn btn-secondary" href={me.sisAppUrl} target="_blank" rel="noreferrer">
            Open SIS profile
          </a>
        </div>
      </section>

      {sync.isError && (
        <div className="error-banner">{(sync.error as Error).message}</div>
      )}
      {sync.isSuccess && (
        <div className="success-banner">
          Synced {sync.data.data.courseCount} course(s) via {sync.data.data.source}
          {sync.data.data.major ? ` · major ${sync.data.data.major}` : ""}.
        </div>
      )}

      <div className="dashboard-grid">
        <section className="panel">
          <header className="panel-header">
            <h2>Your courses</h2>
            <span className="muted">{list.length} enrolled</span>
          </header>
          {list.length === 0 ? (
            <p className="empty">
              No courses yet. Click <strong>Sync from SIS</strong> to pull enrollment via Cross App
              Access (or use Dev login to seed a mock roster).
            </p>
          ) : (
            <ul className="course-list">
              {list.map((c) => (
                <li key={c.id}>
                  <Link to={`/courses/${c.id}`} className="course-row">
                    <div>
                      <span className="course-code">{c.code}</span>
                      <strong>{c.title}</strong>
                      <p>{c.description}</p>
                    </div>
                    <div className="course-meta">
                      <span>
                        Modules {c.modulesCompleted}/{c.moduleCount}
                      </span>
                      <span>
                        Assignments {c.assignmentsCompleted}/{c.assignmentCount}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="panel sis-panel">
          <header className="panel-header">
            <h2>SIS profile</h2>
            <span className="badge">
              {me.agentExchangeEnabled ? "XaaS ready" : me.authMethod === "dev" ? "Dev mock" : "Setup needed"}
            </span>
          </header>
          {me.sis ? (
            <dl className="sis-dl">
              <div>
                <dt>Name</dt>
                <dd>
                  {me.sis.firstName} {me.sis.lastName}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.sis.email || me.user.email}</dd>
              </div>
              <div>
                <dt>Major</dt>
                <dd>{me.sis.major || "—"}</dd>
              </div>
              <div>
                <dt>Standing</dt>
                <dd>{me.sis.academicStanding || "—"}</dd>
              </div>
              <div>
                <dt>Enrolled classes</dt>
                <dd>
                  {me.sis.enrolledClasses.length
                    ? me.sis.enrolledClasses.join(", ")
                    : "None (Orientation generated)"}
                </dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{new Date(me.sis.syncedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty">
              No SIS snapshot yet. Sync after Okta ID-JAG is configured, or use Dev login.
            </p>
          )}
          <p className="xaas-note">
            Cross App Access: LMS exchanges your Okta <code>id_token</code> for an ID-JAG, then a
            delegated SIS access token, and calls <code>GET /api/v1/students/me</code>.
          </p>
        </aside>
      </div>
    </div>
  );
}
