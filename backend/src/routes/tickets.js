/**
 * @fileoverview Tickets API — support queue CRUD and assignment.
 * Purpose: First-class ticket management for Company OS support workflows.
 * Downstream: Ticket model, ticketEngine, QueuesPage.
 */

import { Router } from "express";
import { Ticket, TICKET_STATUSES, TICKET_PRIORITIES } from "../models/Ticket.js";
import { EmailMessage } from "../models/EmailMessage.js";
import { ProcessInstance } from "../models/Process.js";
import { DocumentFile } from "../models/DocumentFile.js";
import { setTicketStatus, finalizeNewTicket } from "../utils/ticketEngine.js";
import { emitEvent } from "../utils/eventBus.js";

export const ticketsRouter = Router();

ticketsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.assignee) filter.assigneeAgent = String(req.query.assignee);
    if (req.query.priority) filter.priority = String(req.query.priority);
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate("requesterEntity", "name attributes")
        .populate("assigneeAgent", "name")
        .lean(),
      Ticket.countDocuments(filter),
    ]);
    res.json({ ok: true, tickets, total, limit });
  } catch (err) {
    next(err);
  }
});

ticketsRouter.get("/stats", async (req, res, next) => {
  try {
    const rows = await Ticket.aggregate([
      { $match: { user: req.userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    res.json({ ok: true, byStatus: rows.map((r) => ({ status: r._id, count: r.count })) });
  } catch (err) {
    next(err);
  }
});

ticketsRouter.get("/:id", async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, user: req.userId })
      .populate("requesterEntity", "name attributes type")
      .populate("assigneeAgent", "name")
      .populate("mirrorEntity", "name type status")
      .lean();
    if (!ticket) {
      res.status(404).json({ ok: false, detail: "Ticket missing" });
      return;
    }
    const [emails, processInstance, documents] = await Promise.all([
      EmailMessage.find({ _id: { $in: ticket.emailMessageIds || [] } })
        .sort({ createdAt: 1 })
        .lean(),
      ticket.processInstance
        ? ProcessInstance.findById(ticket.processInstance).populate("definition", "name stages").lean()
        : null,
      DocumentFile.find({ ticket: ticket._id }).select("-dataBase64").lean(),
    ]);
    res.json({
      ok: true,
      ticket,
      emails,
      processInstance,
      documents,
      portalUrl: ticket.publicToken ? `/portal/ticket/${ticket.publicToken}` : null,
    });
  } catch (err) {
    next(err);
  }
});

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) {
      res.status(400).json({ ok: false, detail: "title required" });
      return;
    }
    const ticket = await Ticket.create({
      user: req.userId,
      title,
      description: String(body.description || "").trim(),
      status: TICKET_STATUSES.includes(body.status) ? body.status : "open",
      priority: TICKET_PRIORITIES.includes(body.priority) ? body.priority : "normal",
      assigneeAgent: body.assigneeAgentId || null,
      requesterEntity: body.requesterEntityId || null,
      source: "manual",
    });
    await finalizeNewTicket(ticket, { isNew: true });
    await emitEvent({
      userId: req.userId,
      type: "ticket.created",
      source: "tickets_api",
      summary: `New ticket: ${ticket.title}`,
      payload: { ticketId: String(ticket._id) },
    });
    res.status(201).json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

ticketsRouter.put("/:id", async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, user: req.userId });
    if (!ticket) {
      res.status(404).json({ ok: false, detail: "Ticket missing" });
      return;
    }
    const body = req.body || {};
    if (body.title != null) ticket.title = String(body.title).trim();
    if (body.description != null) ticket.description = String(body.description).trim();
    if (body.priority && TICKET_PRIORITIES.includes(body.priority)) ticket.priority = body.priority;
    if (body.assigneeAgentId != null) ticket.assigneeAgent = body.assigneeAgentId || null;
    if (body.status && TICKET_STATUSES.includes(body.status)) {
      await setTicketStatus(ticket, body.status, { assigneeAgentId: body.assigneeAgentId });
    } else {
      await ticket.save();
    }
    res.json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

ticketsRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, user: req.userId });
    if (!ticket) {
      res.status(404).json({ ok: false, detail: "Ticket missing" });
      return;
    }
    await setTicketStatus(ticket, "assigned", { assigneeAgentId: req.body?.agentId });
    res.json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});
