/**
 * @fileoverview Chat routes — create threads, post goals, poll messages/tasks.
 * Purpose: Website UX for “new chat → enter goal → watch results”.
 * Downstream: Chat/Message/Task models; extension claims resulting tasks.
 */

import { Router } from "express";
import { Chat, Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";

export const chatsRouter = Router();

/**
 * GET /api/chats — list current user's chats (newest first).
 */
chatsRouter.get("/", async (req, res, next) => {
  try {
    const chats = await Chat.find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .select("title createdAt updatedAt")
      .lean();
    res.json({ ok: true, chats });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats — create empty chat.
 * Body: { title? }
 */
chatsRouter.post("/", async (req, res, next) => {
  try {
    const title = String(req.body?.title || "New chat").trim() || "New chat";
    const chat = await Chat.create({ user: req.userId, title });
    res.status(201).json({ ok: true, chat });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/chats/:id — chat + messages + related tasks.
 */
chatsRouter.get("/:id", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const [messages, tasks] = await Promise.all([
      Message.find({ chat: chat._id }).sort({ createdAt: 1 }).lean(),
      Task.find({ chat: chat._id }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ ok: true, chat, messages, tasks });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/messages — user sends a goal/instruction; enqueues a Task.
 * Body: { content }
 */
chatsRouter.post("/:id/messages", async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      res.status(400).json({
        ok: false,
        title: "Empty message",
        detail: "Enter a goal or instruction.",
      });
      return;
    }
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }

    // Why: first user message becomes the chat title for sidebar scanning.
    if (chat.title === "New chat") {
      chat.title = content.slice(0, 60);
    }
    chat.updatedAt = new Date();
    await chat.save();

    const message = await Message.create({
      chat: chat._id,
      role: "user",
      content,
    });

    const task = await Task.create({
      user: req.userId,
      chat: chat._id,
      message: message._id,
      goal: content,
      status: "pending",
      events: [{ type: "queued", payload: { goal: content } }],
    });

    const agentNote = await Message.create({
      chat: chat._id,
      role: "system",
      content:
        "Goal queued for your Chrome extension. Keep Chrome open with YamBot extension signed in.",
      meta: { taskId: task._id, status: "pending" },
    });

    res.status(201).json({ ok: true, message, task, systemMessage: agentNote });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/tasks/:taskId/answer — reply when agent asks the user.
 * Body: { answer }
 */
chatsRouter.post("/:id/tasks/:taskId/answer", async (req, res, next) => {
  try {
    const answer = String(req.body?.answer || "").trim();
    const task = await Task.findOne({
      _id: req.params.taskId,
      chat: req.params.id,
      user: req.userId,
    });
    if (!task) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    task.events.push({
      type: "user_answer",
      payload: { answer },
    });
    task.status = "running";
    await task.save();
    await Message.create({
      chat: task.chat,
      role: "user",
      content: answer,
      meta: { taskId: task._id, kind: "answer" },
    });
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});
