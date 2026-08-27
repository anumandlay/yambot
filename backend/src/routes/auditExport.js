/**
 * @fileoverview Audit export API — compliance bundle download.
 * Purpose: Export tickets, tasks, emails, audit events for governance.
 * Downstream: GovernancePage or Company export button.
 */

import { Router } from "express";
import { buildAuditExport } from "../utils/auditExport.js";

export const auditRouter = Router();

auditRouter.get("/export", async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const data = await buildAuditExport(req.userId, { since, limit: Number(req.query.limit) || 200 });
    res.json({ ok: true, export: data });
  } catch (err) {
    next(err);
  }
});
