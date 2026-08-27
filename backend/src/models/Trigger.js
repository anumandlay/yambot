/**
 * @fileoverview Trigger model — time/event/condition/threshold/change/anomaly automation.
 * Purpose: Define when the workforce should act without a human prompt.
 * Downstream: triggerEngine.js, Operations UI.
 */

import mongoose from "mongoose";
import { normalizeGoalEventType } from "./Goal.js";

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
    /** Event bus type emitted when this trigger's enqueued task completes successfully. */
    completionEventType: { type: String, default: "", trim: true },
    /** Event bus type emitted when this trigger's enqueued task fails. */
    completionEventOnFailure: { type: String, default: "", trim: true },
    /** When true, LLM reads task result and emits one of outcomeBranches after completion. */
    outcomeRoutingEnabled: { type: Boolean, default: false },
    outcomeBranches: {
      type: [
        {
          label: { type: String, default: "", trim: true },
          eventType: { type: String, default: "", trim: true },
          description: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },
    completionActionsEnabled: { type: Boolean, default: false },
    completionActionsPickMode: { type: String, enum: ["rules", "llm"], default: "rules" },
    completionActions: {
      type: [
        {
          label: { type: String, default: "", trim: true },
          runOn: { type: String, enum: ["success", "failure", "both"], default: "success" },
          when: { type: String, default: "", trim: true },
          kind: { type: String, enum: ["instruction", "goal"], default: "instruction" },
          agentId: { type: String, default: "", trim: true },
          goalId: { type: String, default: "", trim: true },
          instructions: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },
    lastFiredAt: { type: Date, default: null },
    fireCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Trigger = mongoose.model("Trigger", triggerSchema);

/** @param {string} value @returns {string} */
export function normalizeTriggerEventType(value) {
  return normalizeGoalEventType(value);
}
