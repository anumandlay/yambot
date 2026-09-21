/**
 * @fileoverview Shared task enqueue helper — single path for chats, goals, triggers, autonomy.
 * Purpose: Create Message + Task consistently with priority, SLA, dependencies, and snapshots.
 * Downstream: goals, chats, workforce, triggerEngine, goalAutonomy, managerAutonomy.
 */

import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task, priorityRank } from "../models/Task.js";
import { User } from "../models/User.js";
import { buildCompanyContextBlock, prependContextToGoal } from "./entityContext.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { postCuratedPullMessage, resolveCuratedMemoryForPrompt } from "./semanticMemory.js";
import { normalizeComputerUseMode, parseComputerUseFromText } from "./computerUseMode.js";

/**
 * One human chat per agent — find the newest agent chat or create it.
 * Why: multiple threads per agent made agent-to-agent + schedules messy.
 * @param {string} userId
 * @param {string|import('mongoose').Types.ObjectId} agentId
 * @param {{ title?: string, agentName?: string }} [opts]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function ensureAgentChat(userId, agentId, opts = {}) {
  const aid = String(agentId || "").trim();
  if (!userId || !aid) {
    throw Object.assign(new Error("userId and agentId required for ensureAgentChat"), { status: 400 });
  }

  let chat = await Chat.findOne({
    user: userId,
    agent: aid,
    $or: [{ kind: "agent" }, { kind: { $exists: false } }, { kind: null }],
  }).sort({ updatedAt: -1 });

  if (chat) {
    // Why: keep the canonical thread titled as the agent for a clean sidebar.
    const preferred = String(opts.title || opts.agentName || "").trim();
    if (preferred && chat.title !== preferred) {
      const noisy =
        /^(task|question|approval|handoff|event):\s*from\s+/i.test(chat.title || "") ||
        /^Trigger\s*·/i.test(chat.title || "") ||
        /^Schedule\s*·/i.test(chat.title || "") ||
        /^Goal\s*·/i.test(chat.title || "") ||
        /^Chat\s*·/i.test(chat.title || "") ||
        /^From\s+/i.test(chat.title || "") ||
        /^Autonomous work$/i.test(chat.title || "") ||
        /^New chat$/i.test(chat.title || "");
      if (noisy || !chat.title) {
        chat.title = preferred.slice(0, 80);
        chat.kind = "agent";
        await chat.save();
      }
    }
    return chat;
  }

  const title = String(opts.title || opts.agentName || "Agent chat").trim().slice(0, 80);
  return Chat.create({
    user: userId,
    agent: aid,
    kind: "agent",
    title: title || "Agent chat",
  });
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.agentId
 * @param {string} opts.goalText
 * @param {string} [opts.chatId]
 * @param {string} [opts.chatTitle]
 * @param {string} [opts.goalRef]
 * @param {string} [opts.priority]
 * @param {string[]} [opts.dependsOn]
 * @param {Date} [opts.slaDeadline]
 * @param {string} [opts.slaName]
 * @param {number} [opts.maxDurationMinutes]
 * @param {number} [opts.estimatedValueUsd]
 * @param {object} [opts.meta]
 * @param {string} [opts.source]
 * @param {string} [opts.triggerRef]
 * @param {string} [opts.entityRef]
 * @param {string} [opts.enrollmentRef]
 * @param {string} [opts.campaignRef]
 * @param {string} [opts.ticketRef]
 * @param {boolean} [opts.skipCompanyContext]
 * @param {string} [opts.displayContent] — chat bubble text (defaults to goal before company framing)
 * @param {"auto"|"cua"|"playwright"} [opts.computerUseMode] — override parsed mode from goal text
 * @returns {Promise<{ task: import('mongoose').Document, chat: import('mongoose').Document, message: import('mongoose').Document }>}
 */
