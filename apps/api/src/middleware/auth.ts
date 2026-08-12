import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
  }
  next();
}

export function requireStudentOrAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
  }
  if (req.user.role !== "student" && req.user.role !== "admin") {
    return next(new AppError(403, "FORBIDDEN", "LMS access required"));
  }
  next();
}
