/**
 * @fileoverview Cloud worker API — claim tasks, push events, load runtime LLM config.
 * Purpose: Bridge between queued website goals and Playwright cloud workers on the VPS.
 * Downstream: Task/Message/User/Agent; `worker/` containers poll these routes.
 */

import { Router } from "express";
import { Task } from "../models/Task.js";
import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
import { Agent, appendAgentMemory, setAgentNeedsAttention, clearAgentNeedsAttention } from "../models/Agent.js";
import { Goal, recordGoalRun } from "../models/Goal.js";
import { SiteProfile, appendSiteHint, toSiteProfileSnapshot } from "../models/SiteProfile.js";
import { decryptSecret } from "../utils/crypto.js";
import { writeAudit } from "../utils/audit.js";
import { env } from "../utils/env.js";

export const workerRouter = Router();

/** Stuck `running` tasks older than this are requeued (LLM steps can take a while). */
const STUCK_RUNNING_MS = 5 * 60 * 1000;

/**
 * GET /api/worker/runtime-config
 * Returns decrypted LLM/DBC settings for the authenticated user (cloud workers only).
 */
workerRouter.get("/runtime-config", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const s = user.settings || {};
    res.json({
      ok: true,
      config: {
        llmApiKey: decryptSecret(s.llmApiKeyEnc || "") || env.DEFAULT_LLM_API_KEY || "",
        llmBaseUrl: s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL,
        llmModel: s.llmModel || env.DEFAULT_LLM_MODEL,
        visionApiKey: decryptSecret(s.visionApiKeyEnc || "") || "",
        visionBaseUrl: s.visionBaseUrl || "",
        visionModel: s.visionModel || "",
        dbcUsername: s.dbcUsername || "",
        dbcPassword: decryptSecret(s.dbcPasswordEnc || ""),
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Builds Mongo filter for claimable pending tasks for one cloud agent.
 * @param {string} userId
 * @param {{ agentId?: string|null }} opts
 * @returns {object}
 */
function buildClaimFilter(userId, opts = {}) {
  const filter = { user: userId, status: "pending" };
  if (opts.agentId) {
    filter.agent = opts.agentId;
  }
  return filter;
}

/**
 * Atomically claims the oldest matching pending task for this user/agent.
 * @param {string} userId
 * @param {{ agentId?: string|null }} [opts]
 */
async function claimNextTask(userId, opts = {}) {
  const stuckBefore = new Date(Date.now() - STUCK_RUNNING_MS);
  const stuckFilter = {
    user: userId,
    status: "running",
    $or: [{ claimedAt: { $lt: stuckBefore } }, { claimedAt: null }],
  };
  if (opts.agentId) stuckFilter.agent = opts.agentId;

  await Task.updateMany(stuckFilter, {
    $set: { status: "pending" },
    $push: {
      events: {
        type: "requeued",
        payload: { reason: "stuck_running_timeout" },
        at: new Date(),
      },
    },
  });

  const claimFilter = buildClaimFilter(userId, opts);
  return Task.findOneAndUpdate(
    claimFilter,
    {
      $set: {
        status: "running",
        claimedAt: new Date(),
      },
      $push: {
        events: {
          type: "claimed",
          payload: {
            claimAs: "cloud",
            agentId: opts.agentId || null,
          },
          at: new Date(),
        },
      },
    },
    { sort: { priorityRank: -1, createdAt: 1 }, new: true }
  );
}

/**
 * Parses claim options from query/body.
 * @param {import('express').Request} req
 */
function parseClaimOpts(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const agentId = String(body.agentId || req.query.agentId || "").trim() || null;
  return { agentId };
}

/**
 * GET/POST /api/worker/tasks/next
 * Body/query: { agentId? }
 */
workerRouter.get("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId, parseClaimOpts(req));
    res.json({ ok: true, task: task || null });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId, parseClaimOpts(req));
    res.json({ ok: true, task: task || null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/computer/heartbeat
 * Body: { agentId, workerName?, pageUrl?, taskId?, screenshotBase64?, mime? }
 * Why: cloud workers announce presence and stream a compressed JPEG for the live dashboard.
 */
workerRouter.post("/computer/heartbeat", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) {
      res.status(400).json({ ok: false, title: "agentId required", detail: "Missing agentId" });
      return;
    }
    const agent = await Agent.findOne({ _id: agentId, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
      return;
    }

    agent.computer = agent.computer || {};
    agent.computer.online = true;
    agent.computer.workerName = String(req.body?.workerName || agent.computer.workerName || "").slice(
      0,
      120
    );
    agent.computer.lastSeenAt = new Date();
    if (req.body?.pageUrl != null) {
      agent.computer.pageUrl = String(req.body.pageUrl).slice(0, 2000);
    }
    if (req.body?.taskId) {
      agent.computer.taskId = req.body.taskId;
    }
    if (req.body?.viewportWidth) {
      agent.computer.viewportWidth = Number(req.body.viewportWidth) || 1280;
    }
    if (req.body?.viewportHeight) {
      agent.computer.viewportHeight = Number(req.body.viewportHeight) || 800;
    }
    if (req.body?.screenshotWidth) {
      agent.computer.screenshotWidth = Number(req.body.screenshotWidth) || 1280;
    }
    if (req.body?.screenshotHeight) {
      agent.computer.screenshotHeight = Number(req.body.screenshotHeight) || 800;
    }
    if (req.body?.fullPage != null) {
      agent.computer.fullPageScreen = Boolean(req.body.fullPage);
    }

    const rawB64 = String(req.body?.screenshotBase64 || "");
    // Why: full-page JPEGs are larger than viewport shots — allow ~2MB base64.
    if (rawB64 && rawB64.length <= 2_500_000) {
      agent.liveScreen = {
        mime: String(req.body?.mime || "image/jpeg").slice(0, 64),
        dataBase64: rawB64.replace(/^data:[^;]+;base64,/, ""),
        at: new Date(),
      };
    }

    // Why: return + clear control queue atomically so dashboard takeover reaches the worker.
    const commands = Array.isArray(agent.controlQueue) ? [...agent.controlQueue] : [];
    agent.controlQueue = [];
    const humanControl = Boolean(agent.computer?.humanControl);
    await agent.save();

    res.json({
      ok: true,
      computer: {
        online: true,
        lastSeenAt: agent.computer.lastSeenAt,
        hasScreen: Boolean(agent.liveScreen?.dataBase64),
        humanControl,
      },
      humanControl,
      commands,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/worker/tasks/:id — refresh task (e.g. waiting for user_answer).
 */
workerRouter.get("/tasks/:id", async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/tasks/:id/events
 * Body: { type, payload?, status?, appendMessage? }
 */
workerRouter.post("/tasks/:id/events", async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    const type = String(req.body?.type || "event");
    const payload = req.body?.payload || {};
    task.events.push({ type, payload });
    if (req.body?.status) task.status = req.body.status;
    // Why: heartbeat so long LLM/browser steps do not look "stuck" to the reclaim timer.
    task.claimedAt = new Date();

    if (req.body?.appendMessage) {
      await Message.create({
        chat: task.chat,
        role: "agent",
        content: String(req.body.appendMessage),
        meta: { taskId: task._id, type, payload },
      });
    }

    if (type === "ask_user" && payload.question) {
      task.status = "waiting_user";
      await Message.create({
        chat: task.chat,
        role: "assistant",
        content: String(payload.question),
        meta: { taskId: task._id, kind: "ask_user" },
      });
      if (task.agent) {
        await setAgentNeedsAttention(task.agent, String(payload.question));
      }
    }

    if (type === "captcha") {
      const msg = String(req.body?.appendMessage || payload?.hint || payload?.error || "");
      const needsHuman =
        Boolean(payload?.needsHuman) ||
        /needs you|take control|could not solve|failed|not configured|needs_human/i.test(msg);
      if (needsHuman && task.agent) {
        await setAgentNeedsAttention(task.agent, msg || "CAPTCHA needs you");
      }
    }

    await task.save();
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/tasks/:id/complete
 * Body: { success, summary, error? }
 */
workerRouter.post("/tasks/:id/complete", async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    if (task.status === "cancelled") {
      if (task.agent) {
        await clearAgentNeedsAttention(task.agent);
      }
      res.json({ ok: true, task, alreadyCancelled: true });
      return;
    }
    const success = req.body?.success !== false;
    const summary = String(req.body?.summary || "");
    const error = String(req.body?.error || "");
    const trajectory = Array.isArray(req.body?.trajectory) ? req.body.trajectory.slice(0, 100) : [];
    const usageBody = req.body?.llmUsage;
    if (usageBody && typeof usageBody === "object") {
      task.llmUsage = {
        promptTokens: Number(usageBody.promptTokens) || 0,
        completionTokens: Number(usageBody.completionTokens) || 0,
        totalTokens: Number(usageBody.totalTokens) || 0,
        calls: Number(usageBody.calls) || 0,
        estimatedUsd: Number(usageBody.estimatedUsd) || 0,
      };
    }
    task.status = success ? "done" : "error";
    task.resultSummary = summary;
    task.lastError = error;
    task.completedAt = new Date();
    if (trajectory.length) task.trajectory = trajectory;
    task.events.push({
      type: "complete",
      payload: { success, summary, error },
    });
    await task.save();

    await Message.create({
      chat: task.chat,
      role: "assistant",
      content: summary || (success ? "Done." : error || "Failed."),
      meta: { taskId: task._id, kind: "result", success },
    });

    if (task.agent) {
      await clearAgentNeedsAttention(task.agent);
    }

    if (task.agent && (summary || error)) {
      const agentDoc = await Agent.findOne({ _id: task.agent, user: req.userId });
      if (agentDoc) {
        const memContent = success
          ? `Run completed. Goal: ${task.goal}\nResult: ${summary}`.slice(0, 2000)
          : `Run failed. Goal: ${task.goal}\nError: ${error || summary}`.slice(0, 2000);
        await appendAgentMemory(agentDoc, {
          kind: success ? "run" : "avoid",
          content: memContent,
          sourceTask: task._id,
        });
      }
    }

    if (task.goalRef) {
      const goalDoc = await Goal.findOne({ _id: task.goalRef, user: req.userId });
      if (goalDoc) {
        await recordGoalRun(goalDoc, success);
      }
    }

    await writeAudit({
      userId: req.userId,
      action: success ? "task.completed" : "task.failed",
      taskId: String(task._id),
      agentId: task.agent ? String(task.agent) : null,
      goalId: task.goalRef ? String(task.goalRef) : null,
      detail: (summary || error || "").slice(0, 500),
      meta: { llmUsage: task.llmUsage || {} },
    });

    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/worker/site-profile?agentId=&domain=
 */
workerRouter.get("/site-profile", async (req, res, next) => {
  try {
    const agentId = String(req.query?.agentId || "").trim();
    const domain = String(req.query?.domain || "")
      .trim()
      .toLowerCase();
    if (!agentId || !domain) {
      res.status(400).json({ ok: false, detail: "agentId and domain required" });
      return;
    }
    const agent = await Agent.findOne({ _id: agentId, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, detail: "Agent missing" });
      return;
    }
    const profile = await SiteProfile.findOne({ agent: agentId, domain });
    res.json({ ok: true, profile: profile ? toSiteProfileSnapshot(profile) : null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/site-profile
 */
workerRouter.post("/site-profile", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const domain = String(req.body?.domain || "")
      .trim()
      .toLowerCase();
    if (!agentId || !domain) {
      res.status(400).json({ ok: false, detail: "agentId and domain required" });
      return;
    }
    const agent = await Agent.findOne({ _id: agentId, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, detail: "Agent missing" });
      return;
    }
    let profile = await SiteProfile.findOne({ agent: agentId, domain });
    if (!profile) {
      profile = new SiteProfile({ user: req.userId, agent: agentId, domain });
    }
    profile.stats = profile.stats || { visits: 0, successes: 0, failures: 0 };
    profile.stats.visits = (profile.stats.visits || 0) + 1;
    if (req.body?.success === true) {
      profile.stats.successes = (profile.stats.successes || 0) + 1;
      profile.lastSuccessAt = new Date();
    } else if (req.body?.success === false) {
      profile.stats.failures = (profile.stats.failures || 0) + 1;
    }
    profile.lastVisitedAt = new Date();
    if (req.body?.hint?.content) {
      appendSiteHint(profile, req.body.hint);
    }
    await profile.save();
    res.json({ ok: true, profile: toSiteProfileSnapshot(profile) });
  } catch (err) {
    next(err);
  }
});

/**
 * Resolves the agent for email actions (worker must own the agent).
 * @param {import('express').Request} req
 */
async function loadEmailAgent(req) {
  const agentId = String(req.body?.agentId || req.query?.agentId || "").trim();
  if (!agentId) {
    const err = new Error("agentId required");
    err.status = 400;
    err.title = "Agent required";
    err.detail = "agentId is required for email actions.";
    throw err;
  }
  const agent = await Agent.findOne({ _id: agentId, user: req.userId });
  if (!agent) {
    const err = new Error("Agent missing");
    err.status = 404;
    err.title = "Not found";
    err.detail = "Agent missing";
    throw err;
  }
  return agent;
}

/**
 * POST /api/worker/email/send
 */
workerRouter.post("/email/send", async (req, res, next) => {
  try {
    const { sendAgentEmail } = await import("../utils/agentEmail.js");
    const agent = await loadEmailAgent(req);
    const result = await sendAgentEmail(agent, {
      to: req.body?.to,
      subject: req.body?.subject,
      text: req.body?.text,
      html: req.body?.html,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/email/check
 */
workerRouter.post("/email/check", async (req, res, next) => {
  try {
    const { checkAgentInbox } = await import("../utils/agentEmail.js");
    const agent = await loadEmailAgent(req);
    const result = await checkAgentInbox(agent, {
      limit: req.body?.limit,
      unseenOnly: Boolean(req.body?.unseenOnly),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
