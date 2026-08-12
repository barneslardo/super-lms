import { z } from "zod";

export const UserRole = z.enum(["admin", "student"]);
export type UserRole = z.infer<typeof UserRole>;

/** SIS custom AS scopes used when LMS exchanges for a delegated SIS token. */
export const SisOAuthScopes = {
  STUDENTS_READ: "sis.students.read",
  STUDENTS_READ_SELF: "sis.students.read.self",
  STUDENTS_ACADEMIC: "sis.students.academic",
} as const;

export type SisOAuthScope = (typeof SisOAuthScopes)[keyof typeof SisOAuthScopes];

export const HARDCODED_ADMIN_EMAILS = [
  "demo-admin-1@example.com",
  "demo-admin-2@example.com",
  "demo-admin-3@example.com",
] as const;

export function isHardcodedAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (HARDCODED_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

/** Same Okta Students group as the SIS demo (sledai.oktapreview.com). */
export const OKTA_GROUP_STUDENTS_ID = "00gzd1cnuwCW6LvaV1d7";
export const OKTA_GROUP_ENROLLMENT_ADMINS_ID = "00gzbjxxucc86t8Ez1d7";

const STUDENT_GROUP_NAMES = ["students"];
const ENROLLMENT_ADMIN_NAMES = ["enrollment admins", "enrollment admin"];

function matchesOktaGroup(token: string, groupId: string, names: readonly string[]): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t === groupId.toLowerCase()) return true;
  return names.some((n) => t === n || t.includes(n));
}

export function isStudentsGroup(groups: string[]): boolean {
  return groups.some((g) => matchesOktaGroup(g, OKTA_GROUP_STUDENTS_ID, STUDENT_GROUP_NAMES));
}

export function isEnrollmentAdminGroup(groups: string[]): boolean {
  return groups.some((g) =>
    matchesOktaGroup(g, OKTA_GROUP_ENROLLMENT_ADMINS_ID, ENROLLMENT_ADMIN_NAMES)
  );
}

/**
 * LMS access: Students group → student; enrollment admins / hardcoded → admin.
 * Returns null when the user is not authorized for the LMS.
 */
export function resolveOidcUserRole(email: string, groups: string[] = []): UserRole | null {
  if (isHardcodedAdmin(email)) return "admin";
  if (isEnrollmentAdminGroup(groups)) return "admin";
  if (isStudentsGroup(groups)) return "student";
  return null;
}

export function resolvePersonaLabel(email: string, groups: string[] = []): string | undefined {
  if (isHardcodedAdmin(email)) return "Platform Admin";
  if (isEnrollmentAdminGroup(groups)) return "Enrollment Admin";
  if (isStudentsGroup(groups)) return "Student";
  return undefined;
}

