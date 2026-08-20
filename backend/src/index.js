/**
 * @fileoverview YamBot Express HTTP entrypoint.
 * Purpose: Boot MongoDB, mount API routers, and listen for web + extension clients.
 * Inputs: Env from `.env.development` / `.env.production` (+ optional server `.env` overlay).
 * Downstream: Routes under `/api/*` → Mongoose models → Chrome extension task worker.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const { extensionRouter } = await import("./routes/extension.js");
const { authRequired } = await import("./middleware/auth.js");

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
      // Why: curl / same-origin / some clients omit Origin.
      if (!origin) {
        cb(null, true);
        return;
      }
      // Why: unpacked Chrome extensions get a random ID; allow all extension origins.
      if (origin.startsWith("chrome-extension://")) {
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
app.use("/api/settings", authRequired, settingsRouter);
app.use("/api/agents", authRequired, (await import("./routes/agents.js")).agentsRouter);
app.use("/api/chats", authRequired, chatsRouter);
app.use("/api/extension", authRequired, extensionRouter);
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

await connectDb();
const { seedDefaultLlmSettings } = await import("./utils/seedLlm.js");
await seedDefaultLlmSettings();
const { startAgentScheduler } = await import("./utils/scheduler.js");
startAgentScheduler();
app.listen(env.PORT, () => {
  console.log(`YamBot API listening on :${env.PORT} (${env.NODE_ENV})`);
});
