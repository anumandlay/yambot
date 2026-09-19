/**
 * @fileoverview Agent schedule tick — enqueues goals when nextRunAt is due.
 * Purpose: Run each agent's saved schedule without a separate cron daemon.
 * Downstream: Chat/Message/Task models (same path as a manual chat goal).
 */

import { Agent, computeNextRunAt, listAgentScheduleJobs, toAgentSnapshot } from "../models/Agent.js";
import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { ensureAgentChat, unblockDependentTasks } from "./enqueueTask.js";
import { User } from "../models/User.js";
import { emitEvent } from "./eventBus.js";
import { tickTriggers } from "./triggerEngine.js";
import {
  tickConditionTriggers,
  tickThresholdTriggers,
  tickAnomalyTriggers,
} from "./triggerEvaluators.js";
import { tickWatchers } from "./watcherEngine.js";
import { tickGoalAutonomy } from "./goalAutonomy.js";
import { tickManagerAutonomy } from "./managerAutonomy.js";
import { tickPerformanceReviews } from "./performanceReview.js";
import { tickImprovementProposals } from "./improvementLoop.js";
import { tickBusinessPulse } from "./businessPulse.js";
import { tickCeoAutonomy } from "./ceoAutonomy.js";
import { tickCanaryMonitor } from "./workflowCanary.js";
import { tickModelRouting } from "./modelRouter.js";
import { tickContinuousOptimize } from "./continuousOptimize.js";
import { tickWorkflowWaits } from "./apiWorkflowRunner.js";
import { tickApiAgents } from "./apiAgentRunner.js";
import { tickEventDelivery } from "./eventDelivery.js";
import { tickEmailInboxWatcher } from "./emailInboxWatcher.js";
import { tickCampaigns } from "./campaignEngine.js";
import { tickTicketSla } from "./ticketSla.js";
import { tickScheduledReports } from "./scheduledReports.js";

/**
 * Uses the agent's single chat (one chat per agent).
 * @param {import('mongoose').Document} agent
 * @param {object} [job]
 * @returns {Promise<import('mongoose').Document>}
 */
async function ensureScheduleChat(agent, job = null) {
  const chat = await ensureAgentChat(agent.user, agent._id, {
    agentName: agent.name,
    title: agent.name,
  });
  if (job) {
    job.chatId = chat._id;
  } else {
    agent.schedule = agent.schedule || {};
    agent.schedule.chatId = chat._id;
  }
  return chat;
}

/**
 * Enqueues one scheduled goal for an agent (skips if already busy).
 * @param {import('mongoose').Document} agent
 * @param {object} [job] — one entry from schedules[]; defaults to legacy agent.schedule
 * @returns {Promise<{ ok: boolean, skipped?: string, taskId?: string }>}
 */
export async function runScheduledAgent(agent, job = null) {
  const sched = job || agent.schedule || {};
  const goal = String(sched.goal || "").trim();
  if (!sched.enabled || !goal) {
    return { ok: false, skipped: "disabled_or_empty" };
  }

  const busy = await Task.exists({
    agent: agent._id,
    status: { $in: ["pending", "running", "waiting_user"] },
  });
  if (busy) {
    // Why: push nextRunAt so we retry later instead of spamming the queue.
    sched.nextRunAt = computeNextRunAt(sched, new Date());
    await agent.save();
    return { ok: false, skipped: "busy" };
  }

  const chat = await ensureScheduleChat(agent, job ? sched : null);
  const owner = await User.findById(agent.user);
  const { resolveLlmCredentialsForAgent } = await import("./llmCredentials.js");
  const { resolveCuratedMemoryForPrompt } = await import("./semanticMemory.js");
  const creds = owner ? await resolveLlmCredentialsForAgent(owner, agent) : null;
  const curated = await resolveCuratedMemoryForPrompt({
    userEntries: owner?.curatedMemory?.entries,
    agentEntries: agent.curatedMemory?.entries,
    goal,
    creds,
  });
  const snapshot = toAgentSnapshot(agent, {
    goal,
    userCuratedEntries: curated.userCuratedEntries,
    agentCuratedEntries: curated.agentCuratedEntries,
  });
  const now = new Date();
  const jobLabel = String(sched.name || "").trim();

  const message = await Message.create({
    chat: chat._id,
    role: "user",
    content: goal,
    meta: {
      kind: "scheduled",
      scheduleJobId: sched._id ? String(sched._id) : null,
      scheduleName: jobLabel || null,
    },
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
          scheduleJobId: sched._id ? String(sched._id) : null,
          scheduleName: jobLabel || null,
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
    content:
      (agent.mode || "browser") === "api"
        ? `Scheduled goal${jobLabel ? ` (“${jobLabel}”)` : ""} queued for API agent “${agent.name}” (no live computer).`
        : `Scheduled goal${jobLabel ? ` (“${jobLabel}”)` : ""} queued for “${agent.name}”.`,
    meta: {
      taskId: task._id,
      status: "pending",
      scheduled: true,
      ui: "icon",
      kind: "queued",
    },
  });

  chat.updatedAt = now;
  await chat.save();

  sched.lastRunAt = now;
  sched.nextRunAt = computeNextRunAt(sched, now);
  sched.chatId = chat._id;

  // Why: keep legacy mirror in sync when firing the first schedules[] job.
  if (job && Array.isArray(agent.schedules) && agent.schedules[0] && String(agent.schedules[0]._id) === String(job._id)) {
    agent.schedule = agent.schedule || {};
    agent.schedule.lastRunAt = sched.lastRunAt;
    agent.schedule.nextRunAt = sched.nextRunAt;
    agent.schedule.chatId = chat._id;
  } else if (!job) {
    agent.schedule.lastRunAt = now;
    agent.schedule.nextRunAt = sched.nextRunAt;
    agent.schedule.chatId = chat._id;
  }

  await agent.save();

  if ((agent.mode || "browser") === "api") {
    const { kickApiAgent } = await import("./apiAgentRunner.js");
    kickApiAgent(agent._id, agent.user);
  }

  return { ok: true, taskId: String(task._id) };
}

