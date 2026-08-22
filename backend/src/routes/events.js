/**
 * @fileoverview Events API — company event bus feed + webhook ingest.
 * Purpose: Expose event stream and accept external integrations (CRM, email, etc.).
 * Downstream: CompanyEvent model, triggerEngine.
 */

import { Router } from "express";
import { listEvents, emitEvent } from "../utils/eventBus.js";

export const eventsRouter = Router();

eventsRouter.get("/", async (req, res, next) => {
  try {
    const events = await listEvents(req.userId, {
      limit: req.query.limit,
      type: req.query.type,
      unprocessed: req.query.unprocessed === "1",
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
    });
    res.status(201).json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});
