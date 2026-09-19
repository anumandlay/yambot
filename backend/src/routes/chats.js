/**
 * @fileoverview Chat routes — create threads, post goals, poll messages/tasks.
 * Purpose: Website UX for agent-bound chats and common (agent-agnostic) inbox.
 * Downstream: Chat/Message/Task/Agent models; cloud workers claim resulting tasks.
 */

import { Router } from "express";
import mongoose from "mongoose";
import { Chat, Message, CHAT_KINDS } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { Agent, toAgentSnapshot, clearAgentNeedsAttention, clearAgentHumanControl } from "../models/Agent.js";
import { resolveAgentMention } from "../utils/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../utils/skillSlash.js";
import { createLearnedSkillDraft } from "../utils/skillLearn.js";
import { routeCommonChat } from "../utils/chatRouter.js";
import {
  classifyMessageIntent,
  refineMessageIntentWithLlm,
  answerChatQuestion,
  shouldRefineIntentWithLlm,
} from "../utils/messageIntent.js";
import { runChatAutoTurn, streamChatQuestion, formatAutoTimingSummary, defaultQueueAck } from "../utils/chatAutoTurn.js";
import { formatPeerAgentsBlock } from "../utils/agentMessageBus.js";
import { resolveLlmCredentialsForAgent } from "../utils/llmCredentials.js";
import {
  buildChatContextPrompt,
  refreshChatContextIfNeeded,
  withChatContext,
} from "../utils/chatContext.js";
import { ensureAgentChat } from "../utils/enqueueTask.js";
import { resolveHumanDisplayName } from "../utils/userPublic.js";

export const chatsRouter = Router();

/**
 * Rewrite ambiguous peer_ask text so the peer reports *their* work instead of
 * interpreting “ask what he did” as a relay instruction (which causes ping-pong).
 * @param {string} ask — stripped user text after @Peer
 * @param {string} peerName
 * @returns {string}
 */
function rewritePeerAskContent(ask, peerName) {
  const raw = String(ask || "").trim();
  const name = String(peerName || "peer").trim() || "peer";
  // “ask what he/she/they did …” → ask the peer about their own recent work.
  if (
    /\b(?:ask\s+)?what\s+(?:he|she|they|it)\s+(?:did|has\s+done|have\s+done)\b/i.test(raw) ||
    /\bask\s+(?:him|her|them)\s+what\s+(?:he|she|they)\s+did\b/i.test(raw) ||
    /\btake\s+(?:a\s+)?reply\s+from\s+(?:him|her|them)\b/i.test(raw)
  ) {
    return [
      `Report what work YOU (“${name}”) completed recently:`,
      `sites or tasks handled, key findings, blockers, and current status.`,
      `Answer from your own activity only — do not message another agent.`,
      `Reply with a concise structured summary.`,
    ].join(" ");
  }
  // Drop a leading “ask …” wrapper aimed at the bound agent, not the peer.
  const cleaned = raw.replace(/^(?:please\s+)?ask\s+/i, "").trim();
  return cleaned || raw || "Please help with this request.";
}

/**
 * @param {object} chat
 * @returns {boolean}
 */
function isCommonChat(chat) {
  return chat?.kind === "common" || (!chat?.agent && chat?.kind !== "agent");
}

/**
 * Whether the thread title is still a placeholder (or equals the account name stub).
 * Why: a chat titled “test” when the user’s signup name is also “test” looks like the speaker, not the goal.
 * @param {string} title
 * @param {string} [accountName]
 * @returns {boolean}
 */
function shouldAutoRenameChatTitle(title, accountName = "") {
  const t = String(title || "").trim();
  if (!t) return true;
  if (/^New chat$/i.test(t) || /^Common chat$/i.test(t) || /^Chat ·/i.test(t)) return true;
  const account = String(accountName || "").trim();
  if (account && t.toLowerCase() === account.toLowerCase()) return true;
  return false;
}

/**
 * Pending FIFO queue + active run for one agent (shown in every chat bound to that agent).
 * @param {import("mongoose").Types.ObjectId | string | null | undefined} agentRef
 * @param {import("mongoose").Types.ObjectId | string} userId
 */
async function loadAgentQueue(userId, agentRef) {
  const agentId = agentRef?._id || agentRef;
  if (!agentId) {
    return { pending: [], active: null, actives: [] };
  }
  const [pending, active] = await Promise.all([
    Task.find({ user: userId, agent: agentId, status: "pending" })
      .sort({ createdAt: 1 })
      .select("goal status createdAt chat message agent")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
    Task.findOne({
      user: userId,
      agent: agentId,
      status: { $in: ["running", "waiting_user", "waiting_peer"] },
    })
      .sort({ claimedAt: -1, updatedAt: -1 })
      .select("goal status createdAt chat message resultSummary events agent pendingPeerResults")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
  ]);
  return { pending, active, actives: active ? [active] : [] };
}

/**
 * Agent-chat queue: bound agent's work plus @mention-delegated tasks posted in this thread.
 * Why: user can @OtherAgent from WOM's chat — those tasks stay on this chat but run as the peer.
 * @param {import("mongoose").Types.ObjectId | string} userId
 * @param {import("mongoose").Types.ObjectId | string | null | undefined} agentRef
 * @param {import("mongoose").Types.ObjectId | string} chatId
 */