/**
 * @param {object} sched
 * @param {Date} now
 * @returns {boolean}
 */
function scheduleJobIsDue(sched, now) {
  if (!sched?.enabled || !String(sched.goal || "").trim()) return false;
  if (!sched.nextRunAt) return true;
  return new Date(sched.nextRunAt).getTime() <= now.getTime();
}

/**
 * Due agents: any enabled schedule job with nextRunAt <= now (or missing nextRunAt).
 */
export async function tickAgentSchedules() {
  const now = new Date();
  const due = await Agent.find({
    active: { $ne: false },
    $or: [
      {
        "schedule.enabled": true,
        "schedule.goal": { $nin: [null, ""] },
        $or: [
          { "schedule.nextRunAt": { $lte: now } },
          { "schedule.nextRunAt": null },
          { "schedule.nextRunAt": { $exists: false } },
        ],
      },
      {
        schedules: {
          $elemMatch: {
            enabled: true,
            goal: { $nin: [null, ""] },
            $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: null }, { nextRunAt: { $exists: false } }],
          },
        },
      },
    ],
  });

  let ran = 0;
  let skipped = 0;
  let checked = 0;
  for (const agent of due) {
    const jobs = listAgentScheduleJobs(agent);
    const useMulti = Array.isArray(agent.schedules) && agent.schedules.length > 0;
    for (const job of jobs) {
      checked += 1;
      try {
        if (!scheduleJobIsDue(job, now)) {
          skipped += 1;
          continue;
        }
        if (!job.nextRunAt) job.nextRunAt = now;
        const result = await runScheduledAgent(agent, useMulti ? job : null);
        if (result.ok) ran += 1;
        else skipped += 1;
      } catch (err) {
        console.error(`[scheduler] agent ${agent._id} job ${job?._id || "legacy"}:`, err?.message || err);
        try {
          job.nextRunAt = computeNextRunAt(job, new Date());
          await agent.save();
        } catch {
          /* ignore */
        }
        skipped += 1;
      }
    }
  }
  return { ran, skipped, checked };
}

/**
 * Bump priority for tasks stuck in waiting_user beyond policy threshold.
 */
export async function tickTaskEscalations() {
  const users = await User.find({}).select("_id settings").lean();
  let escalated = 0;

  for (const u of users) {
    const minutes = Number(u.settings?.escalateWaitingMinutes) || 0;
    if (minutes <= 0) continue;

    const cutoff = new Date(Date.now() - minutes * 60_000);
    const stuck = await Task.find({
      user: u._id,
      status: "waiting_user",
      updatedAt: { $lte: cutoff },
      escalationLevel: { $lt: 3 },
    }).limit(50);

    for (const task of stuck) {
      task.escalationLevel = (task.escalationLevel || 0) + 1;
      task.priorityRank = Math.min(100, (task.priorityRank || 50) + 15);
      task.events.push({
        type: "escalated",
        payload: { level: task.escalationLevel, reason: "waiting_user_timeout" },
      });
      await task.save();
      escalated += 1;
    }
  }

  return { escalated };
}

