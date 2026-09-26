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
import { Agent, toAgentSnapshot, clearAgentNeedsAttention, clearAgentHumanControl, markAgentMemoryContentChangedById } from "../models/Agent.js";
import {
  resolveAgentMention,
  resolvePeerAskAssignments,
  rewritePeerAskContent,
} from "../utils/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../utils/skillSlash.js";
import { createLearnedSkillDraft } from "../utils/skillLearn.js";
import { routeCommonChat } from "../utils/chatRouter.js";
import {
  classifyMessageIntent,
  refineMessageIntentWithLlm,
  answerChatQuestion,
  shouldRefineIntentWithLlm,
} from "../utils/messageIntent.js";
import { runChatAutoTurn, streamChatQuestion, formatAutoTimingSummary, defaultQueueAck, cheapChatReplyIfAny, looksLikeAffirmativeConfirm, autoTurnNeedsTools, resolveConfirmComputerGoalFromMessages, sanitizeFakeComposioActionReply, createAutoTimingTracker, buildAutoObservabilityMeta } from "../utils/chatAutoTurn.js";

/**
 * Attach the exact LLM prompt snapshot onto the user message for the Prompt peek bubble.
 * @param {object|null|undefined} userMessage
 * @param {object|null|undefined} llmPrompt
 */
async function stampUserMessageLlmPrompt(userMessage, llmPrompt) {
  if (!userMessage?._id || !llmPrompt || typeof llmPrompt !== "object") return;
  try {
    await Message.updateOne(
      { _id: userMessage._id },
      { $set: { "meta.llmPrompt": llmPrompt } }
    );
    const prev =
      userMessage.meta && typeof userMessage.meta === "object" ? userMessage.meta : {};
    userMessage.meta = { ...prev, llmPrompt };
  } catch (err) {
    console.warn("[chats] llmPrompt stamp failed:", err?.message || err);
  }
}

/**
 * Attach redacted Jev router summary onto the user message (chip + Prompt row).
 * @param {object|null|undefined} userMessage
 * @param {object|null|undefined} jevMeta
 */
async function stampUserMessageJev(userMessage, jevMeta) {
  if (!userMessage?._id || !jevMeta || typeof jevMeta !== "object") return;
  try {
    await Message.updateOne(
      { _id: userMessage._id },
      { $set: { "meta.jev": jevMeta } }
    );
    const prev =
      userMessage.meta && typeof userMessage.meta === "object" ? userMessage.meta : {};
    userMessage.meta = { ...prev, jev: jevMeta };
  } catch (err) {
    console.warn("[chats] jev stamp failed:", err?.message || err);
  }
}
import {
  enrichComputerGoalForCombo,
  buildComboFollowupForTask,
  resolveComboFollowupForQueue,
  resolvePendingComboFollowupFromMessages,
  executeApprovedComboFollowup,
  cancelPendingComboFollowup,
} from "../utils/comboRunner.js";
import {
  persistChatRememberFact,
  persistChatForgetFact,
  persistChatSessionScratchFact,
  sanitizeFakeMemoryActionReply,
} from "../utils/chatRememberPersist.js";
import { formatPeerAgentsBlock, sendAgentMessage, shouldAnswerPeerCheaply, maybeWakeWaitingPeerParent } from "../utils/agentMessageBus.js";
import { resolveLlmCredentialsForAgent } from "../utils/llmCredentials.js";
import { formatLlmTurnFailureMessage } from "../utils/llmTest.js";
import {
  decryptAgentComposioApiKey,
  expandComposioToolkitSlugs,
  normalizeToolkitSlug,
} from "../utils/composioService.js";
import { decryptAgentJevApiKey, summarizeJevForChatMeta, appendJevLearningCase } from "../utils/jevEvaluate.js";
import {
  refreshChatContextIfNeeded,
} from "../utils/chatContext.js";
import { prepareChatPromptContext } from "../utils/chatPromptPrepare.js";
import { withChatAutoLock } from "../utils/chatAutoLock.js";
import { linkClientAbort, isAbortError } from "../utils/llmAbort.js";
import {
  resolvePendingComposioApprovalFromMessages,
  looksLikeComposioRiskyConfirm,
  looksLikeComposioRiskyDeny,
  agentComposioAutoApprovesRisky,
} from "../utils/composioApprovalGate.js";
import { redactCredentialLeaks } from "../utils/hermesUntrusted.js";
import { looksLikeScheduleManageRequest } from "../utils/scheduleFromChat.js";
import { ensureAgentChat } from "../utils/enqueueTask.js";
import { resolveHumanDisplayName } from "../utils/userPublic.js";
import { normalizeComputerUseMode, parseComputerUseFromText } from "../utils/computerUseMode.js";
import { cancelTaskWithoutBloat } from "../utils/taskDocGuard.js";

export const chatsRouter = Router();

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
  // Why: context_summary bubbles were for ops only — hide from the thread UI forever.
  const filter = { chat: chatId, "meta.kind": { $ne: "context_summary" } };
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
    const filter = { user: req.userId, kind: { $ne: "room" } };
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
 * POST /api/chats/:id/summarize — force-fold older turns into chat.contextSummary (LLM only; no bubble).
 */
