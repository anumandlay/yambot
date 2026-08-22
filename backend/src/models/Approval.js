/**
 * @fileoverview Approval model — human-in-the-loop gates (Layer 2 / Governance).
 * Purpose: Queue policy-driven approval requests from cloud workers before risky actions.
 * Downstream: `/api/approvals`, worker approval wait loop, Governance UI.
 */

import mongoose from "mongoose";

export const APPROVAL_STATUSES = ["pending", "approved", "denied"];
export const APPROVAL_TYPES = ["submit", "login", "navigation", "purchase", "custom"];

const approvalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: APPROVAL_TYPES,
      default: "custom",
      index: true,
    },
    status: {
      type: String,
      enum: APPROVAL_STATUSES,
      default: "pending",
      index: true,
    },
    question: { type: String, default: "", trim: true },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    resolutionNote: { type: String, default: "", trim: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Approval = mongoose.model("Approval", approvalSchema);
