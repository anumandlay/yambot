/**
 * @fileoverview Chat routes — create threads, post goals, poll messages/tasks.
 * Purpose: Website UX for agent-bound chats and common (agent-agnostic) inbox.
 * Downstream: Chat/Message/Task/Agent models; cloud workers claim resulting tasks.
 */

import { Router } from "express";
import { Chat, Message, CHAT_KINDS } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { Agent, toAgentSnapshot, clearAgentNeedsAttention, clearAgentHumanControl } from "../models/Agent.js";

export const chatsRouter = Router();

/**
 * @param {object} chat
 * @returns {boolean}
 */
function isCommonChat(chat) {
  return chat?.kind === "common" || (!chat?.agent && chat?.kind !== "agent");
}

/**
 * Pending FIFO queue + active run for one agent (shown in every chat bound to that agent).
 * @param {import("mongoose").Types.ObjectId | string | null | undefined} agentRef
 * @param {import("mongoose").Types.ObjectId | string} userId
 */
async function loadAgentQueue(userId, agentRef) {
  const agentId = agentRef?._id || agentRef;
  if (!agentId) {
    return { pending: [], active: null };
  }
  const [pending, active] = await Promise.all([
    Task.find({ user: userId, agent: agentId, status: "pending" })
      .sort({ createdAt: 1 })
      .select("goal status createdAt chat message agent")
      .populate("chat", "title kind")
      .lean(),
    Task.findOne({
      user: userId,
      agent: agentId,
      status: { $in: ["running", "waiting_user"] },
    })
      .sort({ claimedAt: -1, updatedAt: -1 })
      .select("goal status createdAt chat message resultSummary events agent")
      .populate("chat", "title kind")
      .lean(),
  ]);
  return { pending, active };
}

/**
 * Queue scoped to one chat thread (common inbox — tasks dispatched from this chat only).
 * @param {import("mongoose").Types.ObjectId | string} userId
 * @param {import("mongoose").Types.ObjectId | string} chatId
 */
async function loadChatScopedQueue(userId, chatId) {
  const [pending, active] = await Promise.all([
    Task.find({ user: userId, chat: chatId, status: "pending" })
      .sort({ createdAt: 1 })
      .select("goal status createdAt chat message agent")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
    Task.findOne({
      user: userId,
      chat: chatId,
      status: { $in: ["running", "waiting_user"] },
    })
      .sort({ updatedAt: -1 })
      .select("goal status createdAt chat message resultSummary events agent")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
  ]);
  return { pending, active };
}

/**
 * Ensures a task belongs to this chat context (agent-bound or common).
 * @param {object} chat
 * @param {object|null} task
 */
function taskMatchesChat(chat, task) {
  if (!task || !chat) return false;
  if (isCommonChat(chat)) {
    return String(task.chat) === String(chat._id);
  }
  if (!chat.agent) return false;
  return String(task.agent) === String(chat.agent);
}

/**
 * GET /api/chats — list current user's chats (newest first).
 */