export async function enqueueTask(opts) {
  const userId = opts.userId;
  const agentId = opts.agentId;
  const rawGoal = String(opts.goalText || "").trim();
  if (!userId || !agentId || !rawGoal) {
    throw Object.assign(new Error("userId, agentId, and goalText required"), { status: 400 });
  }

  const agentDoc = await Agent.findOne({ _id: agentId, user: userId });
  if (!agentDoc) {
    throw Object.assign(new Error("Agent missing"), { status: 404 });
  }

  // Why: “login using cua” → mode cua + cleaned goal so the LLM focuses on the site task.
  const parsedCu = parseComputerUseFromText(rawGoal);
  const computerUseMode = opts.computerUseMode
    ? normalizeComputerUseMode(opts.computerUseMode)
    : parsedCu.mode;
  const goalForWorker = parsedCu.cleanedGoal || rawGoal;

  // Why: chat shows the human ask; Task.goal keeps company memory + A2A framing for the worker.
  const displayContent =
    String(opts.displayContent || "").trim() || rawGoal;
  let workerGoal = goalForWorker;
  if (!opts.skipCompanyContext) {
    const contextBlock = await buildCompanyContextBlock(userId, {
      agentId,
      entityId: opts.entityRef || opts.meta?.entityId || null,
      enrollmentId: opts.enrollmentRef || opts.meta?.enrollmentId || null,
      ticketId: opts.ticketRef || opts.meta?.ticketId || null,
    });
    workerGoal = prependContextToGoal(goalForWorker, contextBlock);
  }

  let chat;
  if (opts.chatId) {
    chat = await Chat.findOne({ _id: opts.chatId, user: userId, agent: agentId });
  }
  // Why: one chat per agent — ignore chatTitle-driven Chat.create sprawl.
  if (!chat) {
    chat = await ensureAgentChat(userId, agentId, {
      agentName: agentDoc.name,
      title: agentDoc.name,
    });
  }

  const message = await Message.create({
    chat: chat._id,
    role: "user",
    content: displayContent,
    meta: {
      ...(opts.meta || {}),
      source: opts.source || "enqueue",
      userFacingGoal: displayContent,
    },
  });

  const priority = opts.priority || "normal";
  const dependsOn = Array.isArray(opts.dependsOn) ? opts.dependsOn.map(String).filter(Boolean) : [];
  const blockedByDeps =
    dependsOn.length > 0
      ? await Task.countDocuments({
          user: userId,
          _id: { $in: dependsOn },
          status: { $nin: ["done", "cancelled"] },
        })
      : 0;

  const workflowRunId = opts.workflowRunId || opts.meta?.workflowRunId || null;
  const correlationId = String(opts.correlationId || opts.meta?.correlationId || "").trim();

  // Why: freeze semantic top-k of USER.md + MEMORY.md at enqueue (Hermes-style retrieve, then freeze).
  const owner = await User.findById(userId);
  const creds = owner ? await resolveLlmCredentialsForAgent(owner, agentDoc) : null;
  const curated = await resolveCuratedMemoryForPrompt({
    userEntries: owner?.curatedMemory?.entries,
    agentEntries: agentDoc.curatedMemory?.entries,
    goal: workerGoal,
    creds,
    userDoc: owner,
    agentDoc,
    persistEmbeddings: Boolean(creds?.apiKey),
  });

  const task = await Task.create({
    user: userId,
    chat: chat._id,
    message: message._id,
    goal: workerGoal,
    goalRef: opts.goalRef || null,
    triggerRef: opts.triggerRef || opts.meta?.triggerId || null,
    entityRef: opts.entityRef || opts.meta?.entityId || null,
    enrollmentRef: opts.enrollmentRef || opts.meta?.enrollmentId || null,
    campaignRef: opts.campaignRef || opts.meta?.campaignId || null,
    ticketRef: opts.ticketRef || opts.meta?.ticketId || null,
    workflowRunId: workflowRunId || null,
    correlationId,
    priority,
    priorityRank: priorityRank(priority),
    agent: agentId,
    agentSnapshot: toAgentSnapshot(agentDoc, {
      goal: workerGoal,
      userCuratedEntries: curated.userCuratedEntries,
      agentCuratedEntries: curated.agentCuratedEntries,
    }),
    runner: "cloud",
    computerUseMode,
    status: blockedByDeps > 0 ? "blocked" : "pending",
    dependsOn,
    slaDeadline: opts.slaDeadline || null,
    slaName: opts.slaName || "",
    maxDurationMinutes: Math.max(0, Number(opts.maxDurationMinutes) || 0),
    estimatedValueUsd: Math.max(0, Number(opts.estimatedValueUsd) || 0),
    events: [
      {
        type: "queued",
        payload: {
          source: opts.source || "enqueue",
          blocked: blockedByDeps > 0,
          userFacingGoal: displayContent,
          computerUseMode,
          curatedMemory: curated.meta,
          ...(opts.meta && typeof opts.meta === "object" ? opts.meta : {}),
        },
      },
    ],
  });

  const source = String(opts.source || "enqueue");
  const triggerLabel =
    opts.meta?.triggerEventType || opts.meta?.triggerName || opts.meta?.triggerId || "";
  const isApi = (agentDoc.mode || "browser") === "api";
  const queueHint =
    source.startsWith("trigger:") || opts.triggerRef
      ? `Queued from Operations trigger${triggerLabel ? ` (${triggerLabel})` : ""}.`
      : isApi
        ? "Queued for API agent (no live computer)."
        : "Queued for cloud worker.";
  await Message.create({
    chat: chat._id,
    role: "system",
    content: queueHint,
    meta: {
      taskId: task._id,
      kind: "queued",
      ui: "icon",
      status: task.status,
      source,
      triggerId: opts.triggerRef || opts.meta?.triggerId || null,
      mode: isApi ? "api" : "browser",
    },
  });
  await postCuratedPullMessage({
    chatId: chat._id,
    taskId: task._id,
    curatedMeta: curated.meta,
  });

  chat.updatedAt = new Date();
  await chat.save();

  if (isApi && task.status === "pending") {
    const { kickApiAgent } = await import("./apiAgentRunner.js");
    kickApiAgent(agentId, userId);
  }

  return { task, chat, message };
}

/**
 * Unblocks tasks whose dependencies are all complete.
 * @param {string} userId
 */
export async function unblockDependentTasks(userId) {
  const blocked = await Task.find({ user: userId, status: "blocked" }).limit(100);
  for (const task of blocked) {
    const deps = task.dependsOn || [];
    if (!deps.length) {
      task.status = "pending";
      await task.save();
      continue;
    }
    const open = await Task.countDocuments({
      user: userId,
      _id: { $in: deps },
      status: { $nin: ["done", "cancelled"] },
    });
    if (open === 0) {
      task.status = "pending";
      task.events.push({ type: "unblocked", payload: { reason: "dependencies_met" } });
      await task.save();
    }
  }
}
