/**
 * @fileoverview Watchers API — continuous perception monitors CRUD.
 * Purpose: Configure URL/HTTP monitors that emit change events.
 * Downstream: Watcher model, watcherEngine.
 */

import { Router } from "express";
import { Watcher, WATCHER_TARGETS } from "../models/Watcher.js";

export const watchersRouter = Router();

watchersRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, targetTypes: WATCHER_TARGETS });
});

watchersRouter.get("/", async (req, res, next) => {
  try {
    const watchers = await Watcher.find({ user: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, watchers });
  } catch (err) {
    next(err);
  }
});

watchersRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.agentId || !body.target) {
      res.status(400).json({ ok: false, detail: "agentId and target required" });
      return;
    }
    const watcher = await Watcher.create({
      user: req.userId,
      agent: body.agentId,
      name: String(body.name || "Watcher").trim(),
      enabled: body.enabled !== false,
      targetType: WATCHER_TARGETS.includes(body.targetType) ? body.targetType : "url",
      target: String(body.target).trim(),
      intervalMinutes: Math.max(5, Number(body.intervalMinutes) || 30),
      significance: body.significance || "medium",
    });
    res.status(201).json({ ok: true, watcher });
  } catch (err) {
    next(err);
  }
});

watchersRouter.put("/:id", async (req, res, next) => {
  try {
    const watcher = await Watcher.findOne({ _id: req.params.id, user: req.userId });
    if (!watcher) {
      res.status(404).json({ ok: false, detail: "Watcher missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) watcher.name = String(body.name).trim();
    if (body.enabled != null) watcher.enabled = Boolean(body.enabled);
    if (body.target != null) watcher.target = String(body.target).trim();
    if (body.intervalMinutes != null) {
      watcher.intervalMinutes = Math.max(5, Number(body.intervalMinutes) || 30);
    }
    await watcher.save();
    res.json({ ok: true, watcher });
  } catch (err) {
    next(err);
  }
});

watchersRouter.delete("/:id", async (req, res, next) => {
  try {
    await Watcher.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
