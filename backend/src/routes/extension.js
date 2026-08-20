/**
 * @fileoverview Extension worker API — claim tasks, push events, load runtime LLM config.
 * Purpose: Bridge between queued website goals and the Chrome agent loop.
 * Downstream: Task/Message/User; Chrome extension background worker.
 */

import { Router } from "express";
import { Task } from "../models/Task.js";
import { Message } from "../models/Chat.js";
import { User } from "../models/User.js";
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
        confirmBeforeSubmit: s.confirmBeforeSubmit !== false,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/extension/tasks/next
 * Atomically claims the oldest pending task for this user.
 */
extensionRouter.get("/tasks/next", async (req, res, next) => {
  try {
    const task = await Task.findOneAndUpdate(
      { user: req.userId, status: "pending" },
      { $set: { status: "running", claimedAt: new Date() }, $push: { events: { type: "claimed", payload: {} } } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!task) {
      res.json({ ok: true, task: null });
      return;
    }
    res.json({ ok: true, task });
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

    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});
