/**
 * @fileoverview Agent CRUD + remote control for YamBot cloud computers.
 * Purpose: Create agents (default cloud box), queue click/type takeover, expose live status.
 * Downstream: computer-manager provisions Docker; worker drains controlQueue; LiveScreen UI.
 */

import crypto from "node:crypto";
import { Router } from "express";
import { Agent, AGENT_MODES, AGENT_ROLES, SCHEDULE_INTERVALS, appendAgentMemory, clearAgentNeedsAttention } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { Chat, Message } from "../models/Chat.js";
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
import { SiteProfile, appendSiteHint, toSiteProfileSnapshot } from "../models/SiteProfile.js";
import { getPlatformSettings } from "../models/PlatformSettings.js";
import { debitWallet } from "../utils/wallet.js";
import { appendDemoStepIfActive } from "../utils/demoCapture.js";
import {
  appendDemoSessionStep,
  finishActiveDemoForAgent,
  startDemoSession,
} from "../utils/demoSession.js";
import { Demonstration } from "../models/Demonstration.js";
import { copyNameWithTimestamp } from "../utils/copyName.js";
import { EntityGroup } from "../models/EntityGroup.js";
import { draftAgentFromBrief } from "../utils/agentDraftFromBrief.js";

export const agentsRouter = Router();

/**
 * Whether a waiting_user prompt is resolved by Take control / Give control back.
 * @param {string} question
 * @returns {boolean}
 */
function isTakeControlHandoffQuestion(question) {
  return /take control|give control|live screen|captcha|bot check|solve it|needs you|needs_human/i.test(
    String(question || "")
  );
}

/**
 * When the user gives control back, unblock handoff-style waiting_user tasks immediately.
 * @param {import('mongoose').Types.ObjectId|string} agentId
 */
async function resumeHandoffWaitingTask(agentId) {
  const task = await Task.findOne({ agent: agentId, status: "waiting_user" }).sort({ updatedAt: -1 });
  if (!task) return;
  const events = task.events || [];
  let lastAskIdx = -1;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].type === "ask_user") lastAskIdx = i;
  }
  if (lastAskIdx < 0) return;
  const question = String(events[lastAskIdx]?.payload?.question || "");
  if (!isTakeControlHandoffQuestion(question)) return;
  const alreadyAnswered = events.slice(lastAskIdx + 1).some((e) => e.type === "user_answer");
  if (alreadyAnswered) return;
  task.events.push({
    type: "user_answer",
    payload: { answer: "continue", via: "handoff" },
  });
  task.status = "running";
  await task.save();
  await clearAgentNeedsAttention(agentId);
}

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
  return agent.active !== false;
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
  // Why: browser-only product — always cloud browser agent.
  if (!opts.partial) set("mode", "browser");
  if (body.instructions != null) set("instructions", String(body.instructions || "").trim());
  if (body.facts != null) set("facts", normalizeFacts(body.facts));
  if (body.successCriteria != null) {
    set("successCriteria", String(body.successCriteria || "").trim());
  }
  if (body.allowedDomains != null) set("allowedDomains", normalizeDomains(body.allowedDomains));
  if (body.startUrl != null) set("startUrl", String(body.startUrl || "").trim());
  // Why: cloud-only — runner is always cloud; ignore client overrides.
  if (!opts.partial) set("runner", "cloud");
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
      visionEnabled: body.autonomy.visionEnabled !== false,
    });
  }
  if (body.role != null) {
    const role = String(body.role || "worker");
    set("role", AGENT_ROLES.includes(role) ? role : "worker");
  }
  if (body.managedAgents != null && Array.isArray(body.managedAgents)) {
    set(
      "managedAgents",
      body.managedAgents.map((id) => String(id).trim()).filter(Boolean).slice(0, 20)
    );
  }
  if (body.policy != null && typeof body.policy === "object") {
    const p = body.policy;
    set("policy", {
      requireApprovalForSubmit: p.requireApprovalForSubmit === true,
      monthlyBudgetUsd: Math.max(0, Number(p.monthlyBudgetUsd) || 0),
      dailyBudgetUsd: Math.max(0, Number(p.dailyBudgetUsd) || 0),
      maxTaskMinutes: Math.max(0, Number(p.maxTaskMinutes) || 0),
      apiBudgetUsd: Math.max(0, Number(p.apiBudgetUsd) || 0),
      escalateWaitingMinutes: Math.max(5, Number(p.escalateWaitingMinutes) || 30),
      blockedUrlPatterns: Array.isArray(p.blockedUrlPatterns)
        ? p.blockedUrlPatterns.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)
        : [],
      httpAllowHosts: Array.isArray(p.httpAllowHosts)
        ? p.httpAllowHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean).slice(0, 100)
        : [],
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
  if (body.group != null || body.groupId != null) {
    const gid = body.group ?? body.groupId;
    set("group", gid ? String(gid) : null);
  }
  return out;
}