chatsRouter.post("/:id/summarize", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.userId });
    if (!chat) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Chat missing" });
      return;
    }

    /** @type {import("mongoose").Document|null} */
    let agentDoc = null;
    if (chat.agent) {
      agentDoc = await Agent.findOne({ _id: chat.agent, user: req.userId });
    } else if (chat.defaultAgent) {
      agentDoc = await Agent.findOne({ _id: chat.defaultAgent, user: req.userId });
    } else if (chat.lastDispatchAgent) {
      agentDoc = await Agent.findOne({ _id: chat.lastDispatchAgent, user: req.userId });
    }
    if (!agentDoc) {
      agentDoc = await Agent.findOne({ user: req.userId, deletedAt: null }).sort({ updatedAt: -1 });
    }
    if (!agentDoc) {
      res.status(400).json({
        ok: false,
        title: "No agent",
        detail: "Need an agent with LLM credentials to summarize this chat.",
      });
      return;
    }

    const userDoc = await User.findById(req.userId);
    const creds = await resolveLlmCredentialsForAgent(userDoc, agentDoc);
    if (!creds?.apiKey) {
      res.status(400).json({
        ok: false,
        title: "LLM missing",
        detail: "Set an LLM API key in Settings (or on the agent) first.",
      });
      return;
    }

    const folded = await refreshChatContextIfNeeded(chat, creds, { force: true });
    // Why: Context button on the chat page needs the full folded summary, not a truncated preview.
    const fullSummary = String(chat.contextSummary || "");
    if (!folded?.summaryMessage) {
      res.status(200).json({
        ok: true,
        skipped: folded?.skipped || "no_summary",
        message: null,
        contextSummary: fullSummary,
      });
      return;
    }
    res.status(201).json({
      ok: true,
      message: folded.summaryMessage,
      contextSummary: fullSummary,
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
    /** @type {{ agentId: string, agentName: string, content: string }[]|null} */
    let peerFanoutTargets = null;

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
      // Multi-@: parse every @Peer with its own instruction and fan-out server-side.
      const userAgents = await Agent.find({ user: req.userId, active: true })
        .select("name skill instructions")
        .lean();
      const boundId = String(chat.agent);
      const peerAssignments = resolvePeerAskAssignments(content, userAgents, boundId);
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

      agentDoc = await Agent.findOne({ _id: chat.agent, user: req.userId });

      if (peerAssignments.length >= 2) {
        peerFanoutTargets = peerAssignments.slice(0, 5);
        const lines = peerFanoutTargets.map(
          (p, i) => `${i + 1}. “${p.agentName}” — ${p.content}`
        );
        goalText = [
          "[PEER FANOUT — already queued]",
          "Peers were messaged in parallel when this goal was queued:",
          ...lines,
          "Do NOT call message_agent again. Do not browse the web yourself.",
          "When PEER RESULT notes arrive for all peers, summarize for the user and call finish.",
        ].join("\n");
        mentionMeta = {
          matched: true,
          agentName: peerFanoutTargets.map((p) => p.agentName).join(", "),
          peerAgentIds: peerFanoutTargets.map((p) => p.agentId),
          peerAssignments: peerFanoutTargets,
          stripped: true,
          dispatchSource: "peer_ask_fanout",
          wantsReply: true,
        };
        peerAskForced = true;
      } else if (
        peerAssignments.length === 1 &&
        shouldAnswerPeerCheaply("question", peerAssignments[0].content)
      ) {
        // Why: “hi how are you” should not start WOM’s computer just to call message_agent.
        peerFanoutTargets = peerAssignments.slice(0, 1);
        const only = peerFanoutTargets[0];
        goalText = [
          "[PEER FANOUT — already queued]",
          `Peers were messaged when this goal was queued:`,
          `1. “${only.agentName}” — ${only.content}`,
          "Do NOT call message_agent again. Do not browse the web yourself.",
          "When a PEER RESULT note arrives, summarize for the user and call finish.",
        ].join("\n");
        mentionMeta = {
          matched: true,
          agentName: only.agentName,
          peerAgentId: String(only.agentId),
          peerAgentIds: [String(only.agentId)],
          peerAssignments: peerFanoutTargets,
          stripped: true,
          dispatchSource: "peer_ask_fanout",
          wantsReply: true,
          cheapPeerQuestion: true,
        };
        peerAskForced = true;
      } else if (peerAssignments.length === 1) {
        // Why: single @Peer browse/task used to queue WOM’s computer first so WOM could call
        // message_agent — that added ~30s before CI even saw the ask. Fan out at POST like multi-@.
        peerFanoutTargets = peerAssignments.slice(0, 1);
        const only = peerFanoutTargets[0];
        goalText = [
          "[PEER FANOUT — already queued]",
          `Peers were messaged when this goal was queued:`,
          `1. “${only.agentName}” — ${only.content}`,
          "Do NOT call message_agent again. Do not browse the web yourself.",
          "When a PEER RESULT note arrives, summarize for the user and call finish.",
        ].join("\n");
        mentionMeta = {
          matched: true,
          agentName: only.agentName,
          peerAgentId: String(only.agentId),
          peerAgentIds: [String(only.agentId)],
          peerAssignments: peerFanoutTargets,
          stripped: true,
          dispatchSource: "peer_ask_fanout",
          wantsReply: true,
        };
        peerAskForced = true;
      } else if (mention.matched && mention.agentId && String(mention.agentId) !== boundId) {
        // Fallback: single resolve when parsePeerAskAssignments missed (loose token match).
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
    /** @type {object|null} */
    let autoLlmPrompt = null;
    /** @type {object|null} */
    let autoJevMeta = null;
    /** @type {string} */
    let autoTaskPlanId = "";
    /** @type {object|null} */
    let autoComboFollowup = null;

    // Why: peer fan-out must not look like “Starting this agent’s computer”.
    if (peerFanoutTargets?.length >= 1 && agentDoc?.name) {
      autoAck =
        peerFanoutTargets.length === 1
          ? `Asking ${peerFanoutTargets[0].agentName} to do this on their computer — not starting ${agentDoc.name}’s browser.`
          : `Asking ${peerFanoutTargets.map((p) => p.agentName).join(", ")} in parallel — their computers, not ${agentDoc.name}’s.`;
    }

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
        intentReason: "auto_turn",
        senderName: resolveHumanDisplayName(owner),
      };
      if (common || mentionMeta?.matched) {
      if (mentionMeta?.dispatchSource === "peer_ask" || mentionMeta?.dispatchSource === "peer_ask_fanout") {
          Object.assign(messageMeta, {
            peerAsk: true,
            peerAgentId: mentionMeta.peerAgentId || null,
            peerAgentIds: mentionMeta.peerAgentIds || null,
            peerAgentName: mentionMeta.agentName,
            peerAssignments: mentionMeta.peerAssignments || null,
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
      void markAgentMemoryContentChangedById(agentDoc._id);

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
      /** @type {string|null} */
      let confirmGoal = null;
      /** @type {object|null} */
      let pendingComposioApproval = null;
      /** @type {object|null} */
      let pendingComboFollowup = null;
      {
        const recent = await Message.find({ chat: chat._id })
          .sort({ _id: -1 })
          .limit(10)
          .select("role content meta _id")
          .lean();
        pendingComposioApproval = resolvePendingComposioApprovalFromMessages(recent, {
          excludeIds: [String(message._id)],
        });
        // Why: after computer, hybrid tails ask confirm — resolve before computer-offer “yes”.
        if (!pendingComposioApproval) {
          pendingComboFollowup = resolvePendingComboFollowupFromMessages(recent, {
            excludeIds: [String(message._id)],
          });
        }
        // Why: composio / combo confirm/deny must win over “yes, open the computer” offers.
        if (
          looksLikeAffirmativeConfirm(questionText) ||
          looksLikeComposioRiskyConfirm(questionText)
        ) {
          if (!pendingComposioApproval && !pendingComboFollowup) {
            confirmGoal = resolveConfirmComputerGoalFromMessages(recent, {
              excludeIds: [String(message._id)],
            });
          }
        }
      }
      // Why: never cheap-ack a “yes” that confirms an offered computer job or pending follow-up.
      const cheapReply =
        confirmGoal || pendingComposioApproval || pendingComboFollowup
          ? null
          : cheapChatReplyIfAny(questionText);
      try {
        if (
          pendingComboFollowup?.taskId &&
          !pendingComposioApproval &&
          looksLikeComposioRiskyDeny(questionText)
        ) {
          const cancelled = await cancelPendingComboFollowup({
            userId: String(req.userId),
            taskId: String(pendingComboFollowup.taskId),
          });
          if (wantStream) writeNdjson({ type: "delta", text: cancelled.content });
          turn = {
            action: "reply",
            content: cancelled.content,
            goal: "",
            ack: "",
            reason: "combo_followup_cancelled",
          };
        } else if (
          pendingComboFollowup?.taskId &&
          !pendingComposioApproval &&
          (looksLikeAffirmativeConfirm(questionText) ||
            looksLikeComposioRiskyConfirm(questionText))
        ) {
          const ran = await executeApprovedComboFollowup({
            userId: String(req.userId),
            agent: agentDoc,
            taskId: String(pendingComboFollowup.taskId),
            // Why: this route creates the assistant Message from turn.content.
            postResultMessage: false,
          });
          const replyText =
            String(ran.content || "").trim() ||
            (ran.ok
              ? "Connected-app follow-ups finished."
              : "Could not run the connected-app follow-ups.");
          if (wantStream) writeNdjson({ type: "delta", text: replyText });
          turn = {
            action: "reply",
            content: replyText,
            goal: "",
            ack: "",
            reason: ran.ok ? "combo_followup_executed" : "combo_followup_failed",
          };
        } else if (confirmGoal) {
          turn = {
            action: "queue_goal",
            content: "",
            goal: confirmGoal,
            ack: defaultQueueAck(confirmGoal, agentDoc.name),
            reason: "confirm_prior_computer_offer",
          };
        } else if (cheapReply) {
          if (wantStream) writeNdjson({ type: "delta", text: cheapReply });
          turn = {
            action: "reply",
            content: cheapReply,
            goal: "",
            ack: "",
            reason: "cheap_greeting",
          };
        } else {
        const userForLlm = await User.findById(req.userId);
        qaCreds = await resolveLlmCredentialsForAgent(userForLlm, agentDoc);
        if (!qaCreds.apiKey) {
          throw Object.assign(new Error("No LLM credentials configured"), {
            title: "LLM not configured",
            hint: "Add an LLM key in Settings, or use Computer mode / /run …",
          });
        }
        // Why: parallel context + memory (Hermes-style) — never block TTFT on sequential awaits.
        // Why: abort LLM/tools when the client disconnects so abandoned Auto turns stop billing.
        // Why: serialize Auto turns per chat so two fast messages cannot race transcript order.
        // Why: Hermes tool-decision — light prep (skip Mem0) whenever tools are not needed.
        // Why: schedule list/create/stop needs no LLM context pack — skip prepare entirely.
        const scheduleManage = looksLikeScheduleManageRequest(questionText);
        const light =
          scheduleManage ||
          !autoTurnNeedsTools(questionText, {
            composioEnabled: Boolean(agentDoc?.composio?.enabled),
          });
        const autoTrack = createAutoTimingTracker({
          // Why: Composio/tool rounds stream a slim Working… bar on the chat bubble.
          onProgress: wantStream
            ? (step) => {
                if (!writeNdjson) return;
                writeNdjson({
                  type: "progress",
                  id: step?.id || "composio",
                  label: step?.label || "Working…",
                  pct: Number(step?.pct) || 0,
                  detail: step?.detail || "",
                  steps: Array.isArray(step?.steps) ? step.steps : undefined,
                });
              }
            : undefined,
        });
        const clientAbort = linkClientAbort(req, res);
        try {
        await withChatAutoLock(String(chat._id), async () => {
          let prepared;
          if (scheduleManage) {
            prepared = {
              chatContextBlock: "",
              historyMessages: [],
              curated: {
                userCuratedEntries: [],
                agentCuratedEntries: [],
                meta: {},
              },
              snapshot: toAgentSnapshot(agentDoc, { goal: questionText }),
            };
          } else {
            prepared = await prepareChatPromptContext({
              chat,
              messageId: String(message._id),
              questionText,
              userDoc: userForLlm,
              agentDoc,
              creds: qaCreds,
              userId: String(req.userId),
              light,
            });
          }
          autoTrack.markPrepDone();
          turn = await runChatAutoTurn({
            question: questionText,
            snapshot: prepared.snapshot,
            creds: qaCreds,
            chatContext: prepared.chatContextBlock,
            historyMessages: prepared.historyMessages || [],
            stream: wantStream,
            onDelta: wantStream
              ? (chunk) => writeNdjson({ type: "delta", text: chunk })
              : undefined,
            // Why: tracker already owns onProgress → NDJSON; avoid a second unbound callback.
            onProgress: undefined,
            timing: autoTrack,
            signal: clientAbort.signal,
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
            userId: String(req.userId),
            chatId: String(chat._id),
            agent: agentDoc,
            // Why: Hermes Phase 3 load_skill — full agent.skill for progressive skill tool.
            agentSkill: String(prepared?.snapshot?.skill || agentDoc?.skill || ""),
            composioEnabled: Boolean(agentDoc?.composio?.enabled),
            composioApiKey: decryptAgentComposioApiKey(agentDoc),
            // Why: optional per-agent Jev router (reply / computer / Composio).
            jevEnabled: Boolean(agentDoc?.jev?.enabled),
            jevApiKey: decryptAgentJevApiKey(agentDoc),
            jevCases: Array.isArray(agentDoc?.jev?.cases) ? agentDoc.jev.cases : [],
            composioToolkitSlugs: expandComposioToolkitSlugs(
              Array.isArray(agentDoc?.composio?.toolkitSlugs)
                ? agentDoc.composio.toolkitSlugs
                : []
            ),
            composioSessionId: String(agentDoc?.composio?.sessionId || "").trim() || null,
            pendingComposioApproval,
            composioExecuteApproved:
              agentComposioAutoApprovesRisky(agentDoc) ||
              (Boolean(pendingComposioApproval) &&
                looksLikeComposioRiskyConfirm(questionText)),
            saveComposioSessionId: async (sessionId) => {
              const sid = String(sessionId || "").trim();
              if (!sid || !agentDoc) return;
              agentDoc.composio = agentDoc.composio || {};
              if (String(agentDoc.composio.sessionId || "") === sid) return;
              agentDoc.composio.sessionId = sid;
              agentDoc.markModified("composio");
              await agentDoc.save();
            },
          },
        });
        // Why: every Auto turn teaches Jev — store final outcome as a learned case.
        try {
          await appendJevLearningCase(agentDoc, {
            userText: questionText,
            turn,
          });
        } catch (learnErr) {
          console.warn("[chats] jev case learn failed:", learnErr?.message || learnErr);
        }
        // Why: Drive↔Sheets expansion — persist googlesheets on the agent so Connect UI shows it.
        try {
          const before = Array.isArray(agentDoc?.composio?.toolkitSlugs)
            ? agentDoc.composio.toolkitSlugs.map((s) => normalizeToolkitSlug(s)).filter(Boolean)
            : [];
          const after = expandComposioToolkitSlugs(before);
          if (after.length > before.length) {
            agentDoc.composio = agentDoc.composio || {};
            agentDoc.composio.toolkitSlugs = after;
            agentDoc.markModified("composio");
            await agentDoc.save();
          }
        } catch (persistErr) {
          console.warn("[chats] composio toolkit expand persist failed:", persistErr?.message || persistErr);
        }
        });
        } finally {
          clientAbort.dispose();
        }
        }
      } catch (err) {
        answerError = err;
        turn = {
          action: "reply",
          content: isAbortError(err)
            ? "Stopped — the chat disconnected before this turn finished."
            : formatLlmTurnFailureMessage(err, {
                model: String(qaCreds?.llmModel || "").trim(),
                baseUrl: String(qaCreds?.llmBaseUrl || "").trim(),
              }),
          goal: "",
          ack: "",
          reason: isAbortError(err) ? "client_abort" : "auto_turn_error",
        };
      }

      if (turn.action === "queue_goal") {
        // Fall through to computer enqueue with the model's (or heuristic) goal text.
        goalText = String(turn.goal || questionText).trim() || questionText;
        classification = {
          intent: "goal",
          confidence: 0.95,
          reason: turn.reason || "auto_queue_goal",
          text: goalText,
        };
        autoTiming = turn.timing || null;
        autoLlmPrompt = turn.llmPrompt || null;
        autoJevMeta =
          summarizeJevForChatMeta(turn.jev, {
            enabled: Boolean(agentDoc?.jev?.enabled),
          }) || null;
        autoTaskPlanId = String(turn.taskPlanId || "").trim();
        if (turn.comboFollowup && typeof turn.comboFollowup === "object") {
          autoComboFollowup = turn.comboFollowup;
        }
        // Why: always show a short ack — model ack, or a clear default (never silent queue).
        autoAck =
          String(turn.ack || turn.content || "").trim() ||
          defaultQueueAck(goalText, agentDoc.name);
        if (autoLlmPrompt) await stampUserMessageLlmPrompt(message, autoLlmPrompt);
        if (autoJevMeta) await stampUserMessageJev(message, autoJevMeta);
        if (wantStream) {
          if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
          const routeObs = buildAutoObservabilityMeta(autoTiming, {
            reason: turn.reason,
          });
          if (routeObs) writeNdjson({ type: "auto_meta", ...routeObs });
          if (autoLlmPrompt) writeNdjson({ type: "llm_prompt", llmPrompt: autoLlmPrompt });
          if (autoJevMeta) writeNdjson({ type: "jev", jev: autoJevMeta });
          writeNdjson({
            type: "routing",
            action: "queue_goal",
            goal: goalText,
            ack: autoAck,
            timing: autoTiming,
            jev: autoJevMeta || undefined,
          });
        }
        // Why: user message already saved — reuse it in the goal enqueue path.
        precreatedUserMessage = message;
      } else {
        let assistantContent =
          String(turn.content || "").trim() ||
          "I didn’t get a usable reply that turn — please try again.";
        // Why: models emit fake ACTION: memory(...) — persist for real, then replace the ACTION text.
        let rememberMeta = null;
        let forgetMeta = null;
        let scratchMeta = null;
        try {
          const forgotten = await persistChatForgetFact({
            userId: req.userId,
            agentId: String(agentDoc._id),
            userText: questionText,
            messageId: message?._id ? String(message._id) : null,
            chatId: chat?._id ? String(chat._id) : null,
          });
          if (forgotten.ok && forgotten.reply) {
            forgetMeta = {
              needle: forgotten.needle,
              targets: forgotten.targets,
              removed: forgotten.removed,
            };
            assistantContent = forgotten.reply;
          } else {
            const scratched = await persistChatSessionScratchFact({
              userId: req.userId,
              chatId: chat?._id ? String(chat._id) : "",
              userText: questionText,
            });
            if (scratched.ok) {
              scratchMeta = { fact: scratched.fact };
              assistantContent = scratched.reply || assistantContent;
            } else {
              const saved = await persistChatRememberFact({
                userId: req.userId,
                agentId: String(agentDoc._id),
                userText: questionText,
                messageId: message?._id ? String(message._id) : null,
              });
              if (saved.ok) {
                rememberMeta = { fact: saved.fact, targets: saved.targets };
                assistantContent = sanitizeFakeMemoryActionReply(
                  assistantContent,
                  saved.reply
                );
                if (/^\s*ACTION\s*:\s*memory\s*\(/i.test(String(turn.content || ""))) {
                  assistantContent = saved.reply || assistantContent;
                }
              } else {
                assistantContent = sanitizeFakeMemoryActionReply(assistantContent);
              }
            }
          }
        } catch (err) {
          console.warn("[chats] remember/forget persist failed:", err?.message || err);
          assistantContent = sanitizeFakeMemoryActionReply(assistantContent);
        }
        assistantContent = sanitizeFakeComposioActionReply(assistantContent);
        assistantContent = redactCredentialLeaks(assistantContent);
        if (!String(assistantContent || "").trim()) {
          assistantContent =
            "I couldn’t finish that Composio step. Check Agent → Composio (API key, the app enabled + connected), then send the same request again.";
        }
        autoTiming = turn.timing || null;
        const timingLine = formatAutoTimingSummary(autoTiming);
        const autoObs = buildAutoObservabilityMeta(autoTiming, {
          reason: turn.reason,
        });
        const llmPrompt = turn.llmPrompt || null;
        const jevMeta =
          summarizeJevForChatMeta(turn.jev, {
            enabled: Boolean(agentDoc?.jev?.enabled),
          }) || null;
        if (llmPrompt) await stampUserMessageLlmPrompt(message, llmPrompt);
        if (jevMeta) await stampUserMessageJev(message, jevMeta);
        const assistantMessage = await Message.create({
          chat: chat._id,
          role: "assistant",
          content: assistantContent,
          meta: {
            kind: "chat_qa",
            intent: "question",
            intentReason: turn.reason || "auto_reply",
            intentConfidence: 0.9,
            agentId: String(agentDoc._id),
            agentName: agentDoc.name,
            answeredWhileBusy: Boolean(busyRun),
            hermesAuto: true,
            hermesTiming: autoTiming || undefined,
            // Why: Hermes Phase 3 — lightweight Auto observability (redacted; no secrets).
            ...(autoObs || {}),
            llmPrompt: llmPrompt || undefined,
            jev: jevMeta || undefined,
            rememberSaved: rememberMeta || undefined,
            rememberForgotten: forgetMeta || undefined,
            sessionScratchSaved: scratchMeta || undefined,
            pendingComposioApproval: turn.pendingComposioApproval || undefined,
            error: answerError ? String(answerError.message || answerError) : undefined,
          },
        });
        // Why: Mem0 learns durable facts from chat turns — skip when “remember …” already wrote once.
        if (!rememberMeta?.fact && !forgetMeta?.needle && !scratchMeta?.fact) {
          void import("../utils/mem0Service.js")
            .then(({ mem0IngestChatTurn }) =>
              mem0IngestChatTurn({
                userId: req.userId,
                agentId: agentDoc._id,
                userText: questionText,
                assistantText: assistantContent,
              })
            )
            .catch(() => {});
        }
        const systemMessage = await Message.create({
          chat: chat._id,
        role: "system",
          content: [
            busyRun
              ? `Answered in chat (Auto — no computer). The current browser run continues.`
              : `Answered in chat (Auto — no computer).`,
            timingLine ? `Timing: ${timingLine}` : null,
          ]
            .filter(Boolean)
            .join(" "),
          meta: {
            kind: "intent_question",
            ui: "icon",
            intentReason: turn.reason || "auto_reply",
            agentId: String(agentDoc._id),
            agentName: agentDoc.name,
            answeredWhileBusy: Boolean(busyRun),
            hermesAuto: true,
            hermesTiming: autoTiming || undefined,
            jev: jevMeta || undefined,
          },
        });
        let contextSummaryMessage = null;
        if (qaCreds?.apiKey) {
          try {
            const folded = await refreshChatContextIfNeeded(chat, qaCreds);
            contextSummaryMessage = folded?.summaryMessage || null;
          } catch {
            /* ignore */
          }
        }
        if (wantStream) {
          if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
          if (autoObs) writeNdjson({ type: "auto_meta", ...autoObs });
          if (llmPrompt) writeNdjson({ type: "llm_prompt", llmPrompt });
          if (jevMeta) writeNdjson({ type: "jev", jev: jevMeta });
          writeNdjson({
            type: "result",
            ok: true,
            intent: "question",
            message,
            assistantMessage,
            systemMessage,
            contextSummaryMessage,
            task: null,
            timing: autoTiming,
            jev: jevMeta || undefined,
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
          contextSummaryMessage,
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
      void markAgentMemoryContentChangedById(agentDoc._id);

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
      const cheapReply = cheapChatReplyIfAny(questionText);
      try {
        if (cheapReply) {
          assistantContent = cheapReply;
          if (wantStream) writeNdjson({ type: "delta", text: assistantContent });
        } else {
        const userForLlm = await User.findById(req.userId);
        qaCreds = await resolveLlmCredentialsForAgent(userForLlm, agentDoc);
        if (!qaCreds.apiKey) {
          throw Object.assign(new Error("No LLM credentials configured"), {
            title: "LLM not configured",
            hint: "Add an LLM key in Settings, or send /run … to use the computer.",
          });
        }
        // Why: parallel prep + abort Answer LLM when the client disconnects.
        const clientAbort = linkClientAbort(req, res);
        try {
        await withChatAutoLock(String(chat._id), async () => {
          const prepared = await prepareChatPromptContext({
            chat,
            messageId: String(message._id),
            questionText,
            userDoc: userForLlm,
            agentDoc,
            creds: qaCreds,
            userId: String(req.userId),
          });
          if (wantStream) {
            const qaStream = await streamChatQuestion({
              question: questionText,
              snapshot: prepared.snapshot,
              creds: qaCreds,
              chatContext: prepared.chatContextBlock,
              historyMessages: prepared.historyMessages || [],
              onDelta: (chunk) => writeNdjson({ type: "delta", text: chunk }),
              signal: clientAbort.signal,
            });
            assistantContent =
              typeof qaStream === "string" ? qaStream : String(qaStream?.content || "");
            if (qaStream?.llmPrompt) {
              await stampUserMessageLlmPrompt(message, qaStream.llmPrompt);
              message._llmPrompt = qaStream.llmPrompt;
            }
          } else {
            const qaReply = await answerChatQuestion({
              question: questionText,
              snapshot: prepared.snapshot,
              creds: qaCreds,
              chatContext: prepared.chatContextBlock,
              historyMessages: prepared.historyMessages || [],
              signal: clientAbort.signal,
            });
            assistantContent =
              typeof qaReply === "string" ? qaReply : String(qaReply?.content || "");
            if (qaReply?.llmPrompt) {
              await stampUserMessageLlmPrompt(message, qaReply.llmPrompt);
              message._llmPrompt = qaReply.llmPrompt;
            }
          }
        });
        } finally {
          clientAbort.dispose();
        }
        }
      } catch (err) {
        answerError = err;
        assistantContent = isAbortError(err)
          ? "Stopped — the chat disconnected before this turn finished."
          : formatLlmTurnFailureMessage(err, {
              model: String(qaCreds?.llmModel || "").trim(),
              baseUrl: String(qaCreds?.llmBaseUrl || "").trim(),
            }).replace(
              /^I could not complete that turn\./,
              "I treated that as a question (no computer)."
            );
        if (wantStream) writeNdjson({ type: "delta", text: assistantContent });
      }

      let rememberMeta = null;
      let forgetMeta = null;
      let scratchMeta = null;
      try {
        const forgotten = await persistChatForgetFact({
          userId: req.userId,
          agentId: String(agentDoc._id),
          userText: questionText,
          chatId: chat?._id ? String(chat._id) : null,
        });
        if (forgotten.ok && forgotten.reply) {
          forgetMeta = {
            needle: forgotten.needle,
            targets: forgotten.targets,
            removed: forgotten.removed,
          };
          assistantContent = forgotten.reply;
        } else {
          const scratched = await persistChatSessionScratchFact({
            userId: req.userId,
            chatId: chat?._id ? String(chat._id) : "",
            userText: questionText,
          });
          if (scratched.ok) {
            scratchMeta = { fact: scratched.fact };
            assistantContent = scratched.reply || assistantContent;
          } else {
            const saved = await persistChatRememberFact({
              userId: req.userId,
              agentId: String(agentDoc._id),
              userText: questionText,
            });
            if (saved.ok) {
              rememberMeta = { fact: saved.fact, targets: saved.targets };
              assistantContent = sanitizeFakeMemoryActionReply(
                String(assistantContent || ""),
                saved.reply
              );
              if (/^\s*ACTION\s*:\s*memory\s*\(/i.test(String(assistantContent || ""))) {
                assistantContent = saved.reply || assistantContent;
              }
            } else {
              assistantContent = sanitizeFakeMemoryActionReply(String(assistantContent || ""));
            }
          }
        }
      } catch (err) {
        console.warn("[chats] remember/forget persist (legacy) failed:", err?.message || err);
        assistantContent = sanitizeFakeMemoryActionReply(String(assistantContent || ""));
      }
      assistantContent = sanitizeFakeComposioActionReply(String(assistantContent || ""));
      assistantContent = redactCredentialLeaks(assistantContent);
      if (!String(assistantContent || "").trim()) {
        assistantContent =
          "I couldn’t finish that Composio step. Check Agent → Composio (API key, the app enabled + connected), then send the same request again.";
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
          llmPrompt: message._llmPrompt || message.meta?.llmPrompt || undefined,
          rememberSaved: rememberMeta || undefined,
          rememberForgotten: forgetMeta || undefined,
          sessionScratchSaved: scratchMeta || undefined,
          error: answerError ? String(answerError.message || answerError) : undefined,
        },
      });
      if (!rememberMeta?.fact && !forgetMeta?.needle && !scratchMeta?.fact) {
        void import("../utils/mem0Service.js")
          .then(({ mem0IngestChatTurn }) =>
            mem0IngestChatTurn({
              userId: req.userId,
              agentId: agentDoc._id,
              userText: questionText,
              assistantText: assistantContent,
            })
          )
          .catch(() => {});
      }

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

      let contextSummaryMessage = null;
      if (qaCreds?.apiKey) {
        try {
          const folded = await refreshChatContextIfNeeded(chat, qaCreds);
          contextSummaryMessage = folded?.summaryMessage || null;
        } catch {
          /* ignore */
        }
      }

      if (wantStream) {
        const qp = message._llmPrompt || message.meta?.llmPrompt;
        if (qp) writeNdjson({ type: "llm_prompt", llmPrompt: qp });
        writeNdjson({
          type: "result",
          ok: true,
          intent: "question",
          message,
          assistantMessage,
          systemMessage,
          contextSummaryMessage,
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
        contextSummaryMessage,
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
      if (mentionMeta?.dispatchSource === "peer_ask" || mentionMeta?.dispatchSource === "peer_ask_fanout") {
        Object.assign(messageMeta, {
          peerAsk: true,
          peerAgentId: mentionMeta.peerAgentId || null,
          peerAgentIds: mentionMeta.peerAgentIds || null,
          peerAgentName: mentionMeta.agentName,
          peerAssignments: mentionMeta.peerAssignments || null,
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
    // Why: precreated Auto path already bumped; goal path still needs the dirty flag.
    void markAgentMemoryContentChangedById(agentDoc._id);

    /** @type {object|null} */
    let autoAckMessage = null;
    if (autoAck) {
      const ackObs = buildAutoObservabilityMeta(autoTiming);
      const llmPrompt = autoLlmPrompt || null;
      if (llmPrompt) await stampUserMessageLlmPrompt(message, llmPrompt);
      if (autoJevMeta) await stampUserMessageJev(message, autoJevMeta);
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
          hermesTiming: autoTiming || undefined,
          llmPrompt: llmPrompt || undefined,
          jev: autoJevMeta || undefined,
          ...(ackObs || {}),
        },
      });
    }

    // Why: Hermes Auto often rewrites the goal and drops “using cua/jev” — detect mode from the
    // original user bubble (content) first, then the rewritten goalText.
    const cuFromUser = parseComputerUseFromText(content);
    const cuFromGoal = parseComputerUseFromText(goalText || "");
    /** Prefer explicit opt-ins: jev > cua > playwright > auto. */
    let computerUseMode = "auto";
    if (cuFromUser.mode === "jev" || cuFromGoal.mode === "jev") {
      computerUseMode = "jev";
    } else if (cuFromUser.mode === "cua" || cuFromGoal.mode === "cua") {
      computerUseMode = "cua";
    } else if (cuFromUser.mode === "playwright" || cuFromGoal.mode === "playwright") {
      computerUseMode = "playwright";
    }
    computerUseMode = normalizeComputerUseMode(computerUseMode);
    // Why: strip CUA/Jev phrases from the worker goal so the LLM focuses on the site task.
    let workerGoalText =
      parseComputerUseFromText(goalText || content).cleanedGoal || goalText || content;
    // Why: hybrid combo from Auto LLM/heuristic classify on the original bubble — never from rewritten goals.
    const comboFollowup = resolveComboFollowupForQueue(content, {
      followup: autoComboFollowup,
    });
    workerGoalText = enrichComputerGoalForCombo(
      workerGoalText,
      content,
      comboFollowup?.steps || []
    );

    // Why: rebuild snapshot with final goal + semantic curated top-k + chat context for the worker.
    /** @type {object|null} */
    let curatedMeta = null;
    try {
      const userForCtx = await User.findById(req.userId);
      const ctxCreds = await resolveLlmCredentialsForAgent(userForCtx, agentDoc);
      const prepared = await prepareChatPromptContext({
        chat,
        messageId: String(message._id),
        questionText: workerGoalText,
        userDoc: userForCtx,
        agentDoc,
        creds: ctxCreds,
        userId: String(req.userId),
      });
      curatedMeta = prepared.curated.meta;
      snapshot = prepared.snapshot;
    } catch (err) {
      console.warn("[chats] chat context pack failed:", err?.message || err);
      snapshot = toAgentSnapshot(agentDoc, { goal: workerGoalText });
    }

    const task = await Task.create({
      user: req.userId,
      chat: chat._id,
      message: message._id,
      goal: workerGoalText,
      agent: agentDoc._id,
      agentSnapshot: snapshot,
      invokedSkill: invokedSkillDoc?._id || null,
      runner: "cloud",
      computerUseMode,
      status: "pending",
      comboFollowup: comboFollowup || null,
      taskPlanId: autoTaskPlanId || null,
      events: [
        {
          type: "queued",
          payload: {
            goal: workerGoalText,
            computerUseMode,
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
            taskPlanId: autoTaskPlanId || null,
            peerFanout: peerFanoutTargets
              ? peerFanoutTargets.map((p) => ({ to: p.agentName, content: p.content }))
              : null,
            curatedMemory: curatedMeta,
            comboRecipe: comboFollowup?.recipe || null,
            comboSteps: comboFollowup?.steps?.length || 0,
          },
        },
      ],
    });

    if (autoTaskPlanId) {
      try {
        const { TaskPlan } = await import("../models/TaskPlan.js");
        await TaskPlan.findOneAndUpdate(
          { _id: autoTaskPlanId, user: req.userId },
          { $set: { activeTaskId: task._id, status: "running" } }
        );
      } catch (err) {
        console.warn("[chats] taskplan link failed:", err?.message || err);
      }
    }

    // Why: multi-@ (and cheap single greetings) fan-out server-side — park waiting_peer first
    // so finalize can wake; if every peer answered cheaply, finish here without a computer.
    if (peerFanoutTargets?.length >= 1) {
      task.status = "waiting_peer";
      task.events.push({
        type: "waiting_peer",
        payload: {
          reason:
            peerFanoutTargets.length >= 2
              ? "multi_peer_ask_fanout"
              : "single_peer_ask_fanout",
          peers: peerFanoutTargets.map((p) => p.agentName),
        },
        at: new Date(),
      });
      await task.save();

      /** @type {string[]} */
      const fanNotes = [];
      let allCheapOk = true;
      for (const peer of peerFanoutTargets) {
        const peerMode = shouldAnswerPeerCheaply("question", peer.content)
          ? "question"
          : /^(hi|hello|hey|yo)\b/i.test(peer.content) || /\bhow are you\b/i.test(peer.content)
            ? "question"
            : "task";
        const sent = await sendAgentMessage({
          userId: String(req.userId),
          fromAgentId: String(agentDoc._id),
          to: peer.agentName,
          content: peer.content,
          mode: peerMode,
          wait: false,
          parentTaskId: String(task._id),
          forbidFurtherHops: peerMode === "task",
        });
        fanNotes.push(
          sent?.ok
            ? `→ ${peer.agentName}${sent.cheapPeerQuestion ? " (instant)" : ""}: ${peer.content.slice(0, 120)}`
            : `✗ ${peer.agentName}: ${sent?.note || "failed"}`
        );
        if (!sent?.ok || !sent?.cheapPeerQuestion) allCheapOk = false;
      }

      await Message.create({
        chat: chat._id,
        role: "system",
        content: `Fan-out to ${peerFanoutTargets.length} peer(s):\n${fanNotes.join("\n")}`,
        meta: {
          kind: "peer_fanout",
          ui: "icon",
          taskId: task._id,
          peers: peerFanoutTargets.map((p) => ({
            agentId: p.agentId,
            agentName: p.agentName,
            content: p.content,
          })),
        },
      }).catch(() => null);

      const fresh = await Task.findById(task._id);
      if (fresh) {
        const stillWaiting = (fresh.pendingPeerResults || []).some(
          (r) => r.status === "waiting"
        );
        // Why: finalize already posted peer_reply bubble(s) + maybeWake may have marked done.
        // Never post a second/third assistant summary that repeats the same peer text.
        if (!stillWaiting && allCheapOk) {
          if (String(fresh.status) === "done") {
            Object.assign(task, {
              status: fresh.status,
              resultSummary: fresh.resultSummary,
              finishedAt: fresh.finishedAt,
            });
          } else {
            const peers = fresh.pendingPeerResults || [];
            const summary =
              peers.length === 1
                ? `${peers[0].toAgentName || "Peer"} replied: ${String(peers[0].resultSummary || "").trim() || "(no reply)"}`
                : peers
                    .map((p) => {
                      const name = p.toAgentName || "peer";
                      const body = String(p.resultSummary || "").trim() || "(no reply)";
                      return `${name}: ${body}`;
                    })
                    .join("\n\n");
            const doneAt = new Date();
            for (const row of peers) {
              if (!row.consumed) {
                row.consumed = true;
                row.consumedAt = doneAt;
              }
            }
            fresh.status = "done";
            fresh.resultSummary = summary.slice(0, 6000);
            fresh.finishedAt = doneAt;
            fresh.events.push({
              type: "complete",
              payload: { source: "cheap_peer_fanout", peerCount: peers.length },
              at: doneAt,
            });
            await fresh.save();
            Object.assign(task, {
              status: fresh.status,
              resultSummary: fresh.resultSummary,
              finishedAt: fresh.finishedAt,
            });
          }
        } else if (!stillWaiting && String(fresh.status) === "waiting_peer") {
          await maybeWakeWaitingPeerParent(String(fresh._id)).catch(() => null);
          const afterWake = await Task.findById(task._id)
            .select("status resultSummary finishedAt")
            .lean();
          if (afterWake) {
            Object.assign(task, {
              status: afterWake.status,
              resultSummary: afterWake.resultSummary,
              finishedAt: afterWake.finishedAt,
            });
          }
        }
      }
    }
    const agentLabel = snapshot?.name ? ` as “${snapshot.name}”` : "";
    const skillLabel = invokedSkillDoc?.name ? ` with skill /${skillSlashMeta?.slug || invokedSkillDoc.slug}` : "";
    const routeLabel =
      routerMeta?.agentName && mentionMeta?.dispatchSource === "router"
        ? ` (auto-routed, ${Math.round((routerMeta.confidence || 0) * 100)}%)`
        : "";
    const slashPickHint = skillSlashMeta?.pickReason
      ? ` ${skillSlashMeta.pickReason}`
      : "";
    const queueHint =
      String(task.status) === "done"
        ? "Peers replied instantly (no computer) — summary below."
        : String(task.status) === "waiting_peer"
          ? "Waiting on peer agents — computer free for other goals."
          : activeRun
            ? `Agent is busy (${activeRun.status}) — this goal is pending and will start when the current run finishes.`
            : snapshot?.mode === "api"
              ? "Queued for API agent (no live computer — saves VPS RAM)."
              : "Queued for this agent's cloud computer on the VPS (Playwright Chromium profile).";
    const timingLine = formatAutoTimingSummary(autoTiming);
    const queueObs = buildAutoObservabilityMeta(autoTiming);
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
        status: task.status || "pending",
        intent: "goal",
        intentReason: classification.reason,
        intentConfidence: classification.confidence,
        agentId: snapshot?.id || null,
        agentName: snapshot?.name || null,
        mode: snapshot?.mode || "browser",
        queuedBehindActive: Boolean(activeRun),
        activeTaskId: activeRun?._id || null,
        cheapPeerFanout: String(task.status) === "done",
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
        curatedMemory: curatedMeta,
        hermesTiming: autoTiming || undefined,
        jev: autoJevMeta || undefined,
        ...(queueObs || {}),
      },
    });
    if (curatedMeta) {
      const { postCuratedPullMessage } = await import("../utils/semanticMemory.js");
      await postCuratedPullMessage({
        chatId: chat._id,
        taskId: task._id,
        curatedMeta,
      });
    }

    if (snapshot?.mode === "api" && !activeRun && String(task.status) === "pending") {
      const { kickApiAgent } = await import("../utils/apiAgentRunner.js");
      kickApiAgent(agentDoc._id, req.userId);
    }

    if (wantStream && writeNdjson) {
      if (autoTiming) writeNdjson({ type: "timing", timing: autoTiming });
      if (queueObs) writeNdjson({ type: "auto_meta", ...queueObs });
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
    if (task.agent) void markAgentMemoryContentChangedById(task.agent);

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
    if (task.agent) void markAgentMemoryContentChangedById(task.agent);
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
    // Why: $set only — bloated pending tasks cannot accept another events.push.
    await Task.updateOne(
      { _id: task._id, status: "pending" },
      {
        $set: {
          goal,
          // Keep a tiny event trail without appending onto a 16MB array.
          events: [
            {
      type: "goal_edited",
              at: new Date(),
              payload: { goal: goal.slice(0, 500), byChat: String(chat._id), trimmedEvents: true },
            },
          ],
        },
      }
    );
    await Message.findByIdAndUpdate(task.message, { content: goal }).catch(() => {});
    const updated = await Task.findById(task._id).select("_id goal status").lean();
    res.json({ ok: true, task: updated });
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
    }).select("_id agent");
    const agentIds = new Set();
    for (const task of active) {
      await cancelTaskWithoutBloat(Task, task._id, {
        resultSummary: "Chat deleted",
        reason: "chat_deleted",
        byChat: String(chatId),
      });
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
    }).select("_id chat goal status");
    if (!task || !taskMatchesChat(chat, task)) {
      res.status(404).json({
        ok: false,
        title: "Not found",
        detail: "Queued task missing or already started.",
      });
      return;
    }
    // Why: never task.save()+$push — bloated pending docs (requeued near 16MB) reject updates.
    await cancelTaskWithoutBloat(Task, task._id, {
      resultSummary: "Removed from queue",
      reason: "user_removed_from_queue",
      byChat: String(chat._id),
    });
    await Message.create({
      chat: task.chat,
      role: "system",
      content: `Queued goal removed: “${String(task.goal || "").slice(0, 120)}”`,
      meta: { taskId: task._id, kind: "queue_removed" },
    }).catch(() => {});
    res.json({ ok: true, task: { id: task._id, status: "cancelled" } });
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
      await cancelTaskWithoutBloat(Task, task._id, {
        resultSummary: "Stopped by user",
        reason: "user_stop",
        byChat: String(chat._id),
      });
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
