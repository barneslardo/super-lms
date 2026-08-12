import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { config, isProduction } from "./config.js";
import { errorHandler, sendError } from "./lib/errors.js";
import { requestId } from "./middleware/requestId.js";
import { authRouter } from "./routes/auth.js";
import { coursesRouter } from "./routes/courses.js";
import { studyChatRouter } from "./routes/study-chat.js";
import { isOidcEnabled } from "./lib/oidc.js";
import { isAgentExchangeEnabled } from "./lib/agent-token-exchange.js";

const app = express();

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requestId);

app.use(
  session({
    name: "lms.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction(),
      httpOnly: true,
      sameSite: isProduction() ? "none" : "lax",
      domain: config.sessionCookieDomain || undefined,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    oidc: isOidcEnabled(),
    agentExchange: isAgentExchangeEnabled(),
    sisApiUrl: config.sisApiUrl,
  });
});

app.use("/auth", authRouter);
app.use("/api/v1", apiLimiter, coursesRouter);
app.use("/api/v1", apiLimiter, studyChatRouter);

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid request data", err.flatten());
  }
  return errorHandler(err, req, res);
});

app.listen(config.port, () => {
  console.log(`LMS API listening on http://localhost:${config.port}`);
  console.log(`  OIDC: ${isOidcEnabled() ? "enabled" : "disabled"}`);
  if (isOidcEnabled()) {
    console.log(`    Redirect: ${config.oidc.redirectUri}`);
  }
  console.log(`  Cross App Access (ID-JAG): ${isAgentExchangeEnabled() ? "enabled" : "disabled"}`);
  console.log(`  SIS API: ${config.sisApiUrl}`);
});
