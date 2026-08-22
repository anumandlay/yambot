/**
 * @fileoverview Event bus — emit and process company events.
 * Purpose: Central nervous system connecting watchers, triggers, goals, and tasks.
 * Downstream: triggerEngine, watcherEngine, autonomy loops, Operations UI.
 */

import { CompanyEvent } from "../models/CompanyEvent.js";
import { writeAudit } from "./audit.js";
import { processEventTriggers } from "./triggerEngine.js";

/**
 * @param {object} opts
 * @returns {Promise<import('mongoose').Document>}
 */
export async function emitEvent(opts) {
  const event = await CompanyEvent.create({
    user: opts.userId,
    type: String(opts.type || "system.note"),
    source: opts.source || "system",
    significance: opts.significance || "medium",
    agent: opts.agentId || null,
    goal: opts.goalId || null,
    task: opts.taskId || null,
    entity: opts.entityId || null,
    summary: String(opts.summary || "").slice(0, 2000),
    payload: opts.payload && typeof opts.payload === "object" ? opts.payload : {},
    processed: false,
  });

  await writeAudit({
    userId: opts.userId,
    action: `event.${event.type}`,
    agentId: opts.agentId ? String(opts.agentId) : null,
    goalId: opts.goalId ? String(opts.goalId) : null,
    taskId: opts.taskId ? String(opts.taskId) : null,
    detail: event.summary?.slice(0, 500) || event.type,
    meta: { eventId: String(event._id) },
  });

  try {
    await processEventTriggers(event);
    event.processed = true;
    event.processedAt = new Date();
    await event.save();
  } catch (err) {
    console.error("[eventBus] trigger processing failed", err?.message || err);
  }

  return event;
}

/**
 * @param {string} userId
 * @param {{ limit?: number, type?: string, unprocessed?: boolean }} [opts]
 */
export async function listEvents(userId, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const filter = { user: userId };
  if (opts.type) filter.type = String(opts.type);
  if (opts.unprocessed) filter.processed = false;
  return CompanyEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}
