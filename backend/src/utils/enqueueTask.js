/**
 * @fileoverview Shared task enqueue helper — single path for chats, goals, triggers, autonomy.
 * Purpose: Create Message + Task consistently with priority, SLA, dependencies, and snapshots.
 * Downstream: goals, chats, workforce, triggerEngine, goalAutonomy, managerAutonomy.
 */

import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task, priorityRank } from "../models/Task.js";
import { buildCompanyContextBlock, prependContextToGoal } from "./entityContext.js";

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
 * @returns {Promise<{ task: import('mongoose').Document, chat: import('mongoose').Document, message: import('mongoose').Document }>}
 */
export async function enqueueTask(opts) {
  const userId = opts.userId;
  const agentId = opts.agentId;
  let goalText = String(opts.goalText || "").trim();
  if (!userId || !agentId || !goalText) {
    throw Object.assign(new Error("userId, agentId, and goalText required"), { status: 400 });
  }

  // Why: runaway spend must stop new autonomous work before the worker burns budget.
  if (!opts.skipBudgetGuard) {
    const { checkCostCeiling } = await import("./runawayGuards.js");
    const cost = await checkCostCeiling(userId);
    if (!cost.ok) {
      throw Object.assign(new Error(cost.detail || "Company AI budget exhausted"), {
        status: 429,
        title: "Budget",
      });
    }
  }

  const agentDoc = await Agent.findOne({ _id: agentId, user: userId });
  if (!agentDoc) {
    throw Object.assign(new Error("Agent missing"), { status: 404 });
  }

  if (!opts.skipCompanyContext) {
    const contextBlock = await buildCompanyContextBlock(userId, {
      agentId,
      entityId: opts.entityRef || opts.meta?.entityId || null,
      enrollmentId: opts.enrollmentRef || opts.meta?.enrollmentId || null,
      ticketId: opts.ticketRef || opts.meta?.ticketId || null,
    });
    goalText = prependContextToGoal(goalText, contextBlock);
  }

  let chat;
  if (opts.chatId) {
    chat = await Chat.findOne({ _id: opts.chatId, user: userId, agent: agentId });
  }
  if (!chat) {
    chat = await Chat.create({
      user: userId,
      agent: agentId,
      title: String(opts.chatTitle || "Autonomous work").slice(0, 80),
    });
  }

  const message = await Message.create({
    chat: chat._id,
    role: "user",
    content: goalText,
    meta: { ...(opts.meta || {}), source: opts.source || "enqueue" },
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

  const task = await Task.create({
    user: userId,
    chat: chat._id,
    message: message._id,
    goal: goalText,
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
    agentSnapshot: toAgentSnapshot(agentDoc, { goal: goalText }),
    runner: "cloud",
    status: blockedByDeps > 0 ? "blocked" : "pending",
    dependsOn,
    slaDeadline: opts.slaDeadline || null,
    slaName: opts.slaName || "",
    maxDurationMinutes: Math.max(0, Number(opts.maxDurationMinutes) || 0),
    estimatedValueUsd: Math.max(0, Number(opts.estimatedValueUsd) || 0),
    events: [
      {
        type: "queued",
        payload: { source: opts.source || "enqueue", blocked: blockedByDeps > 0 },
      },
    ],
  });

  const source = String(opts.source || "enqueue");
  const triggerLabel =
    opts.meta?.triggerEventType || opts.meta?.triggerName || opts.meta?.triggerId || "";
  const queueHint =
    source.startsWith("trigger:") || opts.triggerRef
      ? `Queued from Operations trigger${triggerLabel ? ` (${triggerLabel})` : ""}.`
      : "Queued for cloud worker.";
  await Message.create({
    chat: chat._id,
    role: "system",
    content: queueHint,
    meta: {
      taskId: task._id,
      kind: "queued",
      status: task.status,
      source,
      triggerId: opts.triggerRef || opts.meta?.triggerId || null,
    },
  });

  chat.updatedAt = new Date();
  await chat.save();

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