export function formatDisplayName(opts: {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}): string {
  const fromName = opts.name?.trim();
  if (fromName) return fromName;
  const fromParts = [opts.firstName, opts.lastName].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;
  return opts.email.split("@")[0] ?? opts.email;
}

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRole,
  oktaId: z.string().nullable(),
  displayName: z.string().min(1),
  groups: z.array(z.string()).optional(),
  persona: z.string().optional(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const CourseModuleSchema = z.object({
  title: z.string(),
  body: z.string(),
  order: z.number().int(),
});

export const CourseAssignmentSchema = z.object({
  title: z.string(),
  body: z.string(),
  order: z.number().int(),
});

export type CourseCatalogEntry = {
  code: string;
  title: string;
  majorTag: string;
  description: string;
  modules: z.infer<typeof CourseModuleSchema>[];
  assignments: z.infer<typeof CourseAssignmentSchema>[];
};

/** Demo catalog keyed by SIS enrolledClasses codes. */
export const COURSE_CATALOG: Record<string, CourseCatalogEntry> = {
  CS101: {
    code: "CS101",
    title: "Introduction to Computer Science",
    majorTag: "Computer Science",
    description: "Foundations of programming, algorithms, and computational thinking.",
    modules: [
      {
        order: 1,
        title: "Welcome & Course Orientation",
        body: "Overview of CS101 goals, tooling, and how this LMS content was provisioned from your SIS enrollment.",
      },
      {
        order: 2,
        title: "Variables, Types, and Control Flow",
        body: "Work through expressions, branching, and loops with short in-browser exercises.",
      },
      {
        order: 3,
        title: "Functions and Problem Decomposition",
        body: "Break problems into reusable functions; practice with pair-programming prompts.",
      },
      {
        order: 4,
        title: "Intro to Algorithms",
        body: "Searching, sorting intuition, and big-O at a glance for first-year students.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Lab 1: Hello Campus",
        body: "Write a small program that greets a student by name and prints their major from a mock profile.",
      },
      {
        order: 2,
        title: "Quiz: Control Flow",
        body: "Ten short questions on if/else, loops, and boolean logic.",
      },
    ],
  },
  MATH201: {
    code: "MATH201",
    title: "Calculus II",
    majorTag: "Mathematics",
    description: "Integration techniques, series, and applications.",
    modules: [
      {
        order: 1,
        title: "Review of Differentiation",
        body: "Warm-up problems connecting derivatives to rates of change in campus scenarios.",
      },
      {
        order: 2,
        title: "Integration Techniques",
        body: "Substitution, parts, and partial fractions with guided walkthroughs.",
      },
      {
        order: 3,
        title: "Sequences and Series",
        body: "Convergence tests and power series for applied modeling.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Problem Set 1",
        body: "Eight integration problems; submit written work as PDF in a full LMS — here, mark complete when done.",
      },
    ],
  },
  ENG102: {
    code: "ENG102",
    title: "Composition II",
    majorTag: "English",
    description: "Research writing, argumentation, and revision.",
    modules: [
      {
        order: 1,
        title: "Thesis and Argument Structure",
        body: "Craft a working thesis and outline for a research essay.",
      },
      {
        order: 2,
        title: "Sources and Citation",
        body: "Evaluate sources and practice MLA/APA citation patterns.",
      },
      {
        order: 3,
        title: "Peer Review Workshop",
        body: "Use a structured rubric to give and receive feedback.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Annotated Bibliography",
        body: "Annotate five scholarly sources related to your chosen topic.",
      },
    ],
  },
  PHYS301: {
    code: "PHYS301",
    title: "Modern Physics",
    majorTag: "Physics",
    description: "Relativity, quantum foundations, and atomic models.",
    modules: [
      {
        order: 1,
        title: "Special Relativity Essentials",
        body: "Time dilation and length contraction with thought experiments.",
      },
      {
        order: 2,
        title: "Photoelectric Effect",
        body: "Wave-particle duality through historical experiments.",
      },
      {
        order: 3,
        title: "Atomic Spectra Lab Prep",
        body: "Prepare for lab analysis of emission spectra.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Problem Set: Relativity",
        body: "Work five relativity problems; show steps clearly.",
      },
    ],
  },
  CHEM201: {
    code: "CHEM201",
    title: "Organic Chemistry I",
    majorTag: "Chemistry",
    description: "Structure, bonding, and reactions of organic molecules.",
    modules: [
      {
        order: 1,
        title: "Bonding and Hybridization",
        body: "Lewis structures to molecular shape for common functional groups.",
      },
      {
        order: 2,
        title: "Nomenclature Drill",
        body: "Name alkanes, alkenes, and substituted aromatics.",
      },
      {
        order: 3,
        title: "Intro to Mechanisms",
        body: "Arrow-pushing for SN1/SN2 at a conceptual level.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Nomenclature Quiz",
        body: "Identify and name twelve organic structures.",
      },
    ],
  },
  BIO101: {
    code: "BIO101",
    title: "General Biology",
    majorTag: "Biology",
    description: "Cell biology, genetics, and introductory ecology.",
    modules: [
      {
        order: 1,
        title: "Cell Structure",
        body: "Organelles and membrane transport for first-year biology.",
      },
      {
        order: 2,
        title: "DNA and Inheritance",
        body: "Mendelian genetics and modern DNA basics.",
      },
      {
        order: 3,
        title: "Energy and Metabolism",
        body: "Photosynthesis and cellular respiration overview.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Lab Report: Microscopy",
        body: "Draft a short lab report from sample micrograph data.",
      },
    ],
  },
  PSY101: {
    code: "PSY101",
    title: "Introduction to Psychology",
    majorTag: "Psychology",
    description: "Core theories, research methods, and applied psychology.",
    modules: [
      {
        order: 1,
        title: "History and Methods",
        body: "Experimental design and ethics in psychological research.",
      },
      {
        order: 2,
        title: "Learning and Memory",
        body: "Classical/operant conditioning and memory systems.",
      },
      {
        order: 3,
        title: "Social Psychology Snapshot",
        body: "Conformity, bias, and group dynamics on campus.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Reflection Essay",
        body: "500-word reflection applying one theory to a student life scenario.",
      },
    ],
  },
  ART101: {
    code: "ART101",
    title: "Art Foundations",
    majorTag: "Fine Arts",
    description: "Visual elements, composition, and studio practice.",
    modules: [
      {
        order: 1,
        title: "Elements of Design",
        body: "Line, shape, value, and color relationships.",
      },
      {
        order: 2,
        title: "Composition Studies",
        body: "Balance, contrast, and focal point exercises.",
      },
      {
        order: 3,
        title: "Critique Vocabulary",
        body: "How to give constructive studio feedback.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Sketchbook Week 1",
        body: "Complete five composition sketches and mark complete when finished.",
      },
    ],
  },
  HIST201: {
    code: "HIST201",
    title: "World History Survey",
    majorTag: "History",
    description: "Global themes from early modern to contemporary eras.",
    modules: [
      {
        order: 1,
        title: "Sources and Historiography",
        body: "Primary vs secondary sources and historical argument.",
      },
      {
        order: 2,
        title: "Trade and Empire",
        body: "Networks that reshaped the early modern world.",
      },
      {
        order: 3,
        title: "Twentieth-Century Turning Points",
        body: "Case studies for discussion seminars.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Primary Source Analysis",
        body: "Analyze one primary document using the course rubric.",
      },
    ],
  },
  MUS101: {
    code: "MUS101",
    title: "Music Appreciation",
    majorTag: "Music",
    description: "Listening skills across genres and historical periods.",
    modules: [
      {
        order: 1,
        title: "Elements of Music",
        body: "Melody, harmony, rhythm, and form for active listeners.",
      },
      {
        order: 2,
        title: "Classical Forms",
        body: "Sonata, symphony, and opera highlights.",
      },
      {
        order: 3,
        title: "Popular Traditions",
        body: "Jazz, folk, and contemporary listening labs.",
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Listening Journal",
        body: "Write three short listening responses using course vocabulary.",
      },
    ],
  },
};

export const ORIENTATION_COURSE: CourseCatalogEntry = {
  code: "ORIENT100",
  title: "Campus Orientation",
  majorTag: "General",
  description:
    "Fallback LMS pathway when SIS has no enrolled classes yet. Personalized from your major when available.",
  modules: [
    {
      order: 1,
      title: "Welcome to the LMS",
      body: "This course was generated because your SIS academic record had no enrolledClasses. Sync again after the registrar adds sections.",
    },
    {
      order: 2,
      title: "Cross App Access Walkthrough",
      body: "Your LMS session used Okta ID-JAG to read your SIS profile (major, enrollment) without a separate SIS password prompt.",
    },
    {
      order: 3,
      title: "Next Steps",
      body: "Visit the SIS profile app to update enrollment, then use Sync from SIS on the LMS dashboard.",
    },
  ],
  assignments: [
    {
      order: 1,
      title: "Explore Your SIS Profile",
      body: "Open the SIS profile link, confirm your major, then return and mark this complete.",
    },
  ],
};

export function catalogEntryForCode(code: string): CourseCatalogEntry {
  const key = code.trim().toUpperCase();
  if (COURSE_CATALOG[key]) return COURSE_CATALOG[key];
  return {
    code: key || "GEN100",
    title: `${key || "General"} Seminar`,
    majorTag: "General",
    description: `Demo content generated for SIS course code ${key || "unknown"}.`,
    modules: [
      {
        order: 1,
        title: "Module 1: Getting Started",
        body: `Introductory module for ${key}. Content is synthetic for the Okta LMS demo.`,
      },
      {
        order: 2,
        title: "Module 2: Core Topics",
        body: `Continue building skills related to ${key}.`,
      },
      {
        order: 3,
        title: "Module 3: Capstone Prep",
        body: `Wrap-up activities for ${key}.`,
      },
    ],
    assignments: [
      {
        order: 1,
        title: "Assignment 1",
        body: `Complete the first checkpoint for ${key}.`,
      },
    ],
  };
}

export const SisSnapshotSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  major: z.string().default(""),
  minor: z.string().default(""),
  concentration: z.string().default(""),
  enrollmentStatus: z.boolean().optional(),
  enrolledClasses: z.array(z.string()).default([]),
  academicStanding: z.string().optional(),
  syncedAt: z.string().datetime().optional(),
});

export type SisSnapshot = z.infer<typeof SisSnapshotSchema>;

export const CourseResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  majorTag: z.string(),
  description: z.string(),
  enrollmentId: z.string().uuid().optional(),
  modules: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        body: z.string(),
        order: z.number(),
        completed: z.boolean().optional(),
      })
    )
    .optional(),
  assignments: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        body: z.string(),
        order: z.number(),
        completed: z.boolean().optional(),
      })
    )
    .optional(),
});

export type CourseResponse = z.infer<typeof CourseResponseSchema>;