async function loadAgentChatQueue(userId, agentRef, chatId) {
  const agentId = agentRef?._id || agentRef;
  const base = await loadAgentQueue(userId, agentId);
  if (!chatId || !agentId) return base;

  const [extraPending, extraActives] = await Promise.all([
    Task.find({
      user: userId,
      chat: chatId,
      agent: { $ne: agentId },
      status: "pending",
    })
      .sort({ createdAt: 1 })
      .select("goal status createdAt chat message agent")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
    Task.find({
      user: userId,
      chat: chatId,
      agent: { $ne: agentId },
      status: { $in: ["running", "waiting_user", "waiting_peer"] },
    })
      .sort({ updatedAt: -1 })
      .select("goal status createdAt chat message resultSummary events agent pendingPeerResults")
      .populate("chat", "title kind")
      .populate("agent", "name")
      .lean(),
  ]);

  if (!extraPending.length && !extraActives.length) return base;

  const pending = [...base.pending, ...extraPending].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const actives = [...(base.actives || []), ...extraActives];
  // Why: prefer a run that belongs to this thread when watching live from this chat.
  const threadActive =
    actives.find((t) => String(t.chat?._id || t.chat) === String(chatId)) || actives[0] || null;

  const groupsMap = new Map();
  /**
   * @param {object} task
   * @param {"pending"|"active"} bucket
   */
  function addToGroup(task, bucket) {
    const agentRefRow = task.agent;
    const id = String(agentRefRow?._id || agentRefRow || "unknown");
    if (!groupsMap.has(id)) {
      groupsMap.set(id, { agent: agentRefRow || null, pending: [], active: null });
    }
    const group = groupsMap.get(id);
    if (bucket === "pending") group.pending.push(task);
    else if (!group.active) group.active = task;
  }
  for (const task of pending) addToGroup(task, "pending");
  for (const task of actives) addToGroup(task, "active");

  return {
    pending,
    active: threadActive,
    actives,
    groups: [...groupsMap.values()].sort((a, b) =>
      String(a.agent?.name || "").localeCompare(String(b.agent?.name || ""))
    ),
  };
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
      status: { $in: ["running", "waiting_user", "waiting_peer"] },
    })
      .sort({ updatedAt: -1 })
      .select("goal status createdAt chat message resultSummary events agent pendingPeerResults")
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

/** Default page size for chat lists and in-thread messages. */
const CHAT_PAGE_SIZE = 100;

/**
 * @param {unknown} raw
 * @param {number} [fallback]
 * @returns {number}
 */
