/**
 * @fileoverview YamBot Express HTTP entrypoint.
 * Purpose: Boot MongoDB, mount API routers, and listen for web + cloud worker clients.
 * Inputs: Env from `.env.development` / `.env.production` (+ optional server `.env` overlay).
 * Downstream: Routes under `/api/*` → Mongoose models → cloud Playwright workers.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";

/**
 * Loads KEY=VALUE files into process.env without failing if a file is missing.
 * Why: production keeps secrets in an untracked `.env` while committed `.env.production`
 * holds non-secret host URLs — pull-deploy must not require rewriting secrets.
 * @param {string[]} files
 */
function loadEnvFiles(files) {
  for (const file of files) {
    const full = resolve(process.cwd(), file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Why: do not override vars already provided by the process manager.
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles(
  process.env.NODE_ENV === "production"
    ? [".env.production", ".env"]
    : [".env.development", ".env"]
);

const { default: cors } = await import("cors");
const { default: express } = await import("express");
const { default: morgan } = await import("morgan");
const { connectDb } = await import("./utils/db.js");
const { env } = await import("./utils/env.js");
const { authRouter } = await import("./routes/auth.js");
const { chatsRouter } = await import("./routes/chats.js");
const { settingsRouter } = await import("./routes/settings.js");
const { workerRouter } = await import("./routes/worker.js");
const { authRequired } = await import("./middleware/auth.js");
const { Agent } = await import("./models/Agent.js");
const { attachDesktopProxy, signDesktopTicket } = await import("./utils/desktopProxy.js");

await connectDb();
const { seedDefaultLlmSettings } = await import("./utils/seedLlm.js");
await seedDefaultLlmSettings();
const { startAgentScheduler } = await import("./utils/scheduler.js");
startAgentScheduler();

const app = express();

/** Why: allow the Vite web app and (optionally) other trusted origins. */
const allowed = new Set(
  (env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (allowed.size === 0 || allowed.has(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "3mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "yambot-api",
    env: env.NODE_ENV,
    publicApiUrl: env.PUBLIC_API_URL,
  });
});

app.use("/api/auth", authRouter);

/**
 * POST /api/agents/:agentId/desktop/session — JWT ticket for noVNC iframe.
 * Body: { viewOnly?: boolean } — viewOnly=true for Zoom (watch); false/omit for Take control.
 * Why: registered before `/api/agents` auth mount so Take control can open a ticketed stream.
 */
app.post("/api/agents/:agentId/desktop/session", authRequired, async (req, res, next) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await Agent.findOne({ _id: agentId, user: req.userId }).select("_id name").lean();
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const ticket = signDesktopTicket(req.userId, agentId);
    // Why: Ubuntu noVNC does `url += '/' + path`, so bare "websockify" becomes
    // wss://host/websockify and never hits our authenticated desktop proxy.
    // Include ticket in the WS path query so auth works even if the Set-Cookie race loses.
    const wsPath = `api/agents/${agentId}/desktop/websockify?t=${ticket}`;
    const viewOnly = req.body?.viewOnly === true;
    const embedPath =
      `/api/agents/${agentId}/desktop/vnc.html` +
      `?autoconnect=1&resize=scale&reconnect=1&show_dot=1` +
      (viewOnly ? "&view_only=1" : "&view_only=0") +
      `&path=${encodeURIComponent(wsPath)}` +
      `&t=${encodeURIComponent(ticket)}`;
    res.json({
      ok: true,
      ticket,
      embedPath,
      embedUrl: `${env.PUBLIC_API_URL || ""}${embedPath}`,
    });
  } catch (err) {
    next(err);
  }
});

const server = createServer(app);
// Why: before authRequired agents router — iframe uses ticket/cookie, not Bearer.
attachDesktopProxy(server, app);

app.use("/api/settings", authRequired, settingsRouter);
app.use("/api/agents", authRequired, (await import("./routes/agents.js")).agentsRouter);
app.use("/api/chats", authRequired, chatsRouter);
app.use("/api/goals", authRequired, (await import("./routes/goals.js")).goalsRouter);
app.use("/api/governance", authRequired, (await import("./routes/governance.js")).governanceRouter);
app.use("/api/policies", authRequired, (await import("./routes/policies.js")).policiesRouter);
app.use("/api/approvals", authRequired, (await import("./routes/approvals.js")).approvalsRouter);
app.use("/api/workforce", authRequired, (await import("./routes/workforce.js")).workforceRouter);
app.use("/api/worker", authRequired, workerRouter);
app.use("/api/system", authRequired, (await import("./routes/system.js")).systemRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    ok: false,
    title: err.title || "Server error",
    detail: err.message || "Unexpected error",
    hint: err.hint || "",
  });
});

server.listen(env.PORT, () => {
  console.log(`YamBot API listening on :${env.PORT} (${env.NODE_ENV})`);
});
