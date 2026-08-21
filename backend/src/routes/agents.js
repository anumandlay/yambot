/**
 * @fileoverview Agent CRUD + remote control for YamBot cloud computers.
 * Purpose: Create agents (default cloud box), queue click/type takeover, expose live status.
 * Downstream: computer-manager provisions Docker; worker drains controlQueue; LiveScreen UI.
 */

import crypto from "node:crypto";
import { Router } from "express";
import { Agent, AGENT_RUNNERS, AGENT_MODES, SCHEDULE_INTERVALS, appendAgentMemory } from "../models/Agent.js";
import {
  issueWorkerToken,
  containerNameForAgent,
} from "../utils/workerAuth.js";
import { encryptSecret } from "../utils/crypto.js";
import {
  publicEmailSummary,
  sendAgentEmail,
  checkAgentInbox,
} from "../utils/agentEmail.js";

export const agentsRouter = Router();

/**
 * Strips secrets / huge payloads before sending an agent to the website.
 * @param {object} agent
 * @returns {object}
 */
function publicAgent(agent) {
  if (!agent) return agent;
  const a = typeof agent.toObject === "function" ? agent.toObject() : { ...agent };
  delete a.workerTokenHash;
  delete a.workerTokenEnc;
  delete a.controlQueue;
  if (a.liveScreen) delete a.liveScreen.dataBase64;
  const now = Date.now();
  a.computer = {
    ...(a.computer || {}),
    online: Boolean(
      a.computer?.lastSeenAt && now - new Date(a.computer.lastSeenAt).getTime() < 45_000
    ),
  };
  a.email = publicEmailSummary(a);
  return a;
}

/**
 * Whether this agent should have a cloud container.
 * @param {object} agent
 * @returns {boolean}
 */
function wantsCloudComputer(agent) {
  if (agent.active === false) return false;
  const runner = agent.runner || "cloud";
  // Why: research can use cloud (extension bundled in Chromium) or laptop extension only.
  return runner === "cloud" || runner === "any";
}

/**
 * Applies desired computer state after create/update.
 * @param {import('mongoose').Document} agent
 */
function syncComputerDesired(agent) {
  agent.computer = agent.computer || {};
  if (wantsCloudComputer(agent)) {
    agent.computer.desired = "running";
    agent.computer.containerName =
      agent.computer.containerName || containerNameForAgent(agent._id);
  } else {
    agent.computer.desired = "stopped";
  }
}

/**
 * Ensures worker credentials exist (idempotent).
 * @param {import('mongoose').Document} agent
 * @param {{ rotate?: boolean }} [opts]
 */
function ensureWorkerCredentials(agent, opts = {}) {
  if (!opts.rotate && agent.workerTokenHash && agent.workerTokenEnc) return;
  const issued = issueWorkerToken();
  agent.workerTokenHash = issued.workerTokenHash;
  agent.workerTokenEnc = issued.workerTokenEnc;
}

function normalizeFacts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      key: String(f?.key || "").trim(),
      value: String(f?.value || "").trim(),
    }))
    .filter((f) => f.key);
}