agentsRouter.get("/meta", (_req, res) => {
  res.json({
    ok: true,
    modes: AGENT_MODES,
    roles: AGENT_ROLES,
    scheduleIntervals: SCHEDULE_INTERVALS,
  });
});

/**
 * POST /api/agents/draft-from-brief — LLM fills persona/skill/instructions/success from plain English.
 * Body: { brief: string }
 */
agentsRouter.post("/draft-from-brief", async (req, res, next) => {
  try {
    const result = await draftAgentFromBrief(req.userId, req.body?.brief || req.body?.text || "");
    if (!result.ok) {
      res.status(result.title === "LLM not configured" ? 400 : 400).json(result);
      return;
    }
    res.json({ ok: true, draft: result.draft });
  } catch (err) {
    next(err);
  }
});

agentsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.groupId === "ungrouped") filter.group = null;
    else if (req.query.groupId) filter.group = String(req.query.groupId);
    const agents = await Agent.find(filter)
      .select("-liveScreen.dataBase64 -workerTokenEnc -workerTokenHash -controlQueue")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ ok: true, agents: agents.map(publicAgent) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/live-wall — all cloud-capable agents with live JPEG + attention flags.
 * Why: one poll drives the Live Wall grid (Zoom / Take control / red blink).
 */
agentsRouter.get("/live-wall", async (req, res, next) => {
  try {
    const agents = await Agent.find({
      user: req.userId,
      active: { $ne: false },
    })
      .select("-workerTokenEnc -workerTokenHash -controlQueue")
      .sort({ updatedAt: -1 })
      .lean();

    const agentIds = agents.map((a) => a._id);
    const waiting = await Task.find({
      user: req.userId,
      agent: { $in: agentIds },
      status: "waiting_user",
    })
      .select("agent events")
      .lean();

    /** @type {Map<string, string>} */
    const waitingReason = new Map();
    for (const t of waiting) {
      const id = String(t.agent);
      if (waitingReason.has(id)) continue;
      const asks = (t.events || []).filter((e) => e.type === "ask_user");
      const last = asks[asks.length - 1];
      waitingReason.set(
        id,
        String(last?.payload?.question || "Waiting for your reply").slice(0, 400)
      );
    }

    const now = Date.now();
    const screens = agents.map((a) => {
      const online = Boolean(
        a.computer?.lastSeenAt && now - new Date(a.computer.lastSeenAt).getTime() < 45_000
      );
      const screen = a.liveScreen || {};
      const flagged = Boolean(a.computer?.needsAttention) || waitingReason.has(String(a._id));
      const reason =
        (a.computer?.needsAttention && a.computer?.attentionReason) ||
        waitingReason.get(String(a._id)) ||
        "";
      return {
        id: String(a._id),
        name: a.name,
        runner: a.runner || "cloud",
        mode: a.mode || "browser",
        online,
        desired: a.computer?.desired || "stopped",
        provisionError: a.computer?.provisionError || "",
        pageUrl: a.computer?.pageUrl || "",
        taskId: a.computer?.taskId ? String(a.computer.taskId) : null,
        humanControl: Boolean(a.computer?.humanControl),
        needsAttention: flagged,
        attentionReason: String(reason).slice(0, 400),
        mime: screen.mime || "image/jpeg",
        dataBase64: screen.dataBase64 || "",
        capturedAt: screen.at || null,
        screenshotWidth: a.computer?.screenshotWidth || a.computer?.viewportWidth || 1280,
        screenshotHeight: a.computer?.screenshotHeight || a.computer?.viewportHeight || 800,
      };
    });

    screens.sort((x, y) => {
      if (x.needsAttention !== y.needsAttention) return x.needsAttention ? -1 : 1;
      if (x.online !== y.online) return x.online ? -1 : 1;
      return String(x.name).localeCompare(String(y.name));
    });

    res.json({
      ok: true,
      attentionCount: screens.filter((s) => s.needsAttention).length,
      screens,
    });
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
    fields.runner = "cloud";

    const settings = await getPlatformSettings();
    const agentPriceCents = Math.max(0, Number(settings.agentPriceCents) || 0);

    const agent = new Agent({ ...fields, user: req.userId });
    ensureWorkerCredentials(agent);
    syncComputerDesired(agent);

    /** @type {{ transaction?: { _id: unknown } } | null} */
    let debitResult = null;
    if (agentPriceCents > 0) {
      debitResult = await debitWallet({
        userId: req.userId,
        amountCents: agentPriceCents,
        type: "agent_create",
        note: `New agent: ${fields.name}`,
        meta: { agentName: fields.name, priceCents: agentPriceCents },
      });
    }

    try {
      await agent.save();
      if (debitResult?.transaction?._id) {
        const { WalletTransaction } = await import("../models/WalletTransaction.js");
        await WalletTransaction.findByIdAndUpdate(debitResult.transaction._id, {
          agent: agent._id,
        });
      }
    } catch (saveErr) {
      if (agentPriceCents > 0) {
        const { creditWallet } = await import("../utils/wallet.js");
        await creditWallet({
          userId: req.userId,
          amountCents: agentPriceCents,
          type: "refund",
          note: `Refund — agent create failed: ${fields.name}`,
          meta: { reason: saveErr.message },
        }).catch((refundErr) => console.error("[agents] refund after failed create", refundErr));
      }
      throw saveErr;
    }

    res.status(201).json({
      ok: true,
      agent: publicAgent(agent),
      provision: {
        desired: agent.computer?.desired,
        containerName: agent.computer?.containerName,
        hint:
          agent.computer?.desired === "running"
            ? "Cloud computer will start automatically via computer-manager (usually within ~30s)."
            : "Cloud computer is stopped for this agent.",
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
    const waiting = await Task.findOne({
      agent: agent._id,
      user: req.userId,
      status: "waiting_user",
    })
      .select("events")
      .lean();
    let waitingReason = "";
    if (waiting) {
      const asks = (waiting.events || []).filter((e) => e.type === "ask_user");
      const last = asks[asks.length - 1];
      waitingReason = String(last?.payload?.question || "Waiting for your reply").slice(0, 400);
    }
    const needsAttention = Boolean(agent.computer?.needsAttention) || Boolean(waiting);
    const attentionReason =
      (agent.computer?.needsAttention && agent.computer?.attentionReason) || waitingReason || "";
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
        needsAttention,
        attentionReason,
        attentionAt: agent.computer?.attentionAt || null,
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
      /** @type {import('mongoose').Document|null} */
      let demonstration = null;
      if (active) {
        /** Why: Take control is for CAPTCHA/handoff; Teach skill explicitly starts demo capture. */
        const shouldRecordDemo =
          Boolean(req.body?.teachSkill) || req.body?.recordDemo === true;
        if (shouldRecordDemo && !agent.computer.activeDemoId) {
          try {
            demonstration = await startDemoSession(req.userId, {
              agentId: agent._id,
              taskId: req.body?.taskId || null,
              title: req.body?.demoTitle || "Demonstration",
            });
            agent.computer.activeDemoId = demonstration._id;
            await appendDemoSessionStep(req.userId, String(demonstration._id), {
              observation: "Human took control",
              action: { type: "session", active: true },
              result: "recording",
            });
          } catch (err) {
            console.error("[agents] demo session start failed", err?.message || err);
          }
        } else if (agent.computer.activeDemoId) {
          demonstration = await Demonstration.findOne({
            _id: agent.computer.activeDemoId,
            user: req.userId,
          });
        }
      } else {
        await agent.save();
        demonstration = await finishActiveDemoForAgent(agent);
        await resumeHandoffWaitingTask(agent._id);
        res.json({
          ok: true,
          humanControl: active,
          queued: (agent.controlQueue || []).length,
          demonstration: demonstration
            ? {
                _id: demonstration._id,
                title: demonstration.title,
                stepCount: demonstration.steps?.length || 0,
              }
            : null,
        });
        return;
      }
      await agent.save();
      res.json({
        ok: true,
        humanControl: active,
        queued: (agent.controlQueue || []).length,
        demonstration: demonstration
          ? {
              _id: demonstration._id,
              title: demonstration.title,
              stepCount: demonstration.steps?.length || 0,
            }
          : null,
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
    await appendDemoStepIfActive(agent, {
      observation: agent.computer?.pageUrl || "",
      action: { type: cmd.type, ...cmd },
      result: "queued",
    });
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
      agent.set("email", fields.email);
      agent.markModified("email");
      delete fields.email;
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
 * GET /api/agents/:id/site-profiles — list per-domain hints for dashboard editing.
 */
agentsRouter.get("/:id/site-profiles", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const docs = await SiteProfile.find({ agent: agent._id, user: req.userId })
      .sort({ lastVisitedAt: -1 })
      .limit(40);
    res.json({
      ok: true,
      profiles: docs.map((d) => toSiteProfileSnapshot(d)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agents/:id/site-profiles/:domain/hints — manual hint from dashboard.
 */
agentsRouter.post("/:id/site-profiles/:domain/hints", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const domain = String(req.params.domain || "")
      .trim()
      .toLowerCase();
    if (!domain) {
      res.status(400).json({ ok: false, detail: "domain required" });
      return;
    }
    let profile = await SiteProfile.findOne({ agent: agent._id, domain });
    if (!profile) {
      profile = new SiteProfile({ user: req.userId, agent: agent._id, domain });
    }
    appendSiteHint(profile, {
      kind: req.body?.kind || "note",
      content: String(req.body?.content || ""),
    });
    profile.lastVisitedAt = new Date();
    await profile.save();
    res.json({ ok: true, profile: toSiteProfileSnapshot(profile) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/agents/:id/site-profiles/:domain — remove site memory for a domain.
 */
agentsRouter.delete("/:id/site-profiles/:domain", async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }
    const domain = String(req.params.domain || "")
      .trim()
      .toLowerCase();
    await SiteProfile.deleteOne({ agent: agent._id, user: req.userId, domain });
    res.json({ ok: true });
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

/**
 * POST /api/agents/:id/copy — duplicate config with timestamped name.
 */
agentsRouter.post("/:id/copy", async (req, res, next) => {
  try {
    const source = await Agent.findOne({ _id: req.params.id, user: req.userId });
    if (!source) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }

    const src = source.toObject();
    const scheduleEnabled = Boolean(src.schedule?.enabled && src.schedule?.goal);
    const fields = {
      name: copyNameWithTimestamp(src.name),
      description: src.description || "",
      profile: src.profile || "",
      skill: src.skill || "",
      mode: src.mode || "browser",
      instructions: src.instructions || "",
      facts: Array.isArray(src.facts) ? src.facts : [],
      autonomy: src.autonomy || {},
      role: src.role || "worker",
      managedAgents: Array.isArray(src.managedAgents) ? src.managedAgents : [],
      policy: src.policy || {},
      successCriteria: src.successCriteria || "",
      allowedDomains: Array.isArray(src.allowedDomains) ? src.allowedDomains : [],
      startUrl: src.startUrl || "",
      active: src.active !== false,
      group: src.group || null,
      runner: "cloud",
      memory: [],
      email: {
        enabled: Boolean(src.email?.enabled),
        fromName: src.email?.fromName || "",
        fromAddress: src.email?.fromAddress || "",
        smtpHost: src.email?.smtpHost || "",
        smtpPort: src.email?.smtpPort || 587,
        smtpSecure: Boolean(src.email?.smtpSecure),
        smtpUser: src.email?.smtpUser || "",
        smtpPasswordEnc: src.email?.smtpPasswordEnc || "",
        imapHost: src.email?.imapHost || "",
        imapPort: src.email?.imapPort || 993,
        imapSecure: src.email?.imapSecure !== false,
      },
      schedule: {
        enabled: scheduleEnabled,
        goal: src.schedule?.goal || "",
        interval: src.schedule?.interval || "1h",
        dailyAt: src.schedule?.dailyAt || "09:00",
        lastRunAt: null,
        nextRunAt: scheduleEnabled ? new Date() : null,
        chatId: null,
      },
    };

    if (fields.group) {
      const groupOk = await EntityGroup.exists({
        _id: fields.group,
        user: req.userId,
        type: "agent",
      });
      if (!groupOk) fields.group = null;
    }

    const settings = await getPlatformSettings();
    const agentPriceCents = Math.max(0, Number(settings.agentPriceCents) || 0);

    const agent = new Agent({ ...fields, user: req.userId });
    ensureWorkerCredentials(agent);
    syncComputerDesired(agent);

    /** @type {{ transaction?: { _id: unknown } } | null} */
    let debitResult = null;
    if (agentPriceCents > 0) {
      debitResult = await debitWallet({
        userId: req.userId,
        amountCents: agentPriceCents,
        type: "agent_create",
        note: `Copy agent: ${fields.name}`,
        meta: { agentName: fields.name, priceCents: agentPriceCents, copiedFrom: String(source._id) },
      });
    }

    try {
      await agent.save();
      if (debitResult?.transaction?._id) {
        const { WalletTransaction } = await import("../models/WalletTransaction.js");
        await WalletTransaction.findByIdAndUpdate(debitResult.transaction._id, {
          agent: agent._id,
        });
      }
    } catch (saveErr) {
      if (agentPriceCents > 0) {
        const { creditWallet } = await import("../utils/wallet.js");
        await creditWallet({
          userId: req.userId,
          amountCents: agentPriceCents,
          type: "refund",
          note: `Refund — agent copy failed: ${fields.name}`,
          meta: { reason: saveErr.message },
        }).catch((refundErr) => console.error("[agents] refund after failed copy", refundErr));
      }
      throw saveErr;
    }

    res.status(201).json({
      ok: true,
      agent: publicAgent(agent),
      copiedFrom: String(source._id),
    });
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
          body: JSON.stringify({
            name: containerName,
            agentId: String(agent._id),
            removeVolume: true,
          }),
        });
      } catch (err) {
        // Why: orphan cleanup in the manager loop still removes the box if this fails.
        console.warn("[agents] stop on delete failed", err?.message || err);
      }
    }

    const agentId = agent._id;
    const chatIds = await Chat.find({ agent: agentId, user: req.userId }).distinct("_id");
    await Promise.all([
      Message.deleteMany({ chat: { $in: chatIds } }),
      Task.deleteMany({ user: req.userId, $or: [{ agent: agentId }, { chat: { $in: chatIds } }] }),
      Chat.deleteMany({ _id: { $in: chatIds } }),
    ]);

    await Agent.deleteOne({ _id: agent._id });
    res.json({
      ok: true,
      stoppedContainer: containerName,
      removedVolume: Boolean(containerName),
      deletedChats: chatIds.length,
    });
  } catch (err) {
    next(err);
  }
});
