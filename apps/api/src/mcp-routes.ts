import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "./lib/prisma.js";

/**
 * OAuth-protected MCP endpoint for Super LMS.
 *
 * LMS is a *client* of the SIS authorization server for Cross App Access, and
 * separately a *resource server* of its own — this file is the second role. The
 * two are deliberately kept apart: the SIS delegation path is untouched, and
 * tokens minted here only ever carry lms.* scopes.
 */

const ISSUER = (process.env.LMS_AS_ISSUER ?? "").replace(/\/$/, "");
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? "https://lmsapi.skylarbarnes.com").replace(/\/$/, "");
const RESOURCE_URL = process.env.LMS_MCP_AUDIENCE ?? `${API_PUBLIC_URL}/mcp`;

const SCOPES = {
  COURSES: "lms.courses.read.self",
  ASSIGNMENTS: "lms.assignments.read.self",
  PROGRESS: "lms.progress.read.self",
  CATALOG: "lms.catalog.read",
  ADMIN: "lms.admin",
} as const;

const SCOPES_SUPPORTED = Object.values(SCOPES);

type Auth = { scopes: string[]; email?: string; sub: string };

type ToolDef = {
  name: string;
  description: string;
  requiredScopes: string[];
  inputSchema: Record<string, unknown>;
  run: (auth: Auth, args: Record<string, unknown>) => Promise<unknown>;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks && ISSUER) jwks = createRemoteJWKSet(new URL(`${ISSUER}/v1/keys`));
  return jwks;
}

function scopesFrom(payload: JWTPayload): string[] {
  if (Array.isArray(payload.scp)) return payload.scp.map(String);
  if (typeof payload.scp === "string") return payload.scp.split(" ");
  if (typeof payload.scope === "string") return payload.scope.split(" ");
  return [];
}

/** `email` is reserved on a custom AS, so the AS publishes `lms_email`. */
function emailFrom(payload: JWTPayload): string | undefined {
  for (const candidate of [payload.lms_email, payload.email, payload.sub]) {
    if (typeof candidate === "string" && candidate.includes("@")) return candidate.toLowerCase();
  }
  return undefined;
}

async function verifyBearer(req: Request): Promise<{ ok: true; auth: Auth } | { ok: false; reason: string }> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return { ok: false, reason: "An access token is required" };
  const set = getJwks();
  if (!set) return { ok: false, reason: "LMS_AS_ISSUER is not configured" };
  try {
    const { payload } = await jwtVerify(header.slice(7), set, {
      issuer: ISSUER,
      audience: [RESOURCE_URL, `${API_PUBLIC_URL}/mcp`],
    });
    return {
      ok: true,
      auth: { scopes: scopesFrom(payload), email: emailFrom(payload), sub: String(payload.sub) },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Token verification failed" };
  }
}

function has(auth: Auth, required: string[]): boolean {
  return auth.scopes.includes(SCOPES.ADMIN) || required.some((s) => auth.scopes.includes(s));
}