function normalizeDomains(raw) {
  if (Array.isArray(raw)) {
    return raw.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[\n,]/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {object} body
 * @param {{ partial?: boolean }} [opts]
 */
function pickAgentFields(body, opts = {}) {
  const out = {};
  const set = (key, value) => {
    if (value !== undefined) out[key] = value;
  };

  if (body.name != null || !opts.partial) set("name", String(body.name || "").trim());
  if (body.description != null) set("description", String(body.description || "").trim());
  if (body.profile != null) set("profile", String(body.profile || "").trim());
  if (body.skill != null) set("skill", String(body.skill || "").trim().slice(0, 500));
  if (body.mode != null) {
    const mode = String(body.mode || "browser");
    set("mode", AGENT_MODES.includes(mode) ? mode : "browser");
  }
  if (body.researchMaxPages != null) {
    const n = Number(body.researchMaxPages);
    set("researchMaxPages", Number.isFinite(n) ? Math.min(50, Math.max(1, Math.round(n))) : 10);
  }
  if (body.instructions != null) set("instructions", String(body.instructions || "").trim());
  if (body.facts != null) set("facts", normalizeFacts(body.facts));
  if (body.successCriteria != null) {
    set("successCriteria", String(body.successCriteria || "").trim());
  }
  if (body.allowedDomains != null) set("allowedDomains", normalizeDomains(body.allowedDomains));
  if (body.startUrl != null) set("startUrl", String(body.startUrl || "").trim());
  if (body.runner != null) {
    const runner = String(body.runner || "cloud");
    set("runner", AGENT_RUNNERS.includes(runner) ? runner : "cloud");
  }
  // Why: maxSteps removed from product — agents run until finish; ignore legacy clients.
  if (body.active != null) set("active", Boolean(body.active));
  if (body.memory != null && Array.isArray(body.memory)) {
    set(
      "memory",
      body.memory
        .map((m) => ({
          kind: ["note", "run", "avoid", "preference"].includes(m?.kind)
            ? m.kind
            : "note",
          content: String(m?.content || "").trim().slice(0, 2000),
          at: m?.at ? new Date(m.at) : new Date(),
        }))
        .filter((m) => m.content)
        .slice(0, 50)
    );
  }
  if (body.autonomy != null && typeof body.autonomy === "object") {
    set("autonomy", {
      allowSubmit: body.autonomy.allowSubmit !== false,
      allowCaptcha: body.autonomy.allowCaptcha !== false,
      askBeforeLogin: body.autonomy.askBeforeLogin === true,
      askBeforeSubmit: body.autonomy.askBeforeSubmit === true,
    });
  }
  if (body.schedule != null && typeof body.schedule === "object") {
    const s = body.schedule;
    const enabled = Boolean(s.enabled);
    const interval = SCHEDULE_INTERVALS.includes(String(s.interval))
      ? String(s.interval)
      : "1h";
    let dailyAt = String(s.dailyAt || "09:00").trim();
    if (!/^\d{1,2}:\d{2}$/.test(dailyAt)) dailyAt = "09:00";
    const goal = String(s.goal || "").trim().slice(0, 8000);
    /** @type {object} */
    const schedule = {
      enabled,
      goal,
      interval,
      dailyAt,
    };
    if (s.lastRunAt) schedule.lastRunAt = new Date(s.lastRunAt);
    if (s.chatId) schedule.chatId = s.chatId;
    if (enabled && goal) {
      const incomingNext = s.nextRunAt ? new Date(s.nextRunAt) : null;
      // Why: keep a future nextRunAt on edit; otherwise fire on the next scheduler tick.
      schedule.nextRunAt =
        incomingNext && !Number.isNaN(incomingNext.getTime()) && incomingNext.getTime() > Date.now()
          ? incomingNext
          : new Date();
    } else {
      schedule.nextRunAt = null;
    }
    set("schedule", schedule);
  }
  if (body.email != null && typeof body.email === "object") {
    const e = body.email;
    /** @type {object} */
    const email = {
      enabled: Boolean(e.enabled),
      fromName: String(e.fromName || "").trim().slice(0, 120),
      fromAddress: String(e.fromAddress || "").trim().slice(0, 200),
      smtpHost: String(e.smtpHost || "").trim().slice(0, 200),
      smtpPort: Number(e.smtpPort) || 587,
      smtpSecure: Boolean(e.smtpSecure),
      smtpUser: String(e.smtpUser || "").trim().slice(0, 200),
      imapHost: String(e.imapHost || "").trim().slice(0, 200),
      imapPort: Number(e.imapPort) || 993,
      imapSecure: e.imapSecure !== false,
    };
    const pass = String(e.smtpPassword || "").trim();
    if (pass) {
      email.smtpPasswordEnc = encryptSecret(pass);
    } else if (e.clearSmtpPassword) {
      email.smtpPasswordEnc = "";
    }
    set("email", email);
  }
  return out;
}

agentsRouter.get("/meta", (_req, res) => {
  res.json({
    ok: true,
    runners: AGENT_RUNNERS,
    modes: AGENT_MODES,
    scheduleIntervals: SCHEDULE_INTERVALS,
  });
});

agentsRouter.get("/", async (req, res, next) => {
  try {
    const agents = await Agent.find({ user: req.userId })
      .select("-liveScreen.dataBase64 -workerTokenEnc -workerTokenHash -controlQueue")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ ok: true, agents: agents.map(publicAgent) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents — creates agent and requests a cloud computer by default.
 */
agentsRouter.post("/", async (req, res, next) => {
  try {
    const fields = pickAgentFields(req.body || {}, { partial: false });
    if (!fields.name) {
      res.status(400).json({
        ok: false,
        title: "Name required",
        detail: "Give your agent a name.",
      });
      return;
    }
    if (fields.mode == null) fields.mode = "browser";
    // Why: research defaults to extension (captcha-light); cloud is allowed when chosen explicitly.
    if (fields.mode === "research") {
      if (fields.runner == null) fields.runner = "extension";
    } else if (fields.runner == null) {
      fields.runner = "cloud";
    }

    const agent = new Agent({ ...fields, user: req.userId });
    ensureWorkerCredentials(agent);
    syncComputerDesired(agent);
    await agent.save();

    res.status(201).json({
      ok: true,
      agent: publicAgent(agent),
      provision: {
        desired: agent.computer?.desired,
        containerName: agent.computer?.containerName,
        hint:
          agent.computer?.desired === "running"
            ? "Cloud computer will start automatically via computer-manager (usually within ~30s)."
            : "No cloud computer requested for this runner.",
      },
    });
  } catch (err) {
    next(err);
  }
});

agentsRouter.get("/:id", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId })
      .select("-liveScreen.dataBase64 -workerTokenEnc -workerTokenHash -controlQueue")
      .lean();
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    res.json({ ok: true, agent: publicAgent(agent) });
  } catch (err) {
    next(err);
  }
});

agentsRouter.get("/:id/live", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const online = Boolean(
      agent.computer?.lastSeenAt &&
        Date.now() - new Date(agent.computer.lastSeenAt).getTime() < 45_000
    );
    const screen = agent.liveScreen || {};
    res.json({
      ok: true,
      live: {
        online,
        desired: agent.computer?.desired || "stopped",
        provisionError: agent.computer?.provisionError || "",
        containerName: agent.computer?.containerName || "",
        workerName: agent.computer?.workerName || "",
        lastSeenAt: agent.computer?.lastSeenAt || null,
        pageUrl: agent.computer?.pageUrl || "",
        taskId: agent.computer?.taskId || null,
        runner: agent.runner || "cloud",
        viewportWidth: agent.computer?.viewportWidth || 1280,
        viewportHeight: agent.computer?.viewportHeight || 800,
        screenshotWidth: agent.computer?.screenshotWidth || agent.computer?.viewportWidth || 1280,
        screenshotHeight:
          agent.computer?.screenshotHeight || agent.computer?.viewportHeight || 800,
        fullPage: agent.computer?.fullPageScreen !== false,
        mime: screen.mime || "image/jpeg",
        dataBase64: screen.dataBase64 || "",
        capturedAt: screen.at || null,
        humanControl: Boolean(agent.computer?.humanControl),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/:id/control — queue a remote input for the cloud worker (takeover).
 * Body: { type: click|type|key|scroll|session, xNorm?, yNorm?, text?, key?, dy?, active? }
 * Why `session`: toggles humanControl so the worker pauses/resumes the LLM agent loop.
 */
agentsRouter.post("/:id/control", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const type = String(req.body?.type || "").trim();
    if (!["click", "type", "key", "scroll", "session"].includes(type)) {
      res.status(400).json({
        ok: false,
        title: "Invalid control",
        detail: "type must be click, type, key, scroll, or session",
      });
      return;
    }

    // Why: session is persisted as a flag, not a Playwright command.
    if (type === "session") {
      agent.computer = agent.computer || {};
      const active = Boolean(req.body?.active);
      agent.computer.humanControl = active;
      agent.computer.humanControlAt = new Date();
      await agent.save();
      res.json({
        ok: true,
        humanControl: active,
        queued: (agent.controlQueue || []).length,
      });
      return;
    }

    const cmd = {
      id: crypto.randomBytes(8).toString("hex"),
      type,
      text: String(req.body?.text || "").slice(0, 4000),
      key: String(req.body?.key || "").slice(0, 80),
      dy: Number.isFinite(Number(req.body?.dy)) ? Number(req.body.dy) : 0,
      at: new Date(),
    };
    if (type === "click") {
      const xNorm = Number(req.body?.xNorm);
      const yNorm = Number(req.body?.yNorm);
      // Why: Number(undefined) is NaN — never persist NaN or Mongoose rejects the save.
      if (!(Number.isFinite(xNorm) && Number.isFinite(yNorm) && xNorm >= 0 && xNorm <= 1 && yNorm >= 0 && yNorm <= 1)) {
        res.status(400).json({
          ok: false,
          title: "Invalid click",
          detail: "xNorm and yNorm must be finite numbers between 0 and 1",
        });
        return;
      }
      cmd.xNorm = xNorm;
      cmd.yNorm = yNorm;
    }
    agent.controlQueue = agent.controlQueue || [];
    agent.controlQueue.push(cmd);
    // Why: keystrokes can arrive faster than heartbeats while the user types.
    if (agent.controlQueue.length > 80) {
      agent.controlQueue = agent.controlQueue.slice(-80);
    }
    await agent.save();
    res.json({
      ok: true,
      command: cmd,
      queued: agent.controlQueue.length,
      humanControl: Boolean(agent.computer?.humanControl),
    });
  } catch (err) {
    next(err);
  }
});

agentsRouter.put("/:id", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const fields = pickAgentFields(req.body || {}, { partial: true });
    if (fields.name !== undefined && !fields.name) {
      res.status(400).json({ ok: false, title: "Name required", detail: "Name cannot be empty." });
      return;
    }
    if (fields.schedule) {
      // Why: keep schedule chat + last run across edits; only recompute next when toggled/changed.
      fields.schedule.chatId = fields.schedule.chatId || agent.schedule?.chatId || null;
      fields.schedule.lastRunAt = fields.schedule.lastRunAt || agent.schedule?.lastRunAt || null;
      const sameCadence =
        agent.schedule?.enabled === fields.schedule.enabled &&
        agent.schedule?.interval === fields.schedule.interval &&
        agent.schedule?.dailyAt === fields.schedule.dailyAt &&
        agent.schedule?.goal === fields.schedule.goal;
      if (
        sameCadence &&
        agent.schedule?.nextRunAt &&
        new Date(agent.schedule.nextRunAt).getTime() > Date.now()
      ) {
        fields.schedule.nextRunAt = agent.schedule.nextRunAt;
      }
    }
    if (fields.email) {
      // Why: blank password in the form means keep the existing encrypted secret.
      if (!fields.email.smtpPasswordEnc) {
        fields.email.smtpPasswordEnc = agent.email?.smtpPasswordEnc || "";
      }
    }
    Object.assign(agent, fields);
    ensureWorkerCredentials(agent);
    syncComputerDesired(agent);
    await agent.save();
    res.json({ ok: true, agent: publicAgent(agent) });
  } catch (err) {
    next(err);
  }
});

agentsRouter.post("/:id/memory", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    await appendAgentMemory(agent, {
      kind: req.body?.kind || "note",
      content: String(req.body?.content || ""),
    });
    res.json({ ok: true, agent: publicAgent(agent) });
  } catch (err) {
    next(err);
  }
});