/**
 * Marks SLA-breached pending/running tasks and boosts priority.
 */
export async function tickSlaBreaches() {
  const now = new Date();
  const breached = await Task.find({
    slaDeadline: { $lte: now, $ne: null },
    status: { $in: ["pending", "running", "waiting_user", "blocked"] },
  }).limit(50);

  let count = 0;
  for (const task of breached) {
    task.priorityRank = Math.min(100, (task.priorityRank || 2) + 25);
    task.events.push({ type: "sla_breach", payload: { slaName: task.slaName } });
    await task.save();
    await emitEvent({
      userId: task.user,
      type: "sla.breached",
      source: "system",
      significance: "high",
      taskId: task._id,
      agentId: task.agent,
      goalId: task.goalRef,
      summary: `SLA breached: ${task.slaName || "task"}`,
    });
    count += 1;
  }
  return { breached: count };
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
      const esc = await tickTaskEscalations();
      const sla = await tickSlaBreaches();
      const triggers = await tickTriggers();
      const condTriggers = await tickConditionTriggers();
      const threshTriggers = await tickThresholdTriggers();
      const anomalyTriggers = await tickAnomalyTriggers();
      const watchers = await tickWatchers();
      const goals = await tickGoalAutonomy();
      const managers = await tickManagerAutonomy();
      const reviews = await tickPerformanceReviews();
      const improvements = await tickImprovementProposals();
      const pulse = await tickBusinessPulse();
      const ceo = await tickCeoAutonomy();
      const canary = await tickCanaryMonitor();
      const modelRoute = await tickModelRouting();
      const continuous = await tickContinuousOptimize();
      const waits = await tickWorkflowWaits();
      const apiAgents = await tickApiAgents();
      const delivery = await tickEventDelivery();
      const emailWatch = await tickEmailInboxWatcher();
      const campaigns = await tickCampaigns();
      const ticketSla = await tickTicketSla();
      const reports = await tickScheduledReports();
      await unblockDependentTasksForAll();

      if (
        result.ran ||
        result.checked ||
        esc.escalated ||
        sla.breached ||
        triggers.fired ||
        condTriggers.fired ||
        threshTriggers.fired ||
        anomalyTriggers.fired ||
        watchers.changed ||
        goals.spawned ||
        managers.delegated ||
        pulse.autoApplied ||
        ceo.executed ||
        ceo.recommended ||
        canary.rolledBack ||
        modelRoute.applied ||
        continuous.promoted ||
        continuous.started ||
        waits.resumed ||
        apiAgents.ran ||
        delivery.ok ||
        emailWatch.newMessages ||
        campaigns.enqueued ||
        ticketSla.breached ||
        reports.sent
      ) {
        console.log(
          `[scheduler] schedules=${result.ran}/${result.checked} escalated=${esc.escalated} sla=${sla.breached} triggers=${triggers.fired}+${condTriggers.fired}+${threshTriggers.fired}+${anomalyTriggers.fired} watchers=${watchers.changed} goals=${goals.spawned} managers=${managers.delegated} reviews=${reviews.generated} improvements=${improvements.created} pulseAuto=${pulse.autoApplied} ceoExec=${ceo.executed} ceoRec=${ceo.recommended} canaryRb=${canary.rolledBack} modelRoute=${modelRoute.applied} optPromo=${continuous.promoted} wfWaits=${waits.resumed} apiAgents=${apiAgents.ran}/${apiAgents.checked} evtRetry=${delivery.ok} emailNew=${emailWatch.newMessages} campaigns=${campaigns.enqueued} ticketSla=${ticketSla.breached} reports=${reports.sent}`
        );
      }
    } catch (err) {
      console.error("[scheduler] tick failed", err);
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
  // Why: API agents have no worker heartbeat — poll pending API tasks more often than the full scheduler.
  setInterval(() => {
    void tickApiAgents().catch((err) =>
      console.error("[scheduler] apiAgents tick failed", err?.message || err)
    );
  }, 15_000);
  console.log(`[scheduler] started (every ${intervalMs}ms; api agents every 15s)`);
}

/** Unblocks dependency-ready tasks for all users with blocked queue items. */
async function unblockDependentTasksForAll() {
  const users = await Task.distinct("user", { status: "blocked" });
  for (const userId of users) {
    await unblockDependentTasks(userId);
  }
}
