/**
 * @fileoverview Shared task enqueue helper — single path for chats, goals, triggers, autonomy.
 * Purpose: Create Message + Task consistently with priority, SLA, dependencies, and snapshots.
 * Downstream: goals, chats, workforce, triggerEngine, goalAutonomy, managerAutonomy.
 */

import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task, priorityRank } from "../models/Task.js";

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
 * @returns {Promise<{ task: import('mongoose').Document, chat: import('mongoose').Document, message: import('mongoose').Document }>}
 */
export async function enqueueTask(opts) {
  const userId = opts.userId;
  const agentId = opts.agentId;
  const goalText = String(opts.goalText || "").trim();
  if (!userId || !agentId || !goalText) {
    throw Object.assign(new Error("userId, agentId, and goalText required"), { status: 400 });
  }

  const agentDoc = await Agent.findOne({ _id: agentId, user: userId });
  if (!agentDoc) {
    throw Object.assign(new Error("Agent missing"), { status: 404 });
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

  const task = await Task.create({
    user: userId,
    chat: chat._id,
    message: message._id,
    goal: goalText,
    goalRef: opts.goalRef || null,
    triggerRef: opts.triggerRef || opts.meta?.triggerId || null,
    priority,
    priorityRank: priorityRank(priority),
    agent: agentId,
    agentSnapshot: toAgentSnapshot(agentDoc),
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