agentsRouter.delete("/:id/memory", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    agent.memory = [];
    await agent.save();
    res.json({ ok: true, agent: publicAgent(agent) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/:id/email/test — send a test message with the agent's SMTP settings.
 * Body: { to? } — defaults to fromAddress
 */
agentsRouter.post("/:id/email/test", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const to = String(req.body?.to || agent.email?.fromAddress || "").trim();
    const result = await sendAgentEmail(agent, {
      to,
      subject: `YamBot test · ${agent.name}`,
      text: `This is a test email from YamBot agent “${agent.name}”. SMTP is working.`,
    });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/:id/email/check — preview inbox (dashboard).
 */
agentsRouter.post("/:id/email/check", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const result = await checkAgentInbox(agent, {
      limit: req.body?.limit,
      unseenOnly: Boolean(req.body?.unseenOnly),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

agentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const containerName = agent.computer?.containerName || "";
    // Why: ask manager to stop the box before deleting the Mongo doc.
    agent.computer = agent.computer || {};
    agent.computer.desired = "stopped";
    agent.active = false;
    await agent.save();

    if (containerName) {
      try {
        const managerUrl = (
          process.env.COMPUTER_MANAGER_URL || "http://computer-manager:4050"
        ).replace(/\/$/, "");
        await fetch(`${managerUrl}/internal/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: containerName, agentId: String(agent._id) }),
        });
      } catch (err) {
        // Why: orphan cleanup in the manager loop still removes the box if this fails.
        console.warn("[agents] stop on delete failed", err?.message || err);
      }
    }

    await Agent.deleteOne({ _id: agent._id });
    res.json({
      ok: true,
      stoppedContainer: containerName,
    });
  } catch (err) {
    next(err);
  }
});
