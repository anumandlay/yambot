/**
 * @fileoverview Event delivery guarantees — dedupe, retry, DLQ, replay.
 * Purpose: Durable processing when consumers fail or agents are offline.
 * Downstream: eventBus.emitEvent, scheduler tickEventDelivery, /api/events/replay.
 */

import { CompanyEvent } from "../models/CompanyEvent.js";
import { processEventTriggers } from "./triggerEngine.js";

const MAX_ATTEMPTS = 5;

/**
 * @param {string} type
 * @param {string} correlationId
 * @param {string} [explicit]
 */
export function buildDedupeKey(type, correlationId, explicit) {
  if (explicit) return String(explicit).slice(0, 200);
  if (!correlationId) return "";
  return `${type}:${correlationId}`.slice(0, 200);
}

/**
 * Process a single event with attempt tracking.
 * @param {import('mongoose').Document} event
 */
export async function deliverEvent(event) {
  if (event.deadLettered || event.processed) return { ok: true, skipped: true };
  try {
    await processEventTriggers(event);
    event.processed = true;
    event.processedAt = new Date();
    event.lastDeliveryError = "";
    event.nextRetryAt = null;
    await event.save();
    return { ok: true };
  } catch (err) {
    event.deliveryAttempts = (event.deliveryAttempts || 0) + 1;
    event.lastDeliveryError = String(err?.message || err).slice(0, 500);
    if (event.deliveryAttempts >= MAX_ATTEMPTS) {
      event.deadLettered = true;
      event.nextRetryAt = null;
    } else {
      const backoffMs = Math.min(60 * 60_000, 1000 * 2 ** event.deliveryAttempts);
      event.nextRetryAt = new Date(Date.now() + backoffMs);
    }
    await event.save();
    return { ok: false, detail: event.lastDeliveryError, deadLettered: event.deadLettered };
  }
}

/**
 * Retry unprocessed / failed events due for nextRetryAt.
 * @returns {Promise<{ attempted: number, ok: number, dead: number }>}
 */
export async function tickEventDelivery() {
  const now = new Date();
  const due = await CompanyEvent.find({
    processed: false,
    deadLettered: { $ne: true },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
    deliveryAttempts: { $gt: 0 },
  })
    .sort({ nextRetryAt: 1 })
    .limit(40);

  const stale = await CompanyEvent.find({
    processed: false,
    deadLettered: { $ne: true },
    deliveryAttempts: 0,
    createdAt: { $lte: new Date(Date.now() - 2 * 60_000) },
  })
    .sort({ createdAt: 1 })
    .limit(20);

  const batch = [...due, ...stale];
  let ok = 0;
  let dead = 0;
  for (const ev of batch) {
    const res = await deliverEvent(ev);
    if (res.ok && !res.skipped) ok += 1;
    if (res.deadLettered) dead += 1;
  }
  return { attempted: batch.length, ok, dead };
}

/**
 * Replay an event (force re-process).
 * @param {string} userId
 * @param {string} eventId
 */
export async function replayEvent(userId, eventId) {
  const event = await CompanyEvent.findOne({ _id: eventId, user: userId });
  if (!event) return { ok: false, title: "Missing", detail: "Event not found" };
  event.processed = false;
  event.deadLettered = false;
  event.nextRetryAt = null;
  event.lastDeliveryError = "";
  event.deliveryAttempts = Math.max(0, (event.deliveryAttempts || 0) - 1);
  await event.save();
  return deliverEvent(event);
}

/**
 * List dead-lettered events for a user.
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
export async function listDeadLetters(userId, opts = {}) {
  const limit = Math.min(100, Number(opts.limit) || 50);
  return CompanyEvent.find({ user: userId, deadLettered: true })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}