chatsRouter.get("/", async (req, res, next) => {
  try {
    const chats = await Chat.find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .select("title agent kind createdAt updatedAt")
      .populate("agent", "name skill")
      .lean();
    res.json({ ok: true, chats });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats — create agent-bound or common chat.
 * Body: { title?, agentId?, kind?: "agent"|"common" }
 */
chatsRouter.post("/", async (req, res, next) => {
  try {
    const kind = CHAT_KINDS.includes(req.body?.kind) ? req.body.kind : "agent";
    if (kind === "common") {
      const title = String(req.body?.title || "").trim() || "Common chat";
      const chat = await Chat.create({
        user: req.userId,
        title,
        kind: "common",
        agent: null,
      });
      res.status(201).json({ ok: true, chat });
      return;
    }

    const agentId = req.body?.agentId;
    if (!agentId) {
      res.status(400).json({
        ok: false,
        title: "Agent required",
        detail: "Create or select an agent before starting an agent chat.",
        hint: "Use kind: common for a shared inbox, or pick an agent for a dedicated chat.",
      });
      return;
    }
    const agent = await Agent.findOne({ _id: agentId, user: req.userId, active: true });
    if (!agent) {
      res.status(404).json({
        ok: false,
        title: "Agent not found",
        detail: "That agent does not exist or is inactive.",
      });
      return;
    }
    const title =
      String(req.body?.title || "").trim() || `Chat · ${agent.name}`;
    const chat = await Chat.create({
      user: req.userId,
      title,
      kind: "agent",
      agent: agent._id,
    });
    res.status(201).json({ ok: true, chat });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/chats/:id — chat + messages + related tasks (+ agent queue).
 */
chatsRouter.get("/:id", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId })
      .populate("agent", "name skill runner")
      .lean();
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const common = isCommonChat(chat);
    const [messages, tasks, agentQueue] = await Promise.all([
      Message.find({ chat: chat._id }).sort({ createdAt: 1 }).lean(),
      Task.find({ chat: chat._id }).sort({ createdAt: -1 }).lean(),
      common
        ? loadChatScopedQueue(req.userId, chat._id)
        : loadAgentQueue(req.userId, chat.agent),
    ]);
    res.json({ ok: true, chat, messages, tasks, agentQueue, isCommon: common });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/messages — user sends a goal; enqueues a Task with agent snapshot.
 * Body: { content, agentId? } — agentId required for common chats.
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

    const common = isCommonChat(chat);
    let agentDoc = null;
    let snapshot = null;

    if (common) {
      const dispatchId = req.body?.agentId;
      if (!dispatchId) {
        res.status(400).json({
          ok: false,
          title: "Agent required",
          detail: "Pick which agent should run this goal.",
          hint: "Select an agent in the send box before sending.",
        });
        return;
      }
      agentDoc = await Agent.findOne({ _id: dispatchId, user: req.userId, active: true });
      if (!agentDoc) {
        res.status(404).json({
          ok: false,
          title: "Agent not found",
          detail: "That agent does not exist or is inactive.",
        });
        return;
      }
      snapshot = toAgentSnapshot(agentDoc);
    } else if (chat.agent) {
      agentDoc = await Agent.findOne({ _id: chat.agent, user: req.userId });
      if (agentDoc) snapshot = toAgentSnapshot(agentDoc);
    }

    if (!agentDoc) {
      res.status(400).json({
        ok: false,
        title: "No agent",
        detail: "This chat has no agent to run the goal.",
      });
      return;
    }

    // Why: one computer per agent — active runs block the box; a new goal must take over.
    const now = new Date();
    const active = await Task.find({
      agent: agentDoc._id,
      user: req.userId,
      status: { $in: ["waiting_user", "running"] },
    });
    for (const blocked of active) {
      blocked.status = "cancelled";
      blocked.completedAt = now;
      blocked.resultSummary = "Superseded by a newer goal";
      blocked.events.push({
        type: "cancelled",
        payload: { reason: "superseded_by_new_goal", byChat: String(chat._id) },
      });
      await blocked.save();
      await Message.create({
        chat: blocked.chat,
        role: "system",
        content: "Previous run cancelled — a newer goal was sent for this agent.",
        meta: { kind: "superseded", taskId: blocked._id },
      }).catch(() => {});
    }
    if (active.length) {
      await clearAgentNeedsAttention(agentDoc._id);
      await clearAgentHumanControl(agentDoc._id);
    }

    const defaultTitles = ["Chat ·", "New chat", "Common chat"];
    if (defaultTitles.some((prefix) => chat.title === prefix || chat.title.startsWith("Chat ·"))) {
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
      agent: agentDoc._id,
      agentSnapshot: snapshot,
      runner: "cloud",
      status: "pending",
      events: [
        {
          type: "queued",
          payload: {
            goal: content,
            agentId: snapshot?.id || null,
            agentName: snapshot?.name || null,
            runner: "cloud",
            fromCommonChat: common,
          },
        },
      ],
    });

    const agentLabel = snapshot?.name ? ` as “${snapshot.name}”` : "";
    const queueHint =
      "Queued for this agent's cloud computer on the VPS (Playwright Chromium profile).";
    const agentNote = await Message.create({
      chat: chat._id,
      role: "system",
      content: `Goal queued${agentLabel}. ${queueHint}`,
      meta: {
        taskId: task._id,
        status: "pending",
        agentId: snapshot?.id || null,
        agentName: snapshot?.name || null,
        runner: "cloud",
      },
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
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const task = await Task.findOne({
      _id: req.params.taskId,
      user: req.userId,
    });
    if (!task || !taskMatchesChat(chat, task)) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    task.events.push({
      type: "user_answer",
      payload: { answer },
    });
    task.status = "running";
    await task.save();
    if (task.agent) {
      await clearAgentNeedsAttention(task.agent);
    }
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

/**
 * PATCH /api/chats/:id/tasks/:taskId — edit a pending queued goal.
 * Body: { goal }
 */
chatsRouter.patch("/:id/tasks/:taskId", async (req, res, next) => {
  try {
    const goal = String(req.body?.goal || "").trim();
    if (!goal) {
      res.status(400).json({
        ok: false,
        title: "Empty goal",
        detail: "Enter goal text to save.",
      });
      return;
    }
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const task = await Task.findOne({
      _id: req.params.taskId,
      user: req.userId,
      status: "pending",
    });
    if (!task || !taskMatchesChat(chat, task)) {
      res.status(404).json({
        ok: false,
        title: "Not found",
        detail: "Queued task missing or not editable.",
        hint: "Only pending goals in this chat's queue can be edited.",
      });
      return;
    }
    task.goal = goal;
    task.events.push({
      type: "goal_edited",
      payload: { goal, byChat: String(chat._id) },
    });
    await task.save();
    await Message.findByIdAndUpdate(task.message, { content: goal }).catch(() => {});
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/chats/:id/tasks/:taskId — remove a pending goal from the queue.
 */
chatsRouter.delete("/:id/tasks/:taskId", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const task = await Task.findOne({
      _id: req.params.taskId,
      user: req.userId,
      status: "pending",
    });
    if (!task || !taskMatchesChat(chat, task)) {
      res.status(404).json({
        ok: false,
        title: "Not found",
        detail: "Queued task missing or already started.",
      });
      return;
    }
    const now = new Date();
    task.status = "cancelled";
    task.completedAt = now;
    task.resultSummary = "Removed from queue";
    task.events.push({
      type: "cancelled",
      payload: { reason: "user_removed_from_queue", byChat: String(chat._id) },
    });
    await task.save();
    await Message.create({
      chat: task.chat,
      role: "system",
      content: `Queued goal removed: “${task.goal.slice(0, 120)}”`,
      meta: { taskId: task._id, kind: "queue_removed" },
    }).catch(() => {});
    res.json({ ok: true, task: { id: task._id, status: task.status } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/stop — cancel active run (running / waiting_user).
 */
chatsRouter.post("/:id/stop", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const filter = {
      user: req.userId,
      status: { $in: ["running", "waiting_user"] },
    };
    if (isCommonChat(chat)) {
      filter.chat = chat._id;
    } else if (chat.agent) {
      filter.agent = chat.agent;
    } else {
      filter.chat = chat._id;
    }
    const active = await Task.find(filter);
    if (!active.length) {
      res.json({ ok: true, stopped: 0, tasks: [] });
      return;
    }
    const now = new Date();
    const agentIds = new Set();
    for (const task of active) {
      task.status = "cancelled";
      task.completedAt = now;
      task.resultSummary = "Stopped by user";
      task.events.push({
        type: "cancelled",
        payload: { reason: "user_stop" },
      });
      await task.save();
      if (task.agent) agentIds.add(String(task.agent));
    }
    for (const id of agentIds) {
      await clearAgentNeedsAttention(id);
      await clearAgentHumanControl(id);
    }
    await Message.create({
      chat: chat._id,
      role: "system",
      content: "Agent stopped by user.",
      meta: {
        kind: "stopped",
        taskIds: active.map((t) => t._id),
      },
    });
    chat.updatedAt = now;
    await chat.save();
    res.json({
      ok: true,
      stopped: active.length,
      tasks: active.map((t) => ({ id: t._id, status: t.status })),
    });
  } catch (err) {
    next(err);
  }
});
