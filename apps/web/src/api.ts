import type { AuthUser } from "@lms/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Network error talking to the LMS API");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export type DashboardMe = {
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
    displayName: string;
    persona?: string;
  };
  sis: {
    firstName: string;
    lastName: string;
    email: string;
    major: string;
    minor: string;
    concentration: string;
    enrollmentStatus: boolean;
    enrolledClasses: string[];
    academicStanding: string;
    syncedAt: string;
  } | null;
  courseCount: number;
  sisAppUrl: string;
  agentExchangeEnabled: boolean;
  authMethod: string | null;
};

export type CourseSummary = {
  id: string;
  enrollmentId: string;
  code: string;
  title: string;
  majorTag: string;
  description: string;
  moduleCount: number;
  assignmentCount: number;
  modulesCompleted: number;
  assignmentsCompleted: number;
};

export type StudyChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CourseDetail = {
  id: string;
  enrollmentId: string;
  code: string;
  title: string;
  majorTag: string;
  description: string;
  modules: Array<{
    id: string;
    title: string;
    body: string;
    order: number;
    completed: boolean;
  }>;
  assignments: Array<{
    id: string;
    title: string;
    body: string;
    order: number;
    completed: boolean;
  }>;
};

export const api = {
  getAuthConfig: () =>
    fetchJson<{
      data: { oidc: boolean; agentExchange: boolean; sisAppUrl: string; sisApiUrl: string };
    }>("/auth/config"),
  getMe: () => fetchJson<{ data: AuthUser }>("/auth/me"),
  logout: () => fetchJson<{ data: { ok: boolean } }>("/auth/logout", { method: "POST" }),
  devLogin: (email: string, persona: string) =>
    fetchJson<{ data: AuthUser }>("/auth/dev/login", {
      method: "POST",
      body: JSON.stringify({ email, persona }),
    }),
  getDashboard: () => fetchJson<{ data: DashboardMe }>("/api/v1/me"),
  getCourses: () => fetchJson<{ data: CourseSummary[] }>("/api/v1/courses"),
  getCourse: (id: string) => fetchJson<{ data: CourseDetail }>(`/api/v1/courses/${id}`),
  syncFromSis: () =>
    fetchJson<{
      data: {
        enrolledClasses: string[];
        major: string;
        courseCount: number;
        source: string;
      };
    }>("/api/v1/sync-from-sis", { method: "POST" }),
  setProgress: (body: { moduleId?: string; assignmentId?: string; completed?: boolean }) =>
    fetchJson<{ data: unknown }>("/api/v1/progress", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  studyChat: (messages: StudyChatMessage[]) =>
    fetchJson<{ data: { reply: string } }>("/api/v1/study-chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
};
