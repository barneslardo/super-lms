import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureFreshIdToken } from "../lib/session-id-token.js";
import { fetchSisStudentMe, mockSisProfileForDev } from "../lib/sis-client.js";
import { syncUserContentFromSis } from "../lib/content-sync.js";
import { config } from "../config.js";
import { isAgentExchangeEnabled } from "../lib/agent-token-exchange.js";

export const coursesRouter = Router();

coursesRouter.use(requireAuth);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

coursesRouter.get("/me", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const [user, snapshot, enrollments] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.sisSnapshot.findUnique({ where: { userId } }),
      prisma.enrollment.count({ where: { userId } }),
    ]);
    if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

    res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: req.user!.displayName,
          persona: req.user!.persona,
        },
        sis: snapshot
          ? {
              firstName: snapshot.firstName,
              lastName: snapshot.lastName,
              email: snapshot.email,
              major: snapshot.major,
              minor: snapshot.minor,
              concentration: snapshot.concentration,
              enrollmentStatus: snapshot.enrollmentStatus,
              enrolledClasses: asStringArray(snapshot.enrolledClasses),
              academicStanding: snapshot.academicStanding,
              syncedAt: snapshot.syncedAt.toISOString(),
            }
          : null,
        courseCount: enrollments,
        sisAppUrl: config.sisAppUrl,
        agentExchangeEnabled: isAgentExchangeEnabled(),
        authMethod: req.session.authMethod ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

coursesRouter.get("/courses", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          include: {
            modules: { orderBy: { order: "asc" } },
            assignments: { orderBy: { order: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const progress = await prisma.progress.findMany({ where: { userId } });
    const completedModules = new Set(
      progress.filter((p) => p.moduleId && p.completed).map((p) => p.moduleId!)
    );
    const completedAssignments = new Set(
      progress.filter((p) => p.assignmentId && p.completed).map((p) => p.assignmentId!)
    );

    res.json({
      data: enrollments.map((e) => ({
        id: e.course.id,
        enrollmentId: e.id,
        code: e.course.code,
        title: e.course.title,
        majorTag: e.course.majorTag,
        description: e.course.description,
        moduleCount: e.course.modules.length,
        assignmentCount: e.course.assignments.length,
        modulesCompleted: e.course.modules.filter((m) => completedModules.has(m.id)).length,
        assignmentsCompleted: e.course.assignments.filter((a) =>
          completedAssignments.has(a.id)
        ).length,
      })),
    });
  } catch (err) {
    next(err);
  }
});

coursesRouter.get("/courses/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId, courseId: req.params.id },
      include: {
        course: {
          include: {
            modules: { orderBy: { order: "asc" } },
            assignments: { orderBy: { order: "asc" } },
          },
        },
      },
    });
    if (!enrollment) throw new AppError(404, "NOT_FOUND", "Course not found for this user");

    const progress = await prisma.progress.findMany({ where: { userId } });
    const completedModules = new Set(
      progress.filter((p) => p.moduleId && p.completed).map((p) => p.moduleId!)
    );
    const completedAssignments = new Set(
      progress.filter((p) => p.assignmentId && p.completed).map((p) => p.assignmentId!)
    );

    const c = enrollment.course;
    res.json({
      data: {
        id: c.id,
        enrollmentId: enrollment.id,
        code: c.code,
        title: c.title,
        majorTag: c.majorTag,
        description: c.description,
        modules: c.modules.map((m) => ({
          id: m.id,
          title: m.title,
          body: m.body,
          order: m.order,
          completed: completedModules.has(m.id),
        })),
        assignments: c.assignments.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          order: a.order,
          completed: completedAssignments.has(a.id),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

coursesRouter.post("/progress", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { moduleId, assignmentId, completed } = req.body as {
      moduleId?: string;
      assignmentId?: string;
      completed?: boolean;
    };
    if (!moduleId && !assignmentId) {
      throw new AppError(400, "VALIDATION_ERROR", "moduleId or assignmentId required");
    }
    if (moduleId && assignmentId) {
      throw new AppError(400, "VALIDATION_ERROR", "Provide only one of moduleId or assignmentId");
    }

    const done = completed !== false;
    const completedAt = done ? new Date() : null;

    if (moduleId) {
      const mod = await prisma.module.findUnique({ where: { id: moduleId } });
      if (!mod) throw new AppError(404, "NOT_FOUND", "Module not found");
      const enrolled = await prisma.enrollment.findFirst({
        where: { userId, courseId: mod.courseId },
      });
      if (!enrolled) throw new AppError(403, "FORBIDDEN", "Not enrolled in this course");

      const row = await prisma.progress.upsert({
        where: { userId_moduleId: { userId, moduleId } },
        create: { userId, moduleId, completed: done, completedAt },
        update: { completed: done, completedAt },
      });
      return res.json({ data: row });
    }

    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId! } });
    if (!assignment) throw new AppError(404, "NOT_FOUND", "Assignment not found");
    const enrolled = await prisma.enrollment.findFirst({
      where: { userId, courseId: assignment.courseId },
    });
    if (!enrolled) throw new AppError(403, "FORBIDDEN", "Not enrolled in this course");

    const row = await prisma.progress.upsert({
      where: { userId_assignmentId: { userId, assignmentId: assignmentId! } },
      create: { userId, assignmentId: assignmentId!, completed: done, completedAt },
      update: { completed: done, completedAt },
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

coursesRouter.post("/sync-from-sis", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    let profile;

    const canUseMock =
      req.session.authMethod === "dev" &&
      (!req.session.idToken || !isAgentExchangeEnabled());

    if (canUseMock) {
      profile = mockSisProfileForDev(req.user!.email);
    } else {
      const idToken = await ensureFreshIdToken(req);
      profile = await fetchSisStudentMe(idToken);
    }

    const result = await syncUserContentFromSis(userId, profile);
    const snapshot = await prisma.sisSnapshot.findUnique({ where: { userId } });

    res.json({
      data: {
        ...result,
        sis: snapshot
          ? {
              major: snapshot.major,
              enrolledClasses: asStringArray(snapshot.enrolledClasses),
              syncedAt: snapshot.syncedAt.toISOString(),
            }
          : null,
        source: req.session.authMethod === "dev" && !req.session.idToken ? "mock" : "sis-xaas",
      },
    });
  } catch (err) {
    next(err);
  }
});
