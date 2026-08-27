/**
 * @fileoverview Invoice model — billing documents linked to customers/entities.
 * Purpose: Basic invoicing workflow (draft → sent → paid) for agent-assisted billing.
 * Downstream: invoices routes, worker update_invoice action.
 */

import mongoose from "mongoose";

export const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "cancelled"];

const invoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    number: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: INVOICE_STATUSES, default: "draft", index: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "USD", trim: true },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    dueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    lineItems: {
      type: [{ description: String, quantity: Number, unitPrice: Number }],
      default: [],
    },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

invoiceSchema.index({ user: 1, number: 1 }, { unique: true });

export const Invoice = mongoose.model("Invoice", invoiceSchema);
