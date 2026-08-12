import { ORIENTATION_COURSE, catalogEntryForCode, type CourseCatalogEntry } from "@lms/shared";
import { prisma } from "./prisma.js";
import type { SisMeProfile } from "./sis-client.js";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

async function ensureCourseFromCatalog(entry: CourseCatalogEntry) {
  const existing = await prisma.course.findUnique({
    where: { code: entry.code },
    include: { modules: true, assignments: true },
  });

  if (existing) {
    if (existing.modules.length === 0) {
      await prisma.module.createMany({
        data: entry.modules.map((m) => ({
          courseId: existing.id,
          title: m.title,
          body: m.body,
          order: m.order,
        })),
      });
    }
    if (existing.assignments.length === 0) {
      await prisma.assignment.createMany({
        data: entry.assignments.map((a) => ({
          courseId: existing.id,
          title: a.title,
          body: a.body,
          order: a.order,
        })),
      });
    }
    return existing.id;
  }

  const course = await prisma.course.create({
    data: {
      code: entry.code,
      title: entry.title,
      majorTag: entry.majorTag,
      description: entry.description,
      modules: {
        create: entry.modules.map((m) => ({
          title: m.title,
          body: m.body,
          order: m.order,
        })),
      },
      assignments: {
        create: entry.assignments.map((a) => ({
          title: a.title,
          body: a.body,
          order: a.order,
        })),
      },
    },
  });
  return course.id;
}

/**
 * Persist SIS snapshot and enroll the user in catalog courses for enrolledClasses.
 * Creates Orientation when the roster is empty.
 */
export async function syncUserContentFromSis(userId: string, profile: SisMeProfile) {
  const enrolledClasses = asStringArray(profile.enrolledClasses);
  const major = profile.academic?.major ?? "";
  const minor = profile.academic?.minor ?? "";
  const concentration = profile.academic?.concentration ?? "";
  const academicStanding = profile.academic?.academicStanding ?? "";

  await prisma.sisSnapshot.upsert({
    where: { userId },
    create: {
      userId,
      firstName: profile.firstName ?? "",
      lastName: profile.lastName ?? "",
      email: profile.email ?? "",
      major,
      minor,
      concentration,
      enrollmentStatus: Boolean(profile.enrollmentStatus),
      enrolledClasses,
      academicStanding,
      rawJson: profile as object,
      syncedAt: new Date(),
    },
    update: {
      firstName: profile.firstName ?? "",
      lastName: profile.lastName ?? "",
      email: profile.email ?? "",
      major,
      minor,
      concentration,
      enrollmentStatus: Boolean(profile.enrollmentStatus),
      enrolledClasses,
      academicStanding,
      rawJson: profile as object,
      syncedAt: new Date(),
    },
  });

  if (profile.firstName || profile.lastName) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(profile.firstName ? { firstName: profile.firstName } : {}),
        ...(profile.lastName ? { lastName: profile.lastName } : {}),
      },
    });
  }

  const codes = enrolledClasses.length ? enrolledClasses : [ORIENTATION_COURSE.code];
  const courseIds: string[] = [];

  for (const code of codes) {
    const entry =
      code === ORIENTATION_COURSE.code
        ? {
            ...ORIENTATION_COURSE,
            majorTag: major || ORIENTATION_COURSE.majorTag,
            description: major
              ? `${ORIENTATION_COURSE.description} Detected major from SIS: ${major}.`
              : ORIENTATION_COURSE.description,
          }
        : catalogEntryForCode(code);
    const courseId = await ensureCourseFromCatalog(entry);
    courseIds.push(courseId);
    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId },
      update: {},
    });
  }

  return {
    enrolledClasses,
    major,
    courseCount: courseIds.length,
  };
}
