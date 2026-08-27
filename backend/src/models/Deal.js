/**
 * @fileoverview Deal model — sales pipeline opportunities linked to entities.
 * Purpose: CRM deal stages, amounts, and forecast beyond lead entities.
 * Downstream: deals routes, Company/Queues UI, worker search_deals action.
 */

import mongoose from "mongoose";

export const DEAL_STAGES = [
  "prospect",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

const dealSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    stage: { type: String, enum: DEAL_STAGES, default: "prospect", index: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "USD", trim: true },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    assigneeAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    expectedCloseAt: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Deal = mongoose.model("Deal", dealSchema);