function parseChatPageLimit(raw, fallback = CHAT_PAGE_SIZE) {
  if (raw === "0" || raw === "all") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

/**
 * Loads one page of messages (newest page by default).
 * Why: long LLM-trace threads must not send thousands of rows on every poll.
 * @param {import("mongoose").Types.ObjectId|string} chatId
 * @param {{ limit?: number, before?: string, after?: string }} [opts]
 * @returns {Promise<{ messages: object[], hasMore: boolean }>}
 */
async function loadMessagePage(chatId, opts = {}) {
  const limit = opts.limit != null ? opts.limit : CHAT_PAGE_SIZE;
  const filter = { chat: chatId };
  if (opts.after && mongoose.isValidObjectId(opts.after)) {
    filter._id = { $gt: opts.after };
    const messages = await Message.find(filter).sort({ _id: 1 }).limit(limit).lean();
    return { messages, hasMore: false };
  }
  if (opts.before && mongoose.isValidObjectId(opts.before)) {
    filter._id = { $lt: opts.before };
  }
  const batch = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = batch.length > limit;
  const messages = batch.slice(0, limit).reverse();
  return { messages, hasMore };
}

/**
 * GET /api/chats — list current user's chats (newest first, paged).
 * Query: limit (default 100, 0/all = no cap), before (chat id).
 * Why: attach live activity so the list shows which threads have a running/queued browser job.
 */
chatsRouter.get("/", async (req, res, next) => {
  try {
    const limit = parseChatPageLimit(req.query.limit);
    const before = String(req.query.before || "").trim();
    const filter = { user: req.userId };
    if (before && mongoose.isValidObjectId(before)) {
      const pivot = await Chat.findOne({ _id: before, user: req.userId })
        .select("updatedAt")
        .lean();
      if (pivot) {
        filter.$or = [
          { updatedAt: { $lt: pivot.updatedAt } },
          { updatedAt: pivot.updatedAt, _id: { $lt: before } },
        ];
      }
    }

    let query = Chat.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .select("title agent kind createdAt updatedAt")
      .populate("agent", "name skill avatarMime avatarBase64");
    if (limit > 0) query = query.limit(limit + 1);
    const found = await query.lean();
    const hasMore = limit > 0 && found.length > limit;
    const chats = hasMore ? found.slice(0, limit) : found;

    const liveTasks = await Task.find({
      user: req.userId,
      chat: { $in: chats.map((c) => c._id) },
      status: { $in: ["pending", "running", "waiting_user", "waiting_peer"] },
    })
      .select("chat status goal updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    /** Prefer running / waiting_user / waiting_peer over pending when a thread has both. */
    const rank = { running: 4, waiting_user: 3, waiting_peer: 2, pending: 1 };
    /** @type {Map<string, { status: string, goal: string }>} */
    const liveByChat = new Map();
    for (const t of liveTasks) {
      const cid = String(t.chat);
      const prev = liveByChat.get(cid);
      const nextRank = rank[t.status] || 0;
      if (!prev || nextRank > (rank[prev.status] || 0)) {
        liveByChat.set(cid, {
          status: t.status,
          goal: String(t.goal || "").slice(0, 120),
        });
      }
    }

    const enriched = chats.map((c) => ({
      ...c,
      live: liveByChat.get(String(c._id)) || null,
    }));

    res.json({ ok: true, chats: enriched, hasMore });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats — open/create agent-bound chat (one per agent) or common chat.
 * Body: { title?, agentId?, kind?: "agent"|"common" }
 * Why: agent chats reuse the sole thread via ensureAgentChat — never spawn a second human inbox.
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
    const preferredTitle = String(req.body?.title || "").trim() || agent.name;
    const chat = await ensureAgentChat(req.userId, agent._id, {
      agentName: agent.name,
      title: preferredTitle,
    });
    res.status(201).json({ ok: true, chat });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/chats/:id — chat + one page of messages + related tasks (+ agent queue).
 * Query: limit (default 100), before (older than message id), after (newer than message id).
 */
chatsRouter.get("/:id", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId })
      .populate("agent", "name skill runner avatarMime avatarBase64")
      .populate("defaultAgent", "name skill")
      .populate("lastDispatchAgent", "name skill")
      .lean();
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }
    const common = isCommonChat(chat);
    const limit = parseChatPageLimit(req.query.limit);
    const before = String(req.query.before || "").trim();
    const after = String(req.query.after || "").trim();
    const [page, tasks, agentQueue] = await Promise.all([
      loadMessagePage(chat._id, {
        limit: limit || CHAT_PAGE_SIZE,
        before: before || undefined,
        after: after || undefined,
      }),
      // Why: never ship full event blobs for every historical task — that made chat polls ~10–20MB
      // and left the Send button on “Sending…” while the browser downloaded the payload.
      Task.find({ chat: chat._id })
        .sort({ createdAt: -1 })
        .limit(40)
        .select(
          "goal status createdAt updatedAt claimedAt chat message agent resultSummary pendingPeerResults lastError"
        )
        .lean()
        .then(async (rows) => {
          const activeIds = rows
            .filter((t) =>
              ["running", "waiting_user", "waiting_peer"].includes(String(t.status || ""))
            )
            .map((t) => t._id);
          if (!activeIds.length) return rows;
          const withEvents = await Task.find({ _id: { $in: activeIds } })
            .select("_id events pendingPeerResults")
            .lean();
          const byId = new Map(withEvents.map((t) => [String(t._id), t]));
          return rows.map((t) => {
            const full = byId.get(String(t._id));
            if (!full) return t;
            return {
              ...t,
              events: full.events || [],
              pendingPeerResults: full.pendingPeerResults || t.pendingPeerResults,
            };
          });
        }),
      common
        ? loadChatScopedQueue(req.userId, chat._id)
        : loadAgentChatQueue(req.userId, chat.agent, chat._id),
    ]);
    res.json({
      ok: true,
      chat,
      messages: page.messages,
      messagesHasMore: page.hasMore,
      tasks,
      agentQueue,
      isCommon: common,
    });
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
 * Agent chats: leading @PeerName asks this agent to message_agent that peer (does not switch agents).
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
    /** Why: agent-chat @Peer means message_agent that peer — force a computer goal, do not switch agents. */
    let peerAskForced = false;

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
          pickSource: "slash",
          pickReason: `You typed /${slash.slug} in the goal (explicit slash invoke).`,
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
      // Why: in an agent chat, @Peer is "ask/message that peer" — keep THIS agent as owner.
      // Switching agentDoc (old delegate-dispatch) made @Website Inspector run as WI, who then
      // messaged the wrong peer (e.g. Market researcher) and started the wrong computer.
      const userAgents = await Agent.find({ user: req.userId, active: true })
        .select("name skill instructions")
        .lean();
      const mention = resolveAgentMention(content, userAgents);
      let afterMention = content;
      if (mention.matched && mention.agentId) {
        afterMention = mention.strippedContent || "";
      }

      const slash = parseSkillSlash(afterMention);
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
          pickSource: "slash",
          pickReason: `You typed /${slash.slug} in the goal (explicit slash invoke).`,
        };
      } else {
        goalText = afterMention;
      }

      const boundId = String(chat.agent);
      agentDoc = await Agent.findOne({ _id: chat.agent, user: req.userId });

      if (mention.matched && mention.agentId && String(mention.agentId) !== boundId) {
        const peerName = String(mention.agentName || "peer").trim() || "peer";
        const askRaw =
          String(goalText || afterMention || "").trim() ||
          "Please help with this request.";
        const ask = rewritePeerAskContent(askRaw, peerName);
        const wantsReply =
          /\b(reply|respond|answer|wait|get back|report back|take (?:their |his |her |the )?reply|and (?:tell|let) me)\b/i.test(
            content
          ) || /\bask\b/i.test(content);
        goalText = [
          `You must call message_agent to “${peerName}” (use that exact name) exactly once.`,
          wantsReply
            ? `Use wait:true so you receive their finish result before you finish.`
            : `Prefer wait:true if the user expects an answer back; otherwise wait:false is ok.`,
          `Send them this message content:`,
          ask,
          `Do not message any other agent. Do not browse the web unless “${peerName}” cannot help.`,
          `When a PEER RESULT note arrives, summarize it for the user and call finish immediately.`,
          `Do NOT call message_agent again after you already have a peer result.`,
        ].join("\n");
        mentionMeta = {
          matched: true,
          agentName: peerName,
          peerAgentId: String(mention.agentId),
          stripped: mention.strippedContent !== content,
          dispatchSource: "peer_ask",
          wantsReply,
          peerContentRewritten: ask !== askRaw,
        };
        peerAskForced = true;
      } else if (mention.matched) {
        mentionMeta = {
          matched: true,
          agentName: mention.agentName,
          stripped: mention.strippedContent !== content,
          dispatchSource: "self",
        };
      }

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

    // Why: Hermes-style Auto — one model turn (reply vs queue_goal), not a separate classify LLM.
    // Answer/Computer toggles still force paths; slash skills always queue.
    // Agent-chat @Peer ask forces queue so Auto cannot reassign the wrong peer.
    const forceGoal =
      Boolean(req.body?.forceGoal) || Boolean(req.body?.asGoal) || peerAskForced;
    const forceAsk = Boolean(req.body?.forceAsk) || Boolean(req.body?.asQuestion);
    const wantStream = Boolean(req.body?.stream) || String(req.query?.stream || "") === "1";
    const useHermesAuto = !forceGoal && !forceAsk && !invokedSkillDoc;
    /** @type {object|null} */
    let precreatedUserMessage = null;
    /** @type {string} */
    let autoAck = "";
    /** @type {object|null} */
    let autoTiming = null;

    let classification = classifyMessageIntent(goalText || content, {
      forceGoal,
      forceAsk,
      hasSkillSlash: Boolean(invokedSkillDoc),
    });

    /** @type {null | ((obj: object) => void)} */
    let writeNdjson = null;
    const startNdjson = () => {
      if (writeNdjson) return;
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      writeNdjson = (obj) => {
        if (res.writableEnded) return;
        res.write(`${JSON.stringify(obj)}\n`);
        if (typeof res.flush === "function") res.flush();
      };
    };

    // Legacy refine only when not using Hermes Auto (should rarely run).
    if (!useHermesAuto && shouldRefineIntentWithLlm(classification)) {
      try {
        const userForLlm = await User.findById(req.userId);
        const classifyCreds = await resolveLlmCredentialsForAgent(userForLlm, agentDoc);
        if (classifyCreds.apiKey) {
          const recentMsgs = await Message.find({ chat: chat._id })
            .sort({ _id: -1 })
            .limit(6)
            .select("role content")
            .lean();
          const recentTurns = [...recentMsgs]
            .reverse()
            .map((m) => `${m.role}: ${String(m.content || "").slice(0, 200)}`)
            .join("\n");
          classification = await refineMessageIntentWithLlm(
            classification.text || goalText,
            classifyCreds,
            { agentName: agentDoc.name, recentTurns }
          );
        } else if (classification.intent === "ambiguous") {
          classification = {
            intent: "goal",
            confidence: 0.5,
            reason: "ambiguous_no_llm_default_goal",
            text: classification.text,
          };
        }
      } catch {
        if (classification.intent === "ambiguous") {
          classification = {
            intent: "goal",
            confidence: 0.5,
            reason: "classify_failed_default_goal",
            text: classification.text,
          };
        }
      }
    }

    if (useHermesAuto) {
      const questionText = goalText || content;
      const owner = await User.findById(req.userId).select("name curatedMemory email");
      if (shouldAutoRenameChatTitle(chat.title, owner?.name)) {
        chat.title = questionText.slice(0, 60);
      }
      chat.updatedAt = new Date();
      await chat.save();

      const messageMeta = {
        intent: "auto",
        intentReason: "hermes_auto_turn",
        senderName: resolveHumanDisplayName(owner),
      };
      if (common || mentionMeta?.matched) {
        if (mentionMeta?.dispatchSource === "peer_ask") {
          Object.assign(messageMeta, {
            peerAsk: true,
            peerAgentId: mentionMeta.peerAgentId,
            peerAgentName: mentionMeta.agentName,
            goalText: questionText,
            mention: mentionMeta,
          });
        } else {
          Object.assign(messageMeta, {
            dispatchAgentId: String(agentDoc._id),
            dispatchAgentName: agentDoc.name,
            goalText: questionText,
            mention: mentionMeta,
            router: routerMeta,
          });
        }
      }

      const message = await Message.create({
        chat: chat._id,
        role: "user",
        content,
        meta: messageMeta,
      });

      if (wantStream) {
        startNdjson();
        writeNdjson({ type: "user_message", message });
      }

      const busyRun = await Task.findOne({
        agent: agentDoc._id,
        user: req.userId,
        status: { $in: ["running", "waiting_user"] },
      })
        .select("_id status")
        .lean();

      let turn;
      let answerError = null;
      let qaCreds = null;
      try {
        const userForLlm = await User.findById(req.userId);
        qaCreds = await resolveLlmCredentialsForAgent(userForLlm, agentDoc);
        if (!qaCreds.apiKey) {
          throw Object.assign(new Error("No LLM credentials configured"), {
            title: "LLM not configured",
            hint: "Add an LLM key in Settings, or use Computer mode / /run …",
          });
        }
        // Why: never block the first chat token on a summary LLM — use current context, refresh later.
        const { block: chatContextBlock } = await buildChatContextPrompt(chat, {
          excludeIds: [String(message._id)],
          creds: qaCreds,
        });
        void refreshChatContextIfNeeded(chat, qaCreds).catch(() => {});
        const { normalizeEntries } = await import("../utils/curatedMemory.js");
        const userCuratedEntries = normalizeEntries(userForLlm?.curatedMemory?.entries);
        const agentCuratedEntries = normalizeEntries(agentDoc.curatedMemory?.entries);
        const qaSnapshot = withChatContext(
          toAgentSnapshot(agentDoc, {
            goal: questionText,
            userCuratedEntries,
            agentCuratedEntries,
          }),
          chatContextBlock
        );
        turn = await runChatAutoTurn({
          question: questionText,
          snapshot: qaSnapshot,
          creds: qaCreds,
          chatContext: chatContextBlock,
          stream: wantStream,
          onDelta: wantStream
            ? (chunk) => writeNdjson({ type: "delta", text: chunk })
            : undefined,
          // Why: light Hermes-style loop — lookups only; never starts Playwright from chat tools.
          runtime: {
            checkRunStatus: async () => {
              const [active, pendingCount] = await Promise.all([
                Task.findOne({
                  agent: agentDoc._id,
                  user: req.userId,
                  status: { $in: ["running", "waiting_user"] },
                })
                  .select("_id status goal updatedAt")
                  .lean(),
                Task.countDocuments({
                  agent: agentDoc._id,
                  user: req.userId,
                  status: "pending",
                }),
              ]);
              return {
                ok: true,
                agentName: agentDoc.name,
                active: active
                  ? {
                      taskId: String(active._id),
                      status: active.status,
                      goal: String(active.goal || "").slice(0, 240),
                      updatedAt: active.updatedAt,
                    }
                  : null,
                pendingCount,
                busy: Boolean(active),
              };
            },
            listPeerAgents: async () => {
              const block = await formatPeerAgentsBlock(
                req.userId,
                String(agentDoc._id),
                40
              );
              /** @type {string[]} */
              const peers = [];
              for (const line of String(block || "").split("\n")) {
                const m = line.match(/^\s*-\s+(.+?)(?:\s*\([^)]*\))?\s*$/);
                if (m) peers.push(m[1].trim());
              }
              return {
                ok: true,
                agentName: agentDoc.name,
                peers,
                peerBlockPreview: String(block || "").slice(0, 1200),
              };
            },
          },
        });
      } catch (err) {
        answerError = err;
        turn = {
          action: "reply",
          content:
            `I could not complete that turn. ${String(err?.message || err)}\n\n` +
            `Try Computer mode for a browser goal, or fix LLM settings.`,
          goal: "",
          ack: "",
          reason: "auto_turn_error",
        };
      }

      if (turn.action === "queue_goal") {
        // Fall through to computer enqueue with the model's (or heuristic) goal text.
        goalText = String(turn.goal || questionText).trim() || questionText;
        classification = {
          intent: "goal",
          confidence: 0.95,
          reason: turn.reason || "hermes_auto_queue_goal",
          text: goalText,
        };
        autoTiming = turn.timing || null;
        // Why: always show a short ack — model ack, or a clear default (never silent queue).
        autoAck =
          String(turn.ack || turn.content || "").trim() ||
          defaultQueueAck(goalText, agentDoc.name);
        if (wantStream) {
          if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
          writeNdjson({
            type: "routing",
            action: "queue_goal",
            goal: goalText,
            ack: autoAck,
            timing: autoTiming,
          });
        }
        // Why: user message already saved — reuse it in the goal enqueue path.
        precreatedUserMessage = message;
      } else {
        const assistantContent =
          String(turn.content || "").trim() ||
          "I am here — ask a question or send a computer goal.";
        autoTiming = turn.timing || null;
        const timingLine = formatAutoTimingSummary(autoTiming);
        const assistantMessage = await Message.create({
          chat: chat._id,
          role: "assistant",
          content: assistantContent,
          meta: {
            kind: "chat_qa",
            intent: "question",
            intentReason: turn.reason || "hermes_auto_reply",
            intentConfidence: 0.9,
            agentId: String(agentDoc._id),
            agentName: agentDoc.name,
            answeredWhileBusy: Boolean(busyRun),
            hermesAuto: true,
            hermesTiming: autoTiming || undefined,
            error: answerError ? String(answerError.message || answerError) : undefined,
          },
        });
        const systemMessage = await Message.create({
          chat: chat._id,
          role: "system",
          content: [
            busyRun
              ? `Answered in chat (Hermes Auto — no computer). The current browser run continues.`
              : `Answered in chat (Hermes Auto — no computer).`,
            timingLine ? `Timing: ${timingLine}` : null,
          ]
            .filter(Boolean)
            .join(" "),
          meta: {
            kind: "intent_question",
            ui: "icon",
            intentReason: turn.reason || "hermes_auto_reply",
            agentId: String(agentDoc._id),
            agentName: agentDoc.name,
            answeredWhileBusy: Boolean(busyRun),
            hermesAuto: true,
            hermesTiming: autoTiming || undefined,
          },
        });
        if (qaCreds?.apiKey) {
          void refreshChatContextIfNeeded(chat, qaCreds).catch(() => {});
        }
        if (wantStream) {
          if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
          writeNdjson({
            type: "result",
            ok: true,
            intent: "question",
            message,
            assistantMessage,
            systemMessage,
            task: null,
            timing: autoTiming,
          });
          res.end();
          return;
        }
        res.status(201).json({
          ok: true,
          intent: "question",
          message,
          assistantMessage,
          systemMessage,
          task: null,
          timing: autoTiming,
        });
        return;
      }
    } else if (classification.intent === "question") {
      const questionText = classification.text || goalText || content;
      const owner = await User.findById(req.userId).select("name curatedMemory email");
      if (shouldAutoRenameChatTitle(chat.title, owner?.name)) {
        chat.title = questionText.slice(0, 60);
      }
      chat.updatedAt = new Date();
      await chat.save();

      const messageMeta = {
        intent: "question",
        intentReason: classification.reason,
        intentConfidence: classification.confidence,
        senderName: resolveHumanDisplayName(owner),
      };
      if (common) {
        Object.assign(messageMeta, {
          dispatchAgentId: String(agentDoc._id),
          dispatchAgentName: agentDoc.name,
          goalText: questionText,
          mention: mentionMeta,
          router: routerMeta,
        });
      }

      const message = await Message.create({
        chat: chat._id,
        role: "user",
        content,
        meta: messageMeta,
      });

      if (wantStream) {
        startNdjson();
        writeNdjson({ type: "user_message", message });
      }

      const busyRun = await Task.findOne({
        agent: agentDoc._id,
        user: req.userId,
        status: { $in: ["running", "waiting_user"] },
      })
        .select("_id status")
        .lean();

      let assistantContent;
      let answerError = null;
      let qaCreds = null;
      try {
        const userForLlm = await User.findById(req.userId);
        qaCreds = await resolveLlmCredentialsForAgent(userForLlm, agentDoc);
        if (!qaCreds.apiKey) {
          throw Object.assign(new Error("No LLM credentials configured"), {
            title: "LLM not configured",
            hint: "Add an LLM key in Settings, or send /run … to use the computer.",
          });
        }
        await refreshChatContextIfNeeded(chat, qaCreds);
        const { block: chatContextBlock } = await buildChatContextPrompt(chat, {
          excludeIds: [String(message._id)],
          creds: qaCreds,
        });
        const { normalizeEntries } = await import("../utils/curatedMemory.js");
        const userCuratedEntries = normalizeEntries(userForLlm?.curatedMemory?.entries);
        const agentCuratedEntries = normalizeEntries(agentDoc.curatedMemory?.entries);
        const qaSnapshot = withChatContext(
          toAgentSnapshot(agentDoc, {
            goal: questionText,
            userCuratedEntries,
            agentCuratedEntries,
          }),
          chatContextBlock
        );
        if (wantStream) {
          assistantContent = await streamChatQuestion({
            question: questionText,
            snapshot: qaSnapshot,
            creds: qaCreds,
            chatContext: chatContextBlock,
            onDelta: (chunk) => writeNdjson({ type: "delta", text: chunk }),
          });
        } else {
          assistantContent = await answerChatQuestion({
            question: questionText,
            snapshot: qaSnapshot,
            creds: qaCreds,
            chatContext: chatContextBlock,
          });
        }
      } catch (err) {
        answerError = err;
        assistantContent =
          `I treated that as a question (no computer). ${String(err?.message || err)}\n\n` +
          `Send the same request with /run … to use the browser, or fix LLM settings.`;
        if (wantStream) writeNdjson({ type: "delta", text: assistantContent });
      }

      const assistantMessage = await Message.create({
        chat: chat._id,
        role: "assistant",
        content: assistantContent,
        meta: {
          kind: "chat_qa",
          intent: "question",
          intentReason: classification.reason,
          intentConfidence: classification.confidence,
          agentId: String(agentDoc._id),
          agentName: agentDoc.name,
          answeredWhileBusy: Boolean(busyRun),
          error: answerError ? String(answerError.message || answerError) : undefined,
        },
      });

      const systemMessage = await Message.create({
        chat: chat._id,
        role: "system",
        content: busyRun
          ? `Answered as a question from memory (no computer). The current browser run continues.`
          : `Answered as a question (no computer).`,
        meta: {
          kind: "intent_question",
          ui: "icon",
          intentReason: classification.reason,
          intentConfidence: classification.confidence,
          agentId: String(agentDoc._id),
          agentName: agentDoc.name,
          answeredWhileBusy: Boolean(busyRun),
        },
      });

      if (qaCreds?.apiKey) {
        void refreshChatContextIfNeeded(chat, qaCreds).catch(() => {});
      }

      if (wantStream) {
        writeNdjson({
          type: "result",
          ok: true,
          intent: "question",
          message,
          assistantMessage,
          systemMessage,
          task: null,
        });
        res.end();
        return;
      }

      res.status(201).json({
        ok: true,
        intent: "question",
        message,
        assistantMessage,
        systemMessage,
        task: null,
      });
      return;
    }

    // Why: one computer per agent — keep the active run; new goals wait in the pending FIFO queue.
    const activeRun = await Task.findOne({
      agent: agentDoc._id,
      user: req.userId,
      status: { $in: ["waiting_user", "running"] },
    })
      .select("_id status goal")
      .lean();

    const owner = await User.findById(req.userId).select("name curatedMemory email");
    if (!precreatedUserMessage && shouldAutoRenameChatTitle(chat.title, owner?.name)) {
      chat.title = (goalText || content).slice(0, 60);
    }
    chat.updatedAt = new Date();
    await chat.save();

    const messageMeta = {
      senderName: resolveHumanDisplayName(owner),
      intent: "goal",
      intentReason: classification.reason,
      intentConfidence: classification.confidence,
    };
    if (common || mentionMeta?.matched) {
      if (mentionMeta?.dispatchSource === "peer_ask") {
        Object.assign(messageMeta, {
          peerAsk: true,
          peerAgentId: mentionMeta.peerAgentId,
          peerAgentName: mentionMeta.agentName,
          goalText,
          mention: mentionMeta,
        });
      } else {
        Object.assign(messageMeta, {
          dispatchAgentId: snapshot?.id || String(agentDoc._id),
          dispatchAgentName: snapshot?.name || agentDoc.name,
          goalText,
          mention: mentionMeta,
          router: routerMeta,
        });
      }
    }
    if (skillSlashMeta) {
      Object.assign(messageMeta, {
        invokedSkillId: skillSlashMeta.skillId,
        invokedSkillName: skillSlashMeta.skillName,
        skillSlug: skillSlashMeta.slug,
        pickSource: skillSlashMeta.pickSource,
        pickReason: skillSlashMeta.pickReason,
        skillPick: {
          source: "slash",
          skillId: String(skillSlashMeta.skillId),
          skillName: skillSlashMeta.skillName,
          slug: skillSlashMeta.slug,
          reason: skillSlashMeta.pickReason,
        },
      });
    }

    const message =
      precreatedUserMessage ||
      (await Message.create({
        chat: chat._id,
        role: "user",
        content,
        meta: Object.keys(messageMeta).length ? messageMeta : null,
      }));

    /** @type {object|null} */
    let autoAckMessage = null;
    if (autoAck) {
      autoAckMessage = await Message.create({
        chat: chat._id,
        role: "assistant",
        content: autoAck,
        meta: {
          kind: "chat_qa",
          intent: "goal",
          intentReason: classification.reason,
          hermesAuto: true,
          agentId: String(agentDoc._id),
          agentName: agentDoc.name,
        },
      });
    }

    // Why: rebuild snapshot with final goal + this chat’s session context for the worker.
    snapshot = toAgentSnapshot(agentDoc, { goal: goalText || content });
    try {
      const userForCtx = await User.findById(req.userId);
      const ctxCreds = await resolveLlmCredentialsForAgent(userForCtx, agentDoc);
      // Why: never delay queue ack / stream end on a summary LLM call.
      const { block: chatContextBlock } = await buildChatContextPrompt(chat, {
        excludeIds: [String(message._id)],
        creds: ctxCreds,
      });
      snapshot = withChatContext(snapshot, chatContextBlock);
      void refreshChatContextIfNeeded(chat, ctxCreds).catch(() => {});
    } catch (err) {
      console.warn("[chats] chat context pack failed:", err?.message || err);
    }

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
            hermesTiming: autoTiming || null,
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
    const slashPickHint = skillSlashMeta?.pickReason
      ? ` ${skillSlashMeta.pickReason}`
      : "";
    const queueHint = activeRun
      ? `Agent is busy (${activeRun.status}) — this goal is pending and will start when the current run finishes.`
      : snapshot?.mode === "api"
        ? "Queued for API agent (no live computer — saves VPS RAM)."
        : "Queued for this agent's cloud computer on the VPS (Playwright Chromium profile).";
    const timingLine = formatAutoTimingSummary(autoTiming);
    const agentNote = await Message.create({
      chat: chat._id,
      role: "system",
      content: [
        `Goal queued${agentLabel}${skillLabel}${routeLabel}.${slashPickHint} ${queueHint}`,
        timingLine ? `Timing: ${timingLine}` : null,
      ]
        .filter(Boolean)
        .join(" "),
      meta: {
        taskId: task._id,
        kind: "queued",
        ui: "icon",
        status: "pending",
        intent: "goal",
        intentReason: classification.reason,
        intentConfidence: classification.confidence,
        agentId: snapshot?.id || null,
        agentName: snapshot?.name || null,
        mode: snapshot?.mode || "browser",
        queuedBehindActive: Boolean(activeRun),
        activeTaskId: activeRun?._id || null,
        invokedSkillId: invokedSkillDoc?._id || null,
        invokedSkillName: invokedSkillDoc?.name || null,
        skillSlug: skillSlashMeta?.slug || null,
        skillPick: skillSlashMeta
          ? {
              source: "slash",
              skillId: String(skillSlashMeta.skillId),
              skillName: skillSlashMeta.skillName,
              slug: skillSlashMeta.slug,
              reason: skillSlashMeta.pickReason,
            }
          : null,
        runner: "cloud",
        hermesAuto: Boolean(autoTiming),
        hermesTiming: autoTiming || undefined,
      },
    });

    if (snapshot?.mode === "api" && !activeRun) {
      const { kickApiAgent } = await import("../utils/apiAgentRunner.js");
      kickApiAgent(agentDoc._id, req.userId);
    }

    if (wantStream && writeNdjson) {
      if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
      writeNdjson({
        type: "result",
        ok: true,
        intent: "goal",
        message,
        assistantMessage: autoAckMessage || undefined,
        task,
        systemMessage: agentNote,
        timing: autoTiming,
      });
      res.end();
      return;
    }

    res.status(201).json({
      ok: true,
      intent: "goal",
      message,
      assistantMessage: autoAckMessage || undefined,
      task,
      systemMessage: agentNote,
      timing: autoTiming,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chats/:id/tasks/:taskId/inject — mid-run chat to a running agent (v2).
 * Body: { content }
 * Why: while A is running (e.g. waiting async on B), the human can steer A without queuing a new goal.
 */
chatsRouter.post("/:id/tasks/:taskId/inject", async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      res.status(400).json({
        ok: false,
        title: "Empty message",
        detail: "Enter a note for the running agent.",
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
    });
    if (!task || !taskMatchesChat(chat, task)) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Task missing" });
      return;
    }
    if (task.status === "waiting_user") {
      res.status(409).json({
        ok: false,
        title: "Agent is asking you",
        detail: "Use the composer to answer the agent’s question (not inject).",
        hint: "Send your reply in the same box — it posts as an answer.",
      });
      return;
    }
    if (task.status !== "running") {
      res.status(409).json({
        ok: false,
        title: "No running task",
        detail: `Task is ${task.status} — inject only works while the agent is running.`,
      });
      return;
    }

    const owner = await User.findById(req.userId).select("name curatedMemory email");
    const message = await Message.create({
      chat: chat._id,
      role: "user",
      content,
      meta: {
        kind: "operator_inject",
        taskId: String(task._id),
        agentId: task.agent ? String(task.agent) : null,
        senderName: resolveHumanDisplayName(owner),
      },
    });

    const { injectOperatorMessage } = await import("../utils/agentMessageBus.js");
    const injected = await injectOperatorMessage({
      taskId: String(task._id),
      userId: req.userId,
      content,
      messageId: String(message._id),
    });
    if (!injected.ok) {
      res.status(409).json({
        ok: false,
        title: "Inject failed",
        detail: injected.note || "Could not inject into running task",
      });
      return;
    }

    const systemMessage = await Message.create({
      chat: chat._id,
      role: "system",
      content: "Sent to the running agent — they will see it on their next step.",
      meta: {
        kind: "operator_inject_ack",
        ui: "icon",
        taskId: String(task._id),
      },
    });

    chat.updatedAt = new Date();
    await chat.save();

    res.status(201).json({
      ok: true,
      injected: true,
      message,
      systemMessage,
      taskId: String(task._id),
    });
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
    const isApi = task.agentSnapshot?.mode === "api";
    if (isApi) {
      // Why: API runner exited on ask_user — re-queue with the answer so the loop continues.
      task.goal = `USER ANSWER (continue the previous API run):\n${answer}\n\nORIGINAL GOAL:\n${task.goal}`;
      task.status = "pending";
      task.claimedAt = null;
    } else {
      task.status = "running";
    }
    await task.save();
    if (task.agent) {
      await clearAgentNeedsAttention(task.agent);
    }
    const owner = await User.findById(req.userId).select("name curatedMemory email");
    await Message.create({
      chat: task.chat,
      role: "user",
      content: answer,
      meta: {
        taskId: task._id,
        kind: "answer",
        senderName: resolveHumanDisplayName(owner),
      },
    });
    if (isApi && task.agent) {
      const { kickApiAgent } = await import("../utils/apiAgentRunner.js");
      kickApiAgent(task.agent, req.userId);
    }
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
 * DELETE /api/chats/:id — remove a chat thread and its messages/tasks.
 * Why: Cancels in-flight work for this thread only (not other chats on the same agent).
 */
chatsRouter.delete("/:id", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }

    const chatId = chat._id;
    const now = new Date();
    const active = await Task.find({
      user: req.userId,
      chat: chatId,
      status: { $in: ["running", "waiting_user", "waiting_peer"] },
    });
    const agentIds = new Set();
    for (const task of active) {
      task.status = "cancelled";
      task.completedAt = now;
      task.resultSummary = "Chat deleted";
      task.events.push({
        type: "cancelled",
        payload: { reason: "chat_deleted" },
      });
      await task.save();
      if (task.agent) agentIds.add(String(task.agent));
    }
    for (const id of agentIds) {
      await clearAgentNeedsAttention(id);
      await clearAgentHumanControl(id);
    }

    const [messageResult, taskResult] = await Promise.all([
      Message.deleteMany({ chat: chatId }),
      Task.deleteMany({ user: req.userId, chat: chatId }),
    ]);
    await Chat.deleteOne({ _id: chatId });

    res.json({
      ok: true,
      cancelledActive: active.length,
      deletedMessages: messageResult.deletedCount,
      deletedTasks: taskResult.deletedCount,
    });
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
 * POST /api/chats/:id/stop — cancel active run (running / waiting_user / waiting_peer).
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
      status: { $in: ["running", "waiting_user", "waiting_peer"] },
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
