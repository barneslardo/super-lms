import { config } from "../config.js";
import { AppError } from "./errors.js";
import {
  getDelegatedAccessToken,
  isAgentExchangeEnabled,
} from "./agent-token-exchange.js";

export type SisMeProfile = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enrollmentStatus?: boolean;
  enrolledClasses?: string[];
  academic?: {
    major?: string;
    minor?: string;
    concentration?: string;
    academicStanding?: string;
    currentCourses?: string[];
  } | null;
};

/**
 * Exchange the LMS user's Okta id_token for a delegated SIS access token (ID-JAG),
 * then fetch GET /api/v1/students/me from the SIS API.
 */
export async function fetchSisStudentMe(idToken: string): Promise<SisMeProfile> {
  if (!isAgentExchangeEnabled()) {
    throw new AppError(
      503,
      "AGENT_DISABLED",
      "Cross App Access is not configured (agent client + private key + RESOURCE_AS_ISSUER)."
    );
  }

  const delegated = await getDelegatedAccessToken(idToken);
  if (!delegated.access_token) {
    throw new AppError(502, "SIS_TOKEN_FAILED", "SIS delegated access token missing access_token");
  }

  const base = config.sisApiUrl;
  const res = await fetch(`${base}/api/v1/students/me`, {
    headers: {
      Authorization: `Bearer ${delegated.access_token}`,
      Accept: "application/json",
    },
  });

  const payload = (await res.json().catch(() => ({}))) as {
    data?: SisMeProfile;
    error?: { message?: string; code?: string };
  };

  if (!res.ok) {
    throw new AppError(
      res.status === 401 || res.status === 403 ? res.status : 502,
      "SIS_FETCH_FAILED",
      payload.error?.message ?? `SIS /students/me failed (${res.status})`,
      payload.error
    );
  }

  const profile = payload.data;
  if (!profile) {
    throw new AppError(502, "SIS_FETCH_FAILED", "SIS /students/me returned no data");
  }

  // Prefer academic.currentCourses when enrolledClasses omitted
  if (!profile.enrolledClasses?.length && profile.academic?.currentCourses?.length) {
    profile.enrolledClasses = profile.academic.currentCourses;
  }

  return profile;
}

/** Dev-mode mock when agent exchange is unavailable. */
export function mockSisProfileForDev(email: string): SisMeProfile {
  return {
    firstName: "Demo",
    lastName: "Student",
    email,
    enrollmentStatus: true,
    enrolledClasses: ["CS101", "MATH201", "ENG102"],
    academic: {
      major: "Computer Science",
      minor: "",
      concentration: "",
      academicStanding: "Good Standing",
      currentCourses: ["CS101", "MATH201", "ENG102"],
    },
  };
}
