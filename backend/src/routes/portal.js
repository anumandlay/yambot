/**
 * @fileoverview Public portal — customer ticket status (no auth).
 * Purpose: External-facing ticket status page via publicToken.
 * Downstream: PortalTicketPage.
 */

import { Router } from "express";
import { Ticket } from "../models/Ticket.js";

export const portalRouter = Router();

/**
 * GET /api/portal/ticket/:token — public ticket status.
 */
portalRouter.get("/ticket/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    const ticket = await Ticket.findOne({ publicToken: token })
      .select("title status priority updatedAt createdAt slaDueAt")
      .lean();
    if (!ticket) {
      res.status(404).json({ ok: false, detail: "Ticket not found" });
      return;
    }
    res.json({
      ok: true,
      ticket: {
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        updatedAt: ticket.updatedAt,
        createdAt: ticket.createdAt,
        slaDueAt: ticket.slaDueAt,
      },
    });
  } catch (err) {
    next(err);
  }
});
