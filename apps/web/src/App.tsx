import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursePage } from "./pages/CoursePage";
import { api } from "./api";
import { StudyHelper } from "./components/StudyHelper";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/courses/:id" element={<CoursePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AuthShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.getMe,
    retry: false,
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
  });

  if (isLoading) return <div className="loading-screen">Loading…</div>;
  if (isError || !data?.data) return <Navigate to="/login" replace />;

  const user = data.data;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark">Campus LMS</span>
          <span className="brand-sub">Learning · Okta demo</span>
        </div>
        <div className="topbar-user">
          <div className="user-meta">
            <strong>{user.displayName}</strong>
            <span>{user.persona ?? user.role}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <StudyHelper user={user} />
    </div>
  );
}
