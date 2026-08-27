/**
 * @fileoverview Invoices API — billing document CRUD.
 * Purpose: Draft/sent/paid invoice workflow for agent-assisted billing.
 * Downstream: InvoicesPage, worker update_invoice.
 */

import { Router } from "express";
import { Invoice, INVOICE_STATUSES } from "../models/Invoice.js";

export const invoicesRouter = Router();

invoicesRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    const invoices = await Invoice.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ ok: true, invoices });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const number = String(body.number || `INV-${Date.now()}`).trim();
    const invoice = await Invoice.create({
      user: req.userId,
      number,
      status: INVOICE_STATUSES.includes(body.status) ? body.status : "draft",
      amount: Number(body.amount) || 0,
      currency: body.currency || "USD",
      entity: body.entityId || null,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : [],
      notes: body.notes || "",
    });
    res.status(201).json({ ok: true, invoice });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.put("/:id", async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, user: req.userId });
    if (!invoice) {
      res.status(404).json({ ok: false, detail: "Invoice missing" });
      return;
    }
    const body = req.body || {};
    if (body.status && INVOICE_STATUSES.includes(body.status)) {
      invoice.status = body.status;
      if (body.status === "paid") invoice.paidAt = new Date();
    }
    if (body.amount != null) invoice.amount = Number(body.amount) || 0;
    if (body.notes != null) invoice.notes = String(body.notes);
    await invoice.save();
    res.json({ ok: true, invoice });
  } catch (err) {
    next(err);
  }
});