/** Resolve the acting student. Tools are self-scoped unless the token is admin. */
async function requireStudent(auth: Auth) {
  if (!auth.email) throw new Error("This token carries no email claim, so it maps to no student record.");
  const user = await prisma.user.findUnique({ where: { email: auth.email } });
  if (!user) throw new Error(`No LMS user matches ${auth.email}.`);
  return user;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_my_courses",
    description: "List the courses the signed-in student is enrolled in, with module counts.",
    requiredScopes: [SCOPES.COURSES],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (auth) => {
      const user = await requireStudent(auth);
      const enrollments = await prisma.enrollment.findMany({
        where: { userId: user.id },
        include: { course: { include: { modules: true, assignments: true } } },
      });
      return {
        count: enrollments.length,
        courses: enrollments.map((e) => ({
          code: e.course.code,
          title: e.course.title,
          description: e.course.description,
          modules: e.course.modules.length,
          assignments: e.course.assignments.length,
          enrolledAt: e.createdAt.toISOString().slice(0, 10),
        })),
      };
    },
  },
  {
    name: "list_my_assignments",
    description:
      "List assignments across the student's enrolled courses, in course order, with completion state.",
    requiredScopes: [SCOPES.ASSIGNMENTS],
    inputSchema: {
      type: "object",
      properties: {
        incompleteOnly: { type: "boolean", description: "Only assignments not yet completed" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    run: async (auth, args) => {
      const user = await requireStudent(auth);
      const enrollments = await prisma.enrollment.findMany({
        where: { userId: user.id },
        select: { courseId: true },
      });
      const assignments = await prisma.assignment.findMany({
        where: { courseId: { in: enrollments.map((e) => e.courseId) } },
        include: {
          course: { select: { code: true, title: true } },
          progress: { where: { userId: user.id } },
        },
        orderBy: [{ courseId: "asc" }, { order: "asc" }],
        take: Math.min(Number(args.limit ?? 50), 200),
      });

      const rows = assignments.map((a) => ({
        title: a.title,
        course: `${a.course.code} — ${a.course.title}`,
        order: a.order,
        completed: a.progress.some((p) => p.completed),
        summary: a.body.slice(0, 240),
      }));
      const filtered = args.incompleteOnly ? rows.filter((r) => !r.completed) : rows;
      return { count: filtered.length, assignments: filtered };
    },
  },
  {
    name: "get_my_progress",
    description:
      "Completion progress for the signed-in student across both modules and assignments.",
    requiredScopes: [SCOPES.PROGRESS],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (auth) => {
      const user = await requireStudent(auth);
      // A Progress row points at EITHER a module or an assignment, so both
      // relations are optional and have to be narrowed before use.
      const progress = await prisma.progress.findMany({
        where: { userId: user.id },
        include: {
          module: { include: { course: { select: { code: true } } } },
          assignment: { include: { course: { select: { code: true } } } },
        },
      });
      const done = progress.filter((p) => p.completed).length;
      return {
        itemsTracked: progress.length,
        completed: done,
        percentComplete: progress.length ? Math.round((done / progress.length) * 100) : 0,
        items: progress.map((p) => ({
          kind: p.module ? "module" : p.assignment ? "assignment" : "unknown",
          course: p.module?.course.code ?? p.assignment?.course.code ?? null,
          title: p.module?.title ?? p.assignment?.title ?? "(orphaned progress row)",
          completed: p.completed,
          completedAt: p.completedAt?.toISOString() ?? null,
        })),
      };
    },
  },
  {
    name: "search_catalog",
    description: "Search the LMS course catalog. Public course information — no student data.",
    requiredScopes: [SCOPES.CATALOG, SCOPES.COURSES],
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
    run: async (_auth, args) => {
      const q = typeof args.query === "string" ? args.query : undefined;
      const courses = await prisma.course.findMany({
        where: q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : undefined,
        include: { modules: true },
        take: Math.min(Number(args.limit ?? 25), 100),
        orderBy: { code: "asc" },
      });
      return {
        count: courses.length,
        courses: courses.map((c) => ({
          code: c.code,
          title: c.title,
          description: c.description,
          modules: c.modules.length,
        })),
      };
    },
  },
];

function buildServer(auth: Auth): Server {
  const server = new Server(
    { name: "super-lms", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.filter((t) => has(auth, t.requiredScopes)).map((t) => ({
      name: t.name,
      description: `${t.description} (authorized by ${t.requiredScopes.join(" or ")})`,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return { content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }], isError: true };
    }
    if (!has(auth, tool.requiredScopes)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: "insufficient_scope",
                tool: tool.name,
                requiredScopes: tool.requiredScopes,
                presentedScopes: auth.scopes,
                userMessage: `This token does not carry ${tool.requiredScopes.join(" or ")}.`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await tool.run(auth, (request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}

export function mountLmsMcpRoutes(app: Express) {
  const prm = {
    resource: RESOURCE_URL,
    authorization_servers: [ISSUER],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_name: "Super LMS",
    resource_documentation: process.env.APP_URL ?? "https://superlms.skylarbarnes.com",
    mcp_protocol_version: "2025-03-26",
  };

  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/mcp/.well-known/oauth-protected-resource",
  ]) {
    app.get(path, (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.json(prm);
    });
  }

  app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
    try {
      const upstream = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
      res.json({ ...((await upstream.json()) as object), resource: RESOURCE_URL });
    } catch {
      res.status(502).json({ error: "Failed to load authorization server metadata" });
    }
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const handler = async (req: Request, res: Response) => {
    const verified = await verifyBearer(req);
    if (!verified.ok) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${API_PUBLIC_URL}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${verified.reason}"`
      );
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: verified.reason }, id: null });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await buildServer(verified.auth).connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid MCP session id" },
        id: null,
      });
    } catch (err) {
      console.error("[mcp] error:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  };

  app.post("/mcp", handler);
  app.get("/mcp", handler);
  app.delete("/mcp", handler);

  console.log(`[mcp] Super LMS MCP endpoint at ${RESOURCE_URL} (issuer ${ISSUER || "UNSET"})`);
}
