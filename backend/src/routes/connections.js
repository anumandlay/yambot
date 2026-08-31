/**
 * @fileoverview Connections API — one-click style integration setup.
 * Purpose: List/connect Slack, CRM, Twilio, etc. via company memory keys.
 * Downstream: ConnectionsPage, Command Center.
 */

import { Router } from "express";
import {
  buildConnectionsStatus,
  upsertConnectionValues,
  CONNECTION_DEFS,
} from "../utils/connectionsCatalog.js";

export const connectionsRouter = Router();

connectionsRouter.get("/", async (req, res, next) => {
  try {
    const data = await buildConnectionsStatus(req.userId);
    res.json({ ...data, defs: CONNECTION_DEFS });
  } catch (err) {
    next(err);
  }
});

connectionsRouter.put("/:id", async (req, res, next) => {
  try {
    const result = await upsertConnectionValues(
      req.userId,
      String(req.params.id || ""),
      req.body?.values || req.body || {}
    );
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
