/**
 * @fileoverview Agent CRUD routes for the YamBot website.
 * Purpose: Let users create specialized browser agents (profile, skill, instructions, …).
 * Downstream: Chat creation binds an agent; tasks embed `agentSnapshot` for the extension.
 */

import { Router } from "express";
import { Agent, AGENT_SKILLS, AGENT_RUNNERS, appendAgentMemory } from "../models/Agent.js";

export const agentsRouter = Router();

/**
 * Normalizes facts from the client into [{key,value}].
 * @param {unknown} raw
 * @returns {{ key: string, value: string }[]}
 */
function normalizeFacts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      key: String(f?.key || "").trim(),
      value: String(f?.value || "").trim(),
    }))
    .filter((f) => f.key);
}

/**
 * Normalizes domain list (array or comma-separated string).
 * @param {unknown} raw
 * @returns {string[]}
 */
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
 * Maps request body → agent fields (create/update).
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
  if (body.skill != null) {
    const skill = String(body.skill || "general");
    set("skill", AGENT_SKILLS.includes(skill) ? skill : "general");
  }
  if (body.instructions != null) set("instructions", String(body.instructions || "").trim());
  if (body.facts != null) set("facts", normalizeFacts(body.facts));
  if (body.successCriteria != null) {
    set("successCriteria", String(body.successCriteria || "").trim());
  }
  if (body.allowedDomains != null) set("allowedDomains", normalizeDomains(body.allowedDomains));
  if (body.startUrl != null) set("startUrl", String(body.startUrl || "").trim());
  if (body.runner != null) {
    const runner = String(body.runner || "any");
    set("runner", AGENT_RUNNERS.includes(runner) ? runner : "any");
  }
  if (body.maxSteps != null) {
    const n = Number(body.maxSteps);
    set("maxSteps", Number.isFinite(n) ? Math.min(100, Math.max(5, n)) : 25);
  }
  if (body.active != null) set("active", Boolean(body.active));
  if (body.memory != null && Array.isArray(body.memory)) {
    // Why: allow manual edit/clear of memory from the Agents UI.
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
  return out;
}

/**
 * GET /api/agents/meta — skill enum for the UI.
 */
agentsRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, skills: AGENT_SKILLS, runners: AGENT_RUNNERS });
});

/**
 * GET /api/agents
 */
agentsRouter.get("/", async (req, res, next) => {
  try {
    // Why: omit huge liveScreen payloads from the list endpoint.
    const agents = await Agent.find({ user: req.userId })
      .select("-liveScreen.dataBase64")
      .sort({ updatedAt: -1 })
      .lean();
    const now = Date.now();
    const enriched = agents.map((a) => ({
      ...a,
      computer: {
        ...(a.computer || {}),
        // Why: workers heartbeat ~every 15s; treat stale as offline for the UI.
        online: Boolean(
          a.computer?.lastSeenAt && now - new Date(a.computer.lastSeenAt).getTime() < 45_000
        ),
      },
    }));
    res.json({ ok: true, agents: enriched });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents
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
    const agent = await Agent.create({ ...fields, user: req.userId });
    res.status(201).json({ ok: true, agent });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/:id
 */
agentsRouter.get("/:id", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId })
      .select("-liveScreen.dataBase64")
      .lean();
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const online = Boolean(
      agent.computer?.lastSeenAt &&
        Date.now() - new Date(agent.computer.lastSeenAt).getTime() < 45_000
    );
    res.json({
      ok: true,
      agent: {
        ...agent,
        computer: { ...(agent.computer || {}), online },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/:id/live — computer status + latest screenshot for the dashboard.
 */
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
        workerName: agent.computer?.workerName || "",
        lastSeenAt: agent.computer?.lastSeenAt || null,
        pageUrl: agent.computer?.pageUrl || "",
        taskId: agent.computer?.taskId || null,
        runner: agent.runner || "any",
        mime: screen.mime || "image/jpeg",
        dataBase64: screen.dataBase64 || "",
        capturedAt: screen.at || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/agents/:id
 */
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
    Object.assign(agent, fields);
    await agent.save();
    res.json({ ok: true, agent });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/:id/memory — append a manual memory note.
 * Body: { content, kind? }
 */
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
    res.json({ ok: true, agent });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/agents/:id/memory — clear all memory.
 */
agentsRouter.delete("/:id/memory", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    agent.memory = [];
    await agent.save();
    res.json({ ok: true, agent });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/agents/:id
 */
agentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await Agent.deleteOne({ _id: req.params.id, user: req.userId });
    if (!result.deletedCount) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
