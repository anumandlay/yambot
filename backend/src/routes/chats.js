/**
 * @fileoverview Chat routes — create threads, post goals, poll messages/tasks.
 * Purpose: Website UX for agent-bound chats and common (agent-agnostic) inbox.
 * Downstream: Chat/Message/Task/Agent models; cloud workers claim resulting tasks.
 */

import { Router } from "express";
import { Chat, Message, CHAT_KINDS } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { Agent, toAgentSnapshot, clearAgentNeedsAttention, clearAgentHumanControl } from "../models/Agent.js";
import { resolveAgentMention } from "../utils/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../utils/skillSlash.js";
import { createLearnedSkillDraft } from "../utils/skillLearn.js";
import { routeCommonChat } from "../utils/chatRouter.js";

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
 * Returns flat pending/actives plus per-agent groups for multi-worker UI.
 * @param {import("mongoose").Types.ObjectId | string} userId
 * @param {import("mongoose").Types.ObjectId | string} chatId
 */
async function loadChatScopedQueue(userId, chatId) {
  const [pending, actives] = await Promise.all([
    Task.find({ user: userId, chat: chatId, status: "pending" })
      .sort({ createdAt: 1 })
      .select("goal status createdAt chat message agent")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
    Task.find({
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

  const active = actives[0] || null;
  const groupsMap = new Map();

  /**
   * @param {object} task
   * @param {"pending"|"active"} bucket
   */
  function addToGroup(task, bucket) {
    const agentRef = task.agent;
    const agentId = String(agentRef?._id || agentRef || "unknown");
    if (!groupsMap.has(agentId)) {
      groupsMap.set(agentId, {
        agent: agentRef || null,
        pending: [],
        active: null,
      });
    }
    const group = groupsMap.get(agentId);
    if (bucket === "pending") group.pending.push(task);
    else if (!group.active) group.active = task;
  }

  for (const task of pending) addToGroup(task, "pending");
  for (const task of actives) addToGroup(task, "active");

  const groups = [...groupsMap.values()].sort((a, b) => {
    const aName = a.agent?.name || "";
    const bName = b.agent?.name || "";
    return aName.localeCompare(bName);
  });

  return { pending, active, actives, groups };
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
      .populate("defaultAgent", "name skill")
      .populate("lastDispatchAgent", "name skill")
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
 * PATCH /api/chats/:id — update common-chat settings (default agent pin, auto-route).
 * Body: { defaultAgentId?: string|null, autoRoute?: boolean }
 */
chatsRouter.patch("/:id", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    if (!isCommonChat(chat)) {
      res.status(400).json({
        ok: false,
        title: "Agent chat",
        detail: "Only common chats support router and default-agent settings.",
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "defaultAgentId")) {
      const raw = req.body.defaultAgentId;
      if (raw === null || raw === "") {
        chat.defaultAgent = null;
      } else {
        const agent = await Agent.findOne({ _id: raw, user: req.userId, active: true });
        if (!agent) {
          res.status(404).json({
            ok: false,
            title: "Agent not found",
            detail: "That agent does not exist or is inactive.",
          });
          return;
        }
        chat.defaultAgent = agent._id;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "autoRoute")) {
      chat.autoRoute = Boolean(req.body.autoRoute);
    }

    chat.updatedAt = new Date();
    await chat.save();
    const updated = await Chat.findById(chat._id)
      .populate("defaultAgent", "name skill")
      .populate("lastDispatchAgent", "name skill")
      .lean();
    res.json({ ok: true, chat: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/messages — user sends a goal; enqueues a Task with agent snapshot.
 * Body: { content, agentId? } — common chat resolves agent via @mention, body, pin, or last used.
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

    const learnCmd = parseLearnCommand(content);
    if (learnCmd) {
      const learned = await createLearnedSkillDraft(req.userId, {
        chatId: chat._id,
        name: learnCmd.name || undefined,
      });
      if (!learned) {
        res.status(404).json({
          ok: false,
          title: "No task to learn from",
          detail: "Run a goal in this chat first, then send /learn.",
          hint: "Completed tasks with trajectories become SKILL.md drafts.",
        });
        return;
      }
      const { skill } = learned;
      await Message.create({
        chat: chat._id,
        role: "user",
        content,
        meta: { kind: "learn", skillId: skill._id, skillName: skill.name },
      });
      const systemMessage = await Message.create({
        chat: chat._id,
        role: "system",
        content: `Learned draft skill “${skill.name}” (/${skill.slug}). Open Skills to edit triggers and promote to production.`,
        meta: { kind: "skill_learned", skillId: skill._id, slug: skill.slug },
      });
      chat.updatedAt = new Date();
      await chat.save();
      res.status(201).json({ ok: true, learned: true, skill, systemMessage });
      return;
    }

    const common = isCommonChat(chat);
    const autoRoute = common && chat.autoRoute !== false;
    const confirmRoute = Boolean(req.body?.confirmRoute);
    const bodyAgentId = req.body?.agentId ? String(req.body.agentId) : null;

    let agentDoc = null;
    let snapshot = null;
    let goalText = content;
    let mentionMeta = null;
    let invokedSkillDoc = null;
    let skillSlashMeta = null;
    let routerMeta = null;

    if (common) {
      const [userAgents, productionSkills, userDoc] = await Promise.all([
        Agent.find({ user: req.userId, active: true })
          .select("name skill instructions")
          .lean(),
        Skill.find({ user: req.userId, status: "production" })
          .select("name slug triggers description agent")
          .lean(),
        User.findById(req.userId),
      ]);

      const mention = resolveAgentMention(content, userAgents);
      let afterMention = mention.matched ? mention.strippedContent || content : content;
      if (mention.matched) {
        mentionMeta = {
          matched: true,
          agentName: mention.agentName,
          stripped: mention.strippedContent !== content,
        };
      }

      const slash = parseSkillSlash(afterMention);
      if (slash) {
        invokedSkillDoc = findSkillBySlash(productionSkills, slash.slug);
        if (!invokedSkillDoc) {
          res.status(404).json({
            ok: false,
            title: "Skill not found",
            detail: `No production skill matches /${slash.slug}.`,
            hint: "Set skill status to production and ensure slug matches (Skills → edit).",
          });
          return;
        }
        goalText = slash.goal;
        skillSlashMeta = {
          slug: slash.slug,
          skillId: invokedSkillDoc._id,
          skillName: invokedSkillDoc.name,
        };
      } else {
        goalText = afterMention;
      }

      let dispatchId = null;
      let dispatchSource = null;

      if (mention.matched && mention.agentId) {
        dispatchId = mention.agentId;
        dispatchSource = "mention";
      } else if (confirmRoute && bodyAgentId) {
        dispatchId = bodyAgentId;
        dispatchSource = "confirm";
      } else if (!autoRoute && bodyAgentId) {
        dispatchId = bodyAgentId;
        dispatchSource = "picker";
      } else if (invokedSkillDoc?.agent) {
        dispatchId = String(invokedSkillDoc.agent);
        dispatchSource = "skill_agent";
      } else if (autoRoute) {
        const routeGoal = String(goalText || afterMention || "").trim();
        const route = await routeCommonChat({
          user: userDoc,
          agents: userAgents,
          skills: productionSkills,
          goalText: routeGoal,
          invokedSkill: invokedSkillDoc,
        });
        if (route?.needsConfirm && !confirmRoute) {
          res.status(409).json({
            ok: false,
            needsConfirm: true,
            title: "Confirm agent",
            detail: `Route to ${route.agentName}? (${Math.round(route.confidence * 100)}% confidence)`,
            hint: route.reason,
            suggestion: route,
          });
          return;
        }
        if (route) {
          dispatchId = route.agentId;
          dispatchSource = "router";
          routerMeta = route;
        }
      }

      if (!dispatchId && !autoRoute && chat.defaultAgent) {
        dispatchId = String(chat.defaultAgent);
        dispatchSource = "default";
      }
      if (!dispatchId && bodyAgentId) {
        dispatchId = bodyAgentId;
        dispatchSource = dispatchSource || "picker";
      }
      if (!dispatchId && chat.lastDispatchAgent) {
        dispatchId = String(chat.lastDispatchAgent);
        dispatchSource = dispatchSource || "last";
      }
      if (!dispatchId && chat.defaultAgent) {
        dispatchId = String(chat.defaultAgent);
        dispatchSource = dispatchSource || "default";
      }

      if (!dispatchId) {
        res.status(400).json({
          ok: false,
          title: "Agent required",
          detail: "No agent could be routed for this goal.",
          hint: "Use @AgentName, enable auto-route, or pick an agent manually.",
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
      chat.lastDispatchAgent = agentDoc._id;
      mentionMeta = {
        ...(mentionMeta || { matched: false }),
        dispatchSource,
        router: routerMeta,
      };
    } else if (chat.agent) {
      goalText = content;
      const slash = parseSkillSlash(goalText);
      if (slash) {
        const productionSkills = await Skill.find({ user: req.userId, status: "production" })
          .select("name slug triggers description agent")
          .lean();
        invokedSkillDoc = findSkillBySlash(productionSkills, slash.slug);
        if (!invokedSkillDoc) {
          res.status(404).json({
            ok: false,
            title: "Skill not found",
            detail: `No production skill matches /${slash.slug}.`,
            hint: "Set skill status to production and ensure slug matches (Skills → edit).",
          });
          return;
        }
        goalText = slash.goal;
        skillSlashMeta = {
          slug: slash.slug,
          skillId: invokedSkillDoc._id,
          skillName: invokedSkillDoc.name,
        };
      }
      agentDoc = await Agent.findOne({ _id: chat.agent, user: req.userId });
      if (agentDoc) snapshot = toAgentSnapshot(agentDoc);
    }

    if (!goalText.trim()) {
      goalText = invokedSkillDoc?.description || invokedSkillDoc?.name || content;
    }

    if (!goalText.trim()) {
      res.status(400).json({
        ok: false,
        title: "Empty goal",
        detail: "Add instructions after @mention or /skill-slug.",
        hint: "Example: /crm-followup check Aanya Sharma",
      });
      return;
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
      chat.title = (goalText || content).slice(0, 60);
    }
    chat.updatedAt = new Date();
    await chat.save();

    const messageMeta = {};
    if (common) {
      Object.assign(messageMeta, {
        dispatchAgentId: snapshot?.id || String(agentDoc._id),
        dispatchAgentName: snapshot?.name || agentDoc.name,
        goalText,
        mention: mentionMeta,
        router: routerMeta,
      });
    }
    if (skillSlashMeta) {
      Object.assign(messageMeta, {
        invokedSkillId: skillSlashMeta.skillId,
        invokedSkillName: skillSlashMeta.skillName,
        skillSlug: skillSlashMeta.slug,
      });
    }

    const message = await Message.create({
      chat: chat._id,
      role: "user",
      content,
      meta: Object.keys(messageMeta).length ? messageMeta : null,
    });

    const task = await Task.create({
      user: req.userId,
      chat: chat._id,
      message: message._id,
      goal: goalText || content,
      agent: agentDoc._id,
      agentSnapshot: snapshot,
      invokedSkill: invokedSkillDoc?._id || null,
      runner: "cloud",
      status: "pending",
      events: [
        {
          type: "queued",
          payload: {
            goal: goalText || content,
            agentId: snapshot?.id || null,
            agentName: snapshot?.name || null,
            runner: "cloud",
            fromCommonChat: common,
            dispatchSource: mentionMeta?.dispatchSource || null,
            routerConfidence: routerMeta?.confidence ?? null,
            routerReason: routerMeta?.reason || null,
            invokedSkillId: invokedSkillDoc?._id || null,
            invokedSkillName: invokedSkillDoc?.name || null,
            skillSlug: skillSlashMeta?.slug || null,
          },
        },
      ],
    });

    const agentLabel = snapshot?.name ? ` as “${snapshot.name}”` : "";
    const skillLabel = invokedSkillDoc?.name ? ` with skill /${skillSlashMeta?.slug || invokedSkillDoc.slug}` : "";
    const routeLabel =
      routerMeta?.agentName && mentionMeta?.dispatchSource === "router"
        ? ` (auto-routed, ${Math.round((routerMeta.confidence || 0) * 100)}%)`
        : "";
    const queueHint =
      "Queued for this agent's cloud computer on the VPS (Playwright Chromium profile).";
    const agentNote = await Message.create({
      chat: chat._id,
      role: "system",
      content: `Goal queued${agentLabel}${skillLabel}${routeLabel}. ${queueHint}`,
      meta: {
        taskId: task._id,
        status: "pending",
        agentId: snapshot?.id || null,
        agentName: snapshot?.name || null,
        invokedSkillId: invokedSkillDoc?._id || null,
        invokedSkillName: invokedSkillDoc?.name || null,
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
