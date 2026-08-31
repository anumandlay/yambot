/**
 * @fileoverview Trigger engine — evaluates triggers and fires actions.
 * Purpose: Time/event/condition/threshold/change/anomaly → tasks, events, delegation.
 * Downstream: scheduler tick, eventBus on emit.
 */

import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { Chat } from "../models/Chat.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";
import { buildInvestigationGoal } from "./investigation.js";
import { shouldFireCronTrigger } from "./cronMatch.js";
import { Ticket } from "../models/Ticket.js";
import { normalizeEventType } from "./eventCatalog.js";

/**
 * @param {import('mongoose').Document} event
 */
export async function processEventTriggers(event) {
  const type = normalizeEventType(event.type);
  // Why: older triggers may store underscored aliases — match both forms.
  const aliases = [type, type.replace(/\./g, "_"), String(event.type || "")].filter(Boolean);
  const triggers = await Trigger.find({
    user: event.user,
    enabled: true,
    type: "event",
    "config.eventType": { $in: [...new Set(aliases)] },
  }).limit(20);

  for (const trigger of triggers) {
    await fireTrigger(trigger, {
      event,
      correlationId: event.correlationId || event.payload?.correlationId,
    });
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
    const cron = String(trigger.config?.cron || "").trim();
    if (cron) {
      if (!shouldFireCronTrigger(trigger.config, new Date())) continue;
      const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
      if (now - last < 60_000) continue;
    } else {
      const intervalMin = Math.max(5, Number(trigger.config?.intervalMinutes) || 60);
      const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
      if (now - last < intervalMin * 60_000) continue;
    }
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
    let instructions =
      cfg.instructions ||
      cfg.goalText ||
      cfg.goal ||
      `Autonomous work from trigger "${trigger.name}"`;
    const eventPayload = ctx.event?.payload && typeof ctx.event.payload === "object" ? ctx.event.payload : {};
    const ticketId = eventPayload.ticketId ? String(eventPayload.ticketId) : "";
    const entityId =
      eventPayload.entityId
        ? String(eventPayload.entityId)
        : ctx.event?.entity
          ? String(ctx.event.entity)
          : "";
    const correlationId =
      String(ctx.correlationId || ctx.event?.correlationId || eventPayload.correlationId || "").trim();
    if (correlationId) {
      instructions = `${instructions}\n\ncorrelationId=${correlationId}`;
    }
    if (ctx.event?.type) {
      instructions = `${instructions}\nhandoffEvent=${ctx.event.type}`;
    }

    if (ticketId && (cfg.injectTicketContext || ctx.event?.type === "ticket.created")) {
      const ticket = await Ticket.findById(ticketId).lean();
      if (ticket) {
        instructions = [
          instructions,
          "",
          "TICKET CONTEXT:",
          `ticketId: ${ticketId}`,
          `Title: ${ticket.title}`,
          `Status: ${ticket.status}`,
          `Priority: ${ticket.priority}`,
          `Description: ${String(ticket.description || "").slice(0, 1500)}`,
          ticket.publicToken ? `Customer portal: /portal/ticket/${ticket.publicToken}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

    const chatTitle = `Trigger · ${trigger.name}`.slice(0, 80);
    let chatId = eventPayload.chatId || cfg.chatId || undefined;
    if (!chatId) {
      const existing = await Chat.findOne({
        user: userId,
        agent: trigger.agent,
        title: chatTitle,
      })
        .sort({ updatedAt: -1 })
        .select("_id")
        .lean();
      if (existing?._id) chatId = String(existing._id);
    }
    const enqueued = await enqueueTask({
      userId,
      agentId: String(trigger.agent),
      goalText: instructions,
      goalRef: trigger.goal ? String(trigger.goal) : null,
      triggerRef: String(trigger._id),
      chatId,
      priority: cfg.priority || "normal",
      source: `trigger:${trigger._id}`,
      chatTitle,
      entityRef: entityId || undefined,
      ticketRef: ticketId || undefined,
      meta: {
        triggerId: String(trigger._id),
        triggerName: trigger.name,
        triggerEventType: ctx.event?.type || null,
        ticketId: ticketId || null,
        entityId: entityId || null,
        correlationId: correlationId || null,
      },
    });
    if (!cfg.chatId && enqueued.chat?._id) {
      trigger.actionConfig = { ...cfg, chatId: String(enqueued.chat._id) };
    }
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
