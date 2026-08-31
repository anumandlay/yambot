/**
 * @fileoverview CompanyEvent — event bus storage (Digital Workforce nervous system).
 * Purpose: Persist company-wide signals for triggers, autonomy loops, workflows, audit.
 * Downstream: eventBus.js, triggerEngine, watcherEngine, governance UI.
 */

import mongoose from "mongoose";

export const EVENT_SOURCES = [
  "system",
  "webhook",
  "watcher",
  "trigger",
  "goal",
  "goal_autonomy",
  "task",
  "agent",
  "worker",
  "skills",
  "anomaly",
  "user",
  "manager_autonomy",
  "email_watcher",
  "campaign_engine",
  "ceo_pulse",
  "workflow",
  "heal",
  "kpi_updater",
  "ticket_engine",
  "state_helper",
];

const companyEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    schemaVersion: { type: Number, default: 1 },
    type: { type: String, required: true, trim: true, index: true },
    source: {
      type: String,
      enum: EVENT_SOURCES,
      default: "system",
      index: true,
    },
    significance: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    correlationId: { type: String, default: "", trim: true, index: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null, index: true },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: "Goal", default: null, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null, index: true },
    entity: { type: mongoose.Schema.Types.ObjectId, ref: "Entity", default: null, index: true },
    entityType: { type: String, default: "", trim: true },
    summary: { type: String, default: "", trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    processed: { type: Boolean, default: false, index: true },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

companyEventSchema.index({ user: 1, createdAt: -1 });
companyEventSchema.index({ user: 1, type: 1, correlationId: 1 });

export const CompanyEvent = mongoose.model("CompanyEvent", companyEventSchema);
