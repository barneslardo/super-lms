import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

export function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const course = useQuery({
    queryKey: ["course", id],
    queryFn: () => api.getCourse(id!),
    enabled: Boolean(id),
  });

  const progress = useMutation({
    mutationFn: api.setProgress,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["course", id] });
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  if (course.isLoading) return <div className="loading-screen">Loading course…</div>;
  if (course.isError || !course.data) {
    return (
      <div>
        <Link to="/">← Dashboard</Link>
        <div className="error-banner">Course not found.</div>
      </div>
    );
  }

  const c = course.data.data;

  return (
    <div className="course-page">
      <Link to="/" className="back-link">
        ← Dashboard
      </Link>
      <header className="course-header">
        <span className="course-code">{c.code}</span>
        <h1>{c.title}</h1>
        <p>{c.description}</p>
        <span className="tag">{c.majorTag}</span>
      </header>

      <section className="panel">
        <h2>Modules</h2>
        <ul className="content-list">
          {c.modules.map((m) => (
            <li key={m.id} className={m.completed ? "done" : ""}>
              <div>
                <strong>
                  {m.order}. {m.title}
                </strong>
                <p>{m.body}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={progress.isPending}
                onClick={() =>
                  progress.mutate({ moduleId: m.id, completed: !m.completed })
                }
              >
                {m.completed ? "Mark incomplete" : "Mark complete"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Assignments</h2>
        <ul className="content-list">
          {c.assignments.map((a) => (
            <li key={a.id} className={a.completed ? "done" : ""}>
              <div>
                <strong>
                  {a.order}. {a.title}
                </strong>
                <p>{a.body}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={progress.isPending}
                onClick={() =>
                  progress.mutate({ assignmentId: a.id, completed: !a.completed })
                }
              >
                {a.completed ? "Mark incomplete" : "Mark complete"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
