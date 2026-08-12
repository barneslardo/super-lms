import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { askStudyHelper } from "../lib/study-chat.js";

export const studyChatRouter = Router();

studyChatRouter.use(requireAuth);

const studyChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const StudyChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
});

studyChatRouter.post("/study-chat", studyChatLimiter, async (req, res, next) => {
  try {
    const { messages } = StudyChatRequestSchema.parse(req.body);
    const reply = await askStudyHelper(req.user!.id, messages);
    res.json({ data: { reply } });
  } catch (err) {
    next(err);
  }
});
