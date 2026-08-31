/**
 * @fileoverview Event bus — emit and process company events (BOS envelope).
 * Purpose: Central nervous system with normalized types + correlation IDs + delivery guarantees.
 * Downstream: triggerEngine, watcherEngine, autonomy loops, workflows, heal.
 */

import { CompanyEvent } from "../models/CompanyEvent.js";
import { writeAudit } from "./audit.js";
import { normalizeEventType, mintCorrelationId } from "./eventCatalog.js";
import { buildDedupeKey, deliverEvent } from "./eventDelivery.js";

/**
 * @param {object} opts
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function emitEvent(opts) {
  const type = normalizeEventType(opts.type || "system.note");
  const payload =
    opts.payload && typeof opts.payload === "object" ? { ...opts.payload } : {};
  const correlationId =
    String(opts.correlationId || payload.correlationId || "").trim() ||
    mintCorrelationId();
  payload.correlationId = correlationId;
  if (opts.causationId) payload.causationId = String(opts.causationId);
  if (opts.entityType) payload.entityType = String(opts.entityType);

  let source = String(opts.source || "system").trim() || "system";
  const { EVENT_SOURCES } = await import("../models/CompanyEvent.js");
  if (!EVENT_SOURCES.includes(source)) {
    payload.rawSource = source;
    source = "system";
  }

  const dedupeKey = buildDedupeKey(type, correlationId, opts.dedupeKey);
  if (dedupeKey) {
    const existing = await CompanyEvent.findOne({
      user: opts.userId,
      dedupeKey,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) },
    }).lean();
    if (existing) {
      // Why: duplicate webhooks / double emits must not fire agents twice.
      return existing;
    }
  }

  const event = await CompanyEvent.create({
    user: opts.userId,
    schemaVersion: 1,
    type,
    source,
    significance: opts.significance || "medium",
    correlationId,
    agent: opts.agentId || null,
    goal: opts.goalId || null,
    task: opts.taskId || null,
    entity: opts.entityId || null,
    entityType: String(opts.entityType || payload.entityType || "").slice(0, 40),
    summary: String(opts.summary || "").slice(0, 2000),
    payload,
    processed: false,
    dedupeKey: dedupeKey || "",
    deliveryAttempts: 0,
  });

  await writeAudit({
    userId: opts.userId,
    action: `event.${event.type}`,
    agentId: opts.agentId ? String(opts.agentId) : null,
    goalId: opts.goalId ? String(opts.goalId) : null,
    taskId: opts.taskId ? String(opts.taskId) : null,
    detail: event.summary?.slice(0, 500) || event.type,
    meta: { eventId: String(event._id), correlationId, dedupeKey },
  });

  await deliverEvent(event);
  return event;
}

/**
 * @param {string} userId
 * @param {{ limit?: number, type?: string, unprocessed?: boolean, correlationId?: string, entityId?: string }} [opts]
 */
export async function listEvents(userId, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const filter = { user: userId };
  if (opts.type) filter.type = normalizeEventType(opts.type);
  if (opts.unprocessed) filter.processed = false;
  if (opts.correlationId) filter.correlationId = String(opts.correlationId);
  if (opts.entityId) filter.entity = opts.entityId;
  return CompanyEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}
