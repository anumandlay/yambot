/**
 * @fileoverview Events API — company event bus feed + webhook ingest.
 * Purpose: Expose event stream and accept external integrations (CRM, email, etc.).
 * Downstream: CompanyEvent model, triggerEngine.
 */

import { Router } from "express";
import { listEvents, emitEvent } from "../utils/eventBus.js";
import { getEventCatalog } from "../utils/eventCatalog.js";
import { listDeadLetters, replayEvent } from "../utils/eventDelivery.js";

export const eventsRouter = Router();

eventsRouter.get("/catalog", (_req, res) => {
  res.json({ ok: true, catalog: getEventCatalog() });
});

eventsRouter.get("/", async (req, res, next) => {
  try {
    const events = await listEvents(req.userId, {
      limit: req.query.limit,
      type: req.query.type,
      unprocessed: req.query.unprocessed === "1",
      correlationId: req.query.correlationId,
      entityId: req.query.entityId,
    });
    res.json({ ok: true, events });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/events/webhook — ingest external events.
 * Body: { type, summary?, payload?, agentId?, goalId? }
 */
eventsRouter.post("/webhook", async (req, res, next) => {
  try {
    const type = String(req.body?.type || "").trim();
    if (!type) {
      res.status(400).json({ ok: false, detail: "type required" });
      return;
    }
    const event = await emitEvent({
      userId: req.userId,
      type,
      source: "webhook",
      summary: req.body?.summary || "",
      payload: req.body?.payload || {},
      agentId: req.body?.agentId,
      goalId: req.body?.goalId,
      significance: req.body?.significance || "medium",
    });
    res.status(201).json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});

eventsRouter.post("/emit", async (req, res, next) => {
  try {
    const event = await emitEvent({
      userId: req.userId,
      type: req.body?.type || "user.note",
      source: "user",
      summary: req.body?.summary || "",
      payload: req.body?.payload || {},
      agentId: req.body?.agentId,
      goalId: req.body?.goalId,
      dedupeKey: req.body?.dedupeKey,
      correlationId: req.body?.correlationId,
    });
    res.status(201).json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/events/dead-letters — DLQ feed.
 */
eventsRouter.get("/dead-letters", async (req, res, next) => {
  try {
    const events = await listDeadLetters(req.userId, { limit: req.query.limit });
    res.json({ ok: true, events });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/events/:id/replay — force re-delivery from DLQ / failed.
 */
eventsRouter.post("/:id/replay", async (req, res, next) => {
  try {
    const result = await replayEvent(req.userId, req.params.id);
    if (!result.ok && result.title === "Missing") {
      res.status(404).json(result);
      return;
    }
    res.json({ ok: Boolean(result.ok), result });
  } catch (err) {
    next(err);
  }
});
