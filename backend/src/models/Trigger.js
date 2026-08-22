/**
 * @fileoverview Trigger model — time/event/condition/threshold/change/anomaly automation.
 * Purpose: Define when the workforce should act without a human prompt.
 * Downstream: triggerEngine.js, Operations UI.
 */

import mongoose from "mongoose";

export const TRIGGER_TYPES = ["time", "event", "condition", "threshold", "change", "anomaly"];
export const TRIGGER_ACTIONS = ["enqueue_task", "emit_event", "delegate_goal", "escalate"];

const triggerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true, index: true },
    type: {
      type: String,
      enum: TRIGGER_TYPES,
      required: true,
      index: true,
    },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null, index: true },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: "Goal", default: null, index: true },
    /** Type-specific config: eventType, cron, metric, threshold, etc. */
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    action: {
      type: String,
      enum: TRIGGER_ACTIONS,
      default: "enqueue_task",
    },
    actionConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastFiredAt: { type: Date, default: null },
    fireCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Trigger = mongoose.model("Trigger", triggerSchema);
