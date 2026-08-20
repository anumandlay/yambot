/**
 * @fileoverview Extension worker API — claim tasks, push events, load runtime LLM config.
 * Purpose: Bridge between queued website goals and the Chrome agent loop.
 * Downstream: Task/Message/User; Chrome extension background worker.
 */

import { Router } from "express";
import { Task } from "../models/Task.js";
import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
import { Agent, appendAgentMemory } from "../models/Agent.js";
import { decryptSecret } from "../utils/crypto.js";

export const extensionRouter = Router();

/**
 * GET /api/extension/runtime-config
 * Returns decrypted LLM/DBC settings for the authenticated user (extension only).
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
        llmApiKey: decryptSecret(s.llmApiKeyEnc || ""),
        llmBaseUrl: s.llmBaseUrl || "https://api.openai.com/v1",
        llmModel: s.llmModel || "gpt-4o-mini",
        dbcUsername: s.dbcUsername || "",
        dbcPassword: decryptSecret(s.dbcPasswordEnc || ""),
        maxSteps: s.maxSteps ?? 25,
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET/POST /api/extension/tasks/next
 * Atomically claims the oldest pending task for this user.
 * Why POST exists: Chrome may cache GET and return stale `{ task: null }` (304).
 * Also reclaims tasks stuck in `running` for > 2 minutes (agent crashed / SW slept).
 */
async function claimNextTask(userId) {
  const stuckBefore = new Date(Date.now() - 30 * 1000);
  await Task.updateMany(
    {
      user: userId,
      status: "running",
      $or: [{ claimedAt: { $lt: stuckBefore } }, { claimedAt: null }],
    },
    {
      $set: { status: "pending" },
      $push: {
        events: {
          type: "requeued",
          payload: { reason: "stuck_running_timeout" },
          at: new Date(),
        },
      },
    }
  );

  return Task.findOneAndUpdate(
    { user: userId, status: "pending" },
    {
      $set: { status: "running", claimedAt: new Date() },
      $push: { events: { type: "claimed", payload: {}, at: new Date() } },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

extensionRouter.get("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId);
    res.json({ ok: true, task: task || null });
  } catch (err) {
    next(err);
  }
});

extensionRouter.post("/tasks/next", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const task = await claimNextTask(req.userId);
    res.json({ ok: true, task: task || null });
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
