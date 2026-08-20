/**
 * @fileoverview Agent schedule tick — enqueues goals when nextRunAt is due.
 * Purpose: Run each agent's saved schedule without a separate cron daemon.
 * Downstream: Chat/Message/Task models (same path as a manual chat goal).
 */

import { Agent, computeNextRunAt, toAgentSnapshot } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";

/**
 * Finds or creates the dedicated schedule chat for an agent.
 * @param {import('mongoose').Document} agent
 * @returns {Promise<import('mongoose').Document>}
 */
async function ensureScheduleChat(agent) {
  const title = `Schedule · ${agent.name}`;
  if (agent.schedule?.chatId) {
    const existing = await Chat.findOne({
      _id: agent.schedule.chatId,
      user: agent.user,
      agent: agent._id,
    });
    if (existing) return existing;
  }
  let chat = await Chat.findOne({
    user: agent.user,
    agent: agent._id,
    title,
  });
  if (!chat) {
    chat = await Chat.create({
      user: agent.user,
      agent: agent._id,
      title,
    });
  }
  agent.schedule = agent.schedule || {};
  agent.schedule.chatId = chat._id;
  return chat;
}

/**
 * Enqueues one scheduled goal for an agent (skips if already busy).
 * @param {import('mongoose').Document} agent
 * @returns {Promise<{ ok: boolean, skipped?: string, taskId?: string }>}
 */
export async function runScheduledAgent(agent) {
  const goal = String(agent.schedule?.goal || "").trim();
  if (!agent.schedule?.enabled || !goal) {
    return { ok: false, skipped: "disabled_or_empty" };
  }

  const busy = await Task.exists({
    agent: agent._id,
    status: { $in: ["pending", "running", "waiting_user"] },
  });
  if (busy) {
    // Why: push nextRunAt so we retry later instead of spamming the queue.
    agent.schedule.nextRunAt = computeNextRunAt(agent.schedule, new Date());
    await agent.save();
    return { ok: false, skipped: "busy" };
  }

  const chat = await ensureScheduleChat(agent);
  const snapshot = toAgentSnapshot(agent);
  const now = new Date();

  const message = await Message.create({
    chat: chat._id,
    role: "user",
    content: goal,
    meta: { kind: "scheduled" },
  });

  const runner = agent.runner || "cloud";
  const task = await Task.create({
    user: agent.user,
    chat: chat._id,
    message: message._id,
    goal,
    agent: agent._id,
    agentSnapshot: snapshot,
    runner,
    status: "pending",
    events: [
      {
        type: "queued",
        payload: {
          goal,
          scheduled: true,
          agentId: snapshot.id,
          agentName: snapshot.name,
          runner,
        },
      },
    ],
  });

  await Message.create({
    chat: chat._id,
    role: "system",
    content: `Scheduled goal queued for “${agent.name}”.`,
    meta: { taskId: task._id, status: "pending", scheduled: true },
  });

  chat.updatedAt = now;
  await chat.save();

  agent.schedule.lastRunAt = now;
  agent.schedule.nextRunAt = computeNextRunAt(agent.schedule, now);
  agent.schedule.chatId = chat._id;
  await agent.save();

  return { ok: true, taskId: String(task._id) };
}

/**
 * Due agents: enabled schedule with nextRunAt <= now (or missing nextRunAt).
 */
export async function tickAgentSchedules() {
  const now = new Date();
  const due = await Agent.find({
    active: { $ne: false },
    "schedule.enabled": true,
    "schedule.goal": { $nin: [null, ""] },
    $or: [
      { "schedule.nextRunAt": { $lte: now } },
      { "schedule.nextRunAt": null },
      { "schedule.nextRunAt": { $exists: false } },
    ],
  });

  let ran = 0;
  let skipped = 0;
  for (const agent of due) {
    try {
      if (!agent.schedule.nextRunAt) {
        // Why: treat missing nextRunAt as due now (e.g. just enabled).
        agent.schedule.nextRunAt = now;
      }
      if (new Date(agent.schedule.nextRunAt).getTime() > now.getTime()) {
        skipped += 1;
        continue;
      }
      const result = await runScheduledAgent(agent);
      if (result.ok) ran += 1;
      else skipped += 1;
    } catch (err) {
      console.error(`[scheduler] agent ${agent._id}:`, err?.message || err);
      try {
        agent.schedule.nextRunAt = computeNextRunAt(agent.schedule, new Date());
        await agent.save();
      } catch {
        /* ignore */
      }
    }
  }
  return { ran, skipped, checked: due.length };
}

/**
 * Starts the in-process schedule loop (every ~60s).
 * @param {{ intervalMs?: number }} [opts]
 */
export function startAgentScheduler(opts = {}) {
  const intervalMs = Math.max(30_000, Number(opts.intervalMs) || 60_000);
  const tick = async () => {
    try {
      const result = await tickAgentSchedules();
      if (result.ran || result.checked) {
        console.log(
          `[scheduler] checked=${result.checked} ran=${result.ran} skipped=${result.skipped}`
        );
      }
    } catch (err) {
      console.error("[scheduler] tick failed", err);
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
  console.log(`[scheduler] started (every ${intervalMs}ms)`);
}
