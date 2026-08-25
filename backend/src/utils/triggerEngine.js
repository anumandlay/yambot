/**
 * @fileoverview Trigger engine — evaluates triggers and fires actions.
 * Purpose: Time/event/condition/threshold/change/anomaly → tasks, events, delegation.
 * Downstream: scheduler tick, eventBus on emit.
 */

import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";
import { buildInvestigationGoal } from "./investigation.js";

/**
 * @param {import('mongoose').Document} event
 */
export async function processEventTriggers(event) {
  const triggers = await Trigger.find({
    user: event.user,
    enabled: true,
    type: "event",
    "config.eventType": event.type,
  }).limit(20);

  for (const trigger of triggers) {
    await fireTrigger(trigger, { event });
  }
}

/**
 * Periodic tick for time-based and condition triggers.
 */
export async function tickTriggers() {
  const timeTriggers = await Trigger.find({ enabled: true, type: "time" }).limit(100);
  let fired = 0;
  const now = Date.now();

  for (const trigger of timeTriggers) {
    const intervalMin = Math.max(5, Number(trigger.config?.intervalMinutes) || 60);
    const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
    if (now - last < intervalMin * 60_000) continue;
    await fireTrigger(trigger, {});
    fired += 1;
  }

  return { fired, checked: timeTriggers.length };
}

/**
 * @param {import('mongoose').Document} trigger
 * @param {{ event?: object }} ctx
 */
export async function fireTrigger(trigger, ctx = {}) {
  const cfg = trigger.actionConfig || {};
  const userId = trigger.user;

  if (trigger.action === "emit_event") {
    await emitEvent({
      userId,
      type: cfg.eventType || "trigger.fired",
      source: "trigger",
      agentId: trigger.agent,
      goalId: trigger.goal,
      summary: cfg.summary || `Trigger "${trigger.name}" fired`,
      payload: { triggerId: String(trigger._id), event: ctx.event || null },
    });
  } else if (trigger.action === "enqueue_task" && trigger.agent) {
    const instructions =
      cfg.instructions ||
      cfg.goalText ||
      cfg.goal ||
      `Autonomous work from trigger "${trigger.name}"`;
    const eventPayload = ctx.event?.payload && typeof ctx.event.payload === "object" ? ctx.event.payload : {};
    await enqueueTask({
      userId,
      agentId: String(trigger.agent),
      goalText: instructions,
      goalRef: trigger.goal ? String(trigger.goal) : null,
      triggerRef: String(trigger._id),
      chatId: eventPayload.chatId || cfg.chatId || undefined,
      priority: cfg.priority || "normal",
      source: `trigger:${trigger._id}`,
      chatTitle: `Trigger · ${trigger.name}`.slice(0, 80),
      meta: { triggerId: String(trigger._id), triggerEventType: ctx.event?.type || null },
    });
  } else if (trigger.action === "delegate_goal" && trigger.goal) {
    const goal = await Goal.findOne({ _id: trigger.goal, user: userId });
    if (goal?.agent) {
      await enqueueTask({
        userId,
        agentId: String(goal.agent),
        goalText: buildInvestigationGoal(
          cfg.question || `Assess goal: ${goal.title}`,
          cfg.sources || []
        ),
        goalRef: String(goal._id),
        priority: goal.priority || "high",
        source: `trigger_delegate:${trigger._id}`,
      });
    }
  } else if (trigger.action === "escalate") {
    await emitEvent({
      userId,
      type: "employee.escalated",
      source: "trigger",
      significance: "high",
      agentId: trigger.agent,
      goalId: trigger.goal,
      summary: cfg.summary || `Escalation from trigger "${trigger.name}"`,
      payload: { triggerId: String(trigger._id) },
    });
  }

  trigger.lastFiredAt = new Date();
  trigger.fireCount = (trigger.fireCount || 0) + 1;
  await trigger.save();
}

/**
 * Handles watcher change triggers.
 * @param {object} watcher
 * @param {object} changePayload
 */
export async function fireChangeTriggers(watcher, changePayload) {
  const triggers = await Trigger.find({
    user: watcher.user,
    enabled: true,
    type: "change",
    "config.watcherId": String(watcher._id),
  }).limit(10);

  for (const trigger of triggers) {
    await fireTrigger(trigger, { event: { type: "watcher.change", payload: changePayload } });
  }
}
