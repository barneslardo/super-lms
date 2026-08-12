import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("x-request-id", id);
  next();
}
