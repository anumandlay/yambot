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
import { Trigger } from "../models/Trigger.js";
import { SiteProfile, appendSiteHint, toSiteProfileSnapshot } from "../models/SiteProfile.js";
import { decryptSecret } from "../utils/crypto.js";
import { resolveLlmCredentials, resolveVisionLlmCredentials } from "../utils/llmCredentials.js";
import { writeAudit } from "../utils/audit.js";
import { getEffectivePolicy, isHttpHostAllowed, isUrlBlocked } from "../utils/policy.js";
import { evaluateTaskRun } from "../utils/evaluateTask.js";
import { Approval } from "../models/Approval.js";
import { pickHighestPriorityTask } from "../utils/priorityArbitrator.js";
import { unblockDependentTasks } from "../utils/enqueueTask.js";
import { emitEvent } from "../utils/eventBus.js";
import { Demonstration } from "../models/Demonstration.js";
import { TrainingRequest } from "../models/TrainingRequest.js";
import { Skill } from "../models/Skill.js";
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
    const agentId = String(req.query?.agentId || req.headers["x-yambot-agent-id"] || "").trim();
    let agentDoc = null;
    if (agentId) {
      agentDoc = await Agent.findOne({ _id: agentId, user: req.userId }).lean();
    }
    const policy = getEffectivePolicy(s, agentDoc);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const spendMatch = {
      user: req.userId,
      completedAt: { $gte: monthStart },
      status: { $in: ["done", "error"] },
    };
    if (agentId) spendMatch.agent = agentId;
    const [spendRow] = await Task.aggregate([
      { $match: spendMatch },
      { $group: { _id: null, usd: { $sum: "$llmUsage.estimatedUsd" } } },
    ]);
    const spentUsd = Number(spendRow?.usd) || 0;
    const budgetUsd = policy.monthlyBudgetUsd || 0;
    const budgetExceeded = budgetUsd > 0 && spentUsd >= budgetUsd;

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dailyMatch = {
      user: req.userId,
      completedAt: { $gte: dayStart },
      status: { $in: ["done", "error"] },
    };
    if (agentId) dailyMatch.agent = agentId;
    const [dailyRow] = await Task.aggregate([
      { $match: dailyMatch },
      { $group: { _id: null, usd: { $sum: "$llmUsage.estimatedUsd" } } },
    ]);
    const dailySpent = Number(dailyRow?.usd) || 0;
    const dailyBudget = policy.dailyBudgetUsd || 0;
    const dailyExceeded = dailyBudget > 0 && dailySpent >= dailyBudget;

    const mainCreds = await resolveLlmCredentials(user);
    const visionCreds = await resolveVisionLlmCredentials(user, mainCreds);

    res.json({
      ok: true,
      config: {
        llmApiKey: mainCreds.apiKey,
        llmAuthMode: mainCreds.authMode || "api_key",
        llmOAuthProvider: mainCreds.oauthProvider || "",
        llmOAuthAccount: mainCreds.oauthAccount || "",
        openAiAccountId: mainCreds.openAiAccountId || "",
        llmBaseUrl: mainCreds.llmBaseUrl || s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL,
        llmModel: mainCreds.llmModel || s.llmModel || env.DEFAULT_LLM_MODEL,
        visionApiKey: visionCreds.apiKey || "",
        visionBaseUrl: visionCreds.baseUrl || "",
        visionModel: visionCreds.model || "",
        dbcUsername: s.dbcUsername || "",
        dbcPassword: decryptSecret(s.dbcPasswordEnc || ""),
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
        policy,
        budget: {
          monthlyUsd: budgetUsd,
          spentUsd: Number(spentUsd.toFixed(4)),
          exceeded: budgetExceeded || dailyExceeded,
          dailyUsd: dailyBudget,
          dailySpentUsd: Number(dailySpent.toFixed(4)),
          dailyExceeded,
        },
        maxTaskMinutes: policy.maxTaskMinutes || 0,
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
  const candidates = await Task.find(claimFilter).sort({ createdAt: 1 }).limit(30).lean();
  const pick = pickHighestPriorityTask(candidates);
  if (!pick) return null;

  return Task.findOneAndUpdate(
    { _id: pick._id, status: "pending" },
    {
      $set: {
        status: "running",
        claimedAt: new Date(),
        startedAt: new Date(),
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

    if (type === "human_handoff") {
      const msg = String(payload.message || req.body?.appendMessage || "Take control on the live screen.");
      if (task.agent) {
        await setAgentNeedsAttention(task.agent, msg.slice(0, 220));
      }
    }

    if (type === "user_answer") {
      task.status = "running";
      if (task.agent) {
        await clearAgentNeedsAttention(task.agent);
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
    const evalResult = evaluateTaskRun({
      success,
      summary,
      error,
      trajectory: task.trajectory,
      llmUsage: task.llmUsage,
    });
    task.evaluation = {
      score: evalResult.score,
      summary: evalResult.summary,
      at: new Date(),
    };
    task.events.push({
      type: "complete",
      payload: { success, summary, error },
    });
    await task.save();
    await unblockDependentTasks(req.userId);
    await emitEvent({
      userId: req.userId,
      type: success ? "task.completed" : "task.failed",
      source: "task",
      agentId: task.agent,
      goalId: task.goalRef,
      taskId: task._id,
      summary: (summary || error || "").slice(0, 500),
      payload: { evaluationScore: task.evaluation?.score },
    });

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
        const customType = success
          ? String(goalDoc.completionEventType || "").trim()
          : String(goalDoc.completionEventOnFailure || "").trim();
        if (customType) {
          await emitEvent({
            userId: req.userId,
            type: customType,
            source: "goal",
            significance: success ? "medium" : "low",
            agentId: task.agent,
            goalId: task.goalRef,
            taskId: task._id,
            summary: (summary || error || goalDoc.title || "").slice(0, 500),
            payload: {
              goalTitle: goalDoc.title,
              success,
              chatId: task.chat ? String(task.chat) : null,
            },
          });
        }
      }
    }

    if (task.triggerRef) {
      const triggerDoc = await Trigger.findOne({ _id: task.triggerRef, user: req.userId });
      if (triggerDoc) {
        const customType = success
          ? String(triggerDoc.completionEventType || "").trim()
          : String(triggerDoc.completionEventOnFailure || "").trim();
        if (customType) {
          await emitEvent({
            userId: req.userId,
            type: customType,
            source: "trigger",
            significance: success ? "medium" : "low",
            agentId: task.agent,
            taskId: task._id,
            summary: (summary || error || triggerDoc.name || "").slice(0, 500),
            payload: {
              triggerId: String(triggerDoc._id),
              triggerName: triggerDoc.name,
              success,
              chatId: task.chat ? String(task.chat) : null,
            },
          });
        }
      }
    }

    await writeAudit({
      userId: req.userId,
      action: success ? "task.completed" : "task.failed",
      taskId: String(task._id),
      agentId: task.agent ? String(task.agent) : null,
      goalId: task.goalRef ? String(task.goalRef) : null,
      detail: (summary || error || "").slice(0, 500),
      meta: { llmUsage: task.llmUsage || {}, evaluationScore: task.evaluation?.score },
    });

    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/approvals/request
 * Body: { taskId, agentId, type?, question?, context? }
 */
workerRouter.post("/approvals/request", async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    const agentId = String(req.body?.agentId || "").trim();
    const type = String(req.body?.type || req.body?.kind || "submit").trim();
    const question = String(req.body?.question || req.body?.summary || "").slice(0, 2000);
    const context =
      req.body?.context && typeof req.body.context === "object"
        ? req.body.context
        : req.body?.payload && typeof req.body.payload === "object"
          ? req.body.payload
          : {};

    if (!taskId || !agentId) {
      res.status(400).json({ ok: false, title: "Bad request", detail: "taskId and agentId required" });
      return;
    }

    const task = await Task.findOne({ _id: taskId, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }

    const approval = await Approval.create({
      user: req.userId,
      task: taskId,
      agent: agentId,
      type,
      question,
      context,
      status: "pending",
    });

    task.status = "waiting_user";
    task.escalationLevel = task.escalationLevel || 0;
    task.events.push({
      type: "approval_requested",
      payload: { approvalId: String(approval._id), type, question },
    });
    await task.save();
    await setAgentNeedsAttention(agentId, question.slice(0, 200));

    await writeAudit({
      userId: req.userId,
      action: "approval.requested",
      taskId,
      agentId,
      detail: question.slice(0, 500),
      meta: { approvalId: String(approval._id), type },
    });

    res.json({ ok: true, approvalId: String(approval._id) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/worker/approvals/:id — poll until resolved.
 */
workerRouter.get("/approvals/:id", async (req, res, next) => {
  try {
    const approval = await Approval.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!approval) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Approval missing" });
      return;
    }
    res.json({
      ok: true,
      approval: {
        id: String(approval._id),
        status: approval.status,
        resolutionNote: approval.resolutionNote || "",
        resolvedAt: approval.resolvedAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/tools/http — server-side HTTP for integrations (policy-gated).
 */
workerRouter.post("/tools/http", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const agentId = String(req.body?.agentId || req.headers["x-yambot-agent-id"] || "").trim();
    let agentDoc = null;
    if (agentId) {
      agentDoc = await Agent.findOne({ _id: agentId, user: req.userId }).lean();
    }
    const policy = getEffectivePolicy(user.settings || {}, agentDoc);

    const method = String(req.body?.method || "GET").toUpperCase();
    const url = String(req.body?.url || "").trim();
    if (!url) {
      res.status(400).json({ ok: false, title: "Bad request", detail: "url required" });
      return;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ ok: false, title: "Bad request", detail: "Invalid URL" });
      return;
    }

    if (isUrlBlocked(url, policy.blockedUrlPatterns)) {
      res.status(403).json({ ok: false, title: "Blocked", detail: "URL blocked by policy" });
      return;
    }
    if (!isHttpHostAllowed(parsed.hostname, policy.httpAllowHosts)) {
      res.status(403).json({ ok: false, title: "Blocked", detail: "Host not in httpAllowHosts" });
      return;
    }

    const headers = req.body?.headers && typeof req.body.headers === "object" ? req.body.headers : {};
    const body = req.body?.body != null ? String(req.body.body) : undefined;
    const timeoutMs = Math.min(30_000, Math.max(1000, Number(req.body?.timeoutMs) || 15_000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method) ? undefined : body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const maxLen = 50_000;
    const truncated = text.length > maxLen;

    await writeAudit({
      userId: req.userId,
      action: "tool.http",
      agentId: agentId || null,
      detail: `${method} ${parsed.hostname}${parsed.pathname}`.slice(0, 500),
      meta: { status: response.status, truncated },
    });

    res.json({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      body: truncated ? text.slice(0, maxLen) : text,
      truncated,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      res.status(504).json({ ok: false, title: "Timeout", detail: "HTTP request timed out" });
      return;
    }
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

/**
 * GET /api/worker/skills — production skills for prompt injection (agent-scoped + global).
 */
workerRouter.get("/skills", async (req, res, next) => {
  try {
    const agentId = String(req.query.agentId || "").trim();
    const filter = { user: req.userId, status: "production" };
    if (agentId) {
      filter.$or = [{ agent: agentId }, { agent: null }];
    }
    const skills = await Skill.find(filter)
      .select("name description triggers steps verificationRules status agent")
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean();
    res.json({ ok: true, skills });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/demos/start — begin a human demonstration capture session.
 */
workerRouter.post("/demos/start", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const agent = await Agent.findOne({ _id: agentId, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, detail: "Agent missing" });
      return;
    }
    const demo = await Demonstration.create({
      user: req.userId,
      agent: agentId,
      task: req.body?.taskId || null,
      title: String(req.body?.title || "Demonstration").trim(),
      steps: [],
    });
    res.status(201).json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/demos/step — append one step to an active demonstration.
 */
workerRouter.post("/demos/step", async (req, res, next) => {
  try {
    const demoId = String(req.body?.demoId || "").trim();
    const demo = await Demonstration.findOne({ _id: demoId, user: req.userId });
    if (!demo) {
      res.status(404).json({ ok: false, detail: "Demonstration missing" });
      return;
    }
    demo.steps.push({
      observation: String(req.body?.observation || ""),
      action: req.body?.action || {},
      result: String(req.body?.result || ""),
      at: new Date(),
    });
    await demo.save();
    res.json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/demos/finish — finalize a demonstration capture.
 */
workerRouter.post("/demos/finish", async (req, res, next) => {
  try {
    const demoId = String(req.body?.demoId || "").trim();
    const demo = await Demonstration.findOne({ _id: demoId, user: req.userId });
    if (!demo) {
      res.status(404).json({ ok: false, detail: "Demonstration missing" });
      return;
    }
    if (req.body?.title) demo.title = String(req.body.title).trim();
    await demo.save();
    await emitEvent({
      userId: req.userId,
      type: "demo.captured",
      source: "worker",
      summary: `Demonstration captured: ${demo.title}`,
      payload: { demonstrationId: String(demo._id), agentId: String(demo.agent) },
      agentId: demo.agent,
      significance: "medium",
    });
    res.json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/worker/training/request — agent files a training request.
 */
workerRouter.post("/training/request", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const agent = await Agent.findOne({ _id: agentId, user: req.userId });
    if (!agent) {
      res.status(404).json({ ok: false, detail: "Agent missing" });
      return;
    }
    const request = await TrainingRequest.create({
      user: req.userId,
      agent: agentId,
      task: req.body?.taskId || null,
      workflow: String(req.body?.workflow || ""),
      observation: String(req.body?.observation || ""),
      recommendation: String(req.body?.recommendation || "Record a human demonstration"),
      status: "pending",
    });
    await emitEvent({
      userId: req.userId,
      type: "training.requested",
      source: "worker",
      summary: `Training requested for ${agent.name}`,
      payload: { requestId: String(request._id), workflow: request.workflow },
      agentId,
      significance: "medium",
    });
    res.status(201).json({ ok: true, request });
  } catch (err) {
    next(err);
  }
});
