/**
 * @fileoverview Audit event model — governance trail (Layer 5).
 * Purpose: Immutable-style log of significant actions for compliance, debugging, and cost review.
 * Downstream: `/api/governance/audit`; written from goals, tasks, agents, worker routes.
 */

import mongoose from "mongoose";

const auditEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    goal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
      index: true,
    },
    detail: { type: String, default: "", maxlength: 2000 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditEventSchema.index({ user: 1, createdAt: -1 });

export const AuditEvent = mongoose.model("AuditEvent", auditEventSchema);
