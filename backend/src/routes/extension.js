/**
 * @fileoverview Browser worker API — claim tasks, push events, load runtime LLM config.
 * Purpose: Bridge between queued website goals and Chrome extension / Playwright cloud workers.
 * Downstream: Task/Message/User/Agent; extension SW + `worker/` cloud computers.
 */

import { Router } from "express";
import { Task } from "../models/Task.js";
import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
import { Agent, appendAgentMemory } from "../models/Agent.js";
import { decryptSecret } from "../utils/crypto.js";
import { env } from "../utils/env.js";

export const extensionRouter = Router();

/** Stuck `running` tasks older than this are requeued (LLM steps can take a while). */
const STUCK_RUNNING_MS = 5 * 60 * 1000;

/**
 * GET /api/extension/runtime-config
 * Returns decrypted LLM/DBC settings for the authenticated user (workers only).
 */
extensionRouter.get("/runtime-config", async (req, res, next) => {
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
 * Builds Mongo filter for claimable pending tasks.
 * Why: cloud workers own one agent; the laptop extension must not steal `runner: cloud` jobs.
 *
 * @param {string} userId
 * @param {{ agentId?: string|null, claimAs?: string }} opts
 * @returns {object}
 */
function buildClaimFilter(userId, opts = {}) {
  const claimAs = opts.claimAs === "cloud" ? "cloud" : "extension";
  const filter = { user: userId, status: "pending" };

  if (opts.agentId) {
    filter.agent = opts.agentId;
  }

  if (claimAs === "cloud") {
    // Cloud box: only this agent's tasks that allow cloud (or legacy missing runner).
    filter.$or = [
      { runner: { $in: ["cloud", "any"] } },
      { runner: { $exists: false } },
      { runner: null },
    ];
  } else {
    // Laptop extension: never take dedicated cloud-only agents.
    filter.$or = [
      { runner: { $in: ["extension", "any"] } },
      { runner: { $exists: false } },
      { runner: null },
    ];
  }

  return filter;
}

/**
 * Atomically claims the oldest matching pending task for this user.
 * @param {string} userId
 * @param {{ agentId?: string|null, claimAs?: string }} [opts]
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
            claimAs: opts.claimAs === "cloud" ? "cloud" : "extension",
            agentId: opts.agentId || null,
          },
          at: new Date(),
        },
      },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

/**
 * Parses claim options from query/body.
 * @param {import('express').Request} req
 */
function parseClaimOpts(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const agentId = String(body.agentId || req.query.agentId || "").trim() || null;
  const claimAsRaw = String(body.claimAs || req.query.claimAs || "extension").trim();
  const claimAs = claimAsRaw === "cloud" ? "cloud" : "extension";
  return { agentId, claimAs };
}

/**
 * GET/POST /api/extension/tasks/next
 * Body/query: { agentId?, claimAs?: "extension"|"cloud" }
 * Why POST exists: Chrome may cache GET and return stale `{ task: null }` (304).
 */
extensionRouter.get("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId, parseClaimOpts(req));
    res.json({ ok: true, task: task || null });
  } catch (err) {
    next(err);
  }
});

extensionRouter.post("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId, parseClaimOpts(req));
    res.json({ ok: true, task: task || null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/extension/computer/heartbeat
 * Body: { agentId, workerName?, pageUrl?, taskId?, screenshotBase64?, mime? }
 * Why: cloud workers announce presence and stream a compressed JPEG for the live dashboard.
 */
extensionRouter.post("/computer/heartbeat", async (req, res, next) => {
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

    const rawB64 = String(req.body?.screenshotBase64 || "");
    // Why: cap ~900KB base64 (~650KB JPEG) so Mongo docs stay manageable.
    if (rawB64 && rawB64.length <= 900_000) {
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
 * GET /api/extension/tasks/:id — refresh task (e.g. waiting for user_answer).
 */
extensionRouter.get("/tasks/:id", async (req, res, next) => {
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
 * POST /api/extension/tasks/:id/events
 * Body: { type, payload?, status?, appendMessage? }
 */
extensionRouter.post("/tasks/:id/events", async (req, res, next) => {
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

    // Why: surface ask_user into chat so the website can answer without the side panel.
    if (type === "ask_user" && payload.question) {
      task.status = "waiting_user";
      await Message.create({
        chat: task.chat,
        role: "assistant",
        content: String(payload.question),
        meta: { taskId: task._id, kind: "ask_user" },
      });
    }

    await task.save();
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/extension/tasks/:id/complete
 * Body: { success, summary, error? }
 */
extensionRouter.post("/tasks/:id/complete", async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    // Why: dashboard Stop already finalized the task — don't overwrite with a late complete.
    if (task.status === "cancelled") {
      res.json({ ok: true, task, alreadyCancelled: true });
      return;
    }
    const success = req.body?.success !== false;
    const summary = String(req.body?.summary || "");
    const error = String(req.body?.error || "");
    task.status = success ? "done" : "error";
    task.resultSummary = summary;
    task.lastError = error;
    task.completedAt = new Date();
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

    // Why: each completed run feeds the agent's long-term memory for future goals.
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

    res.json({ ok: true, task });
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
 * POST /api/extension/email/send — worker sends mail as the agent.
 * Body: { agentId, to, subject, text, html? }
 */
extensionRouter.post("/email/send", async (req, res, next) => {
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
 * POST /api/extension/email/check — worker reads inbox as the agent.
 * Body: { agentId, limit?, unseenOnly? }
 */
extensionRouter.post("/email/check", async (req, res, next) => {
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
