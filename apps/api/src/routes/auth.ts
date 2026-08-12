import { Router } from "express";
import passport from "passport";
import { resolveOidcUserRole, OKTA_GROUP_STUDENTS_ID } from "@lms/shared";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { enrichAuthUser, sessionUserFromIdentity } from "../lib/auth-user.js";
import { upsertUserFromIdentity } from "../lib/user-provision.js";
import { isOidcEnabled } from "../lib/oidc.js";
import { isAgentExchangeEnabled } from "../lib/agent-token-exchange.js";
import { oidcRouter } from "./oidc.js";
import { mockSisProfileForDev } from "../lib/sis-client.js";
import { syncUserContentFromSis } from "../lib/content-sync.js";

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
    oidc?: { state: string; nonce: string; verifier: string };
    idToken?: string;
    refreshToken?: string;
    authMethod?: "oidc" | "dev";
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      role: "admin" | "student";
      oktaId: string | null;
      displayName: string;
      groups?: string[];
      persona?: string;
    }
  }
}

export const authRouter = Router();

authRouter.use("/oidc", oidcRouter);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user as Express.User));

authRouter.get("/config", (_req, res) => {
  res.json({
    data: {
      oidc: isOidcEnabled(),
      agentExchange: isAgentExchangeEnabled(),
      sisAppUrl: config.sisAppUrl,
      sisApiUrl: config.sisApiUrl,
    },
  });
});

authRouter.get("/login", (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(503).json({
      error: { code: "OIDC_DISABLED", message: "OIDC is not configured" },
    });
  }
  const returnTo =
    typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
      ? req.query.returnTo
      : "/";
  res.redirect(`/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`);
});

authRouter.get("/me", async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }
    res.json({ data: await enrichAuthUser(req.user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/dev/login", async (req, res, next) => {
  if (config.nodeEnv === "production") {
    return next(new AppError(403, "FORBIDDEN", "Dev login disabled in production"));
  }
  const { email, persona } = req.body as {
    email?: string;
    persona?: string;
  };
  if (!email) {
    return next(new AppError(400, "VALIDATION_ERROR", "email required"));
  }

  const isAdminPersona = persona === "admin" || persona === "enrollment_admin";
  const groups = isAdminPersona
    ? ["Enrollment Admins"]
    : ["Students", OKTA_GROUP_STUDENTS_ID];

  const role =
    resolveOidcUserRole(email.toLowerCase(), groups) ?? (isAdminPersona ? "admin" : "student");

  const user = await upsertUserFromIdentity({
    email: email.toLowerCase(),
    oktaId: null,
    role,
    firstName: "Demo",
    lastName: role === "student" ? "Student" : "Admin",
  });

  if (role === "student") {
    await syncUserContentFromSis(user.id, mockSisProfileForDev(email.toLowerCase()));
  }

  const sessionUser = sessionUserFromIdentity({
    id: user.id,
    email: user.email,
    role: user.role,
    oktaId: user.oktaId,
    firstName: user.firstName,
    lastName: user.lastName,
    groups,
  });

  req.login(sessionUser, (err) => {
    if (err) return next(err);
    // Passport regenerates the session on login — set authMethod after.
    req.session.authMethod = "dev";
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      res.json({ data: sessionUser });
    });
  });
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.json({ data: { ok: true } }));
  });
});
