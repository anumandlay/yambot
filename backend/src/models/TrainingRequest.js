/**
 * @fileoverview TrainingRequest — employee asks for training on unknown workflows.
 * Purpose: Queue human-led skill creation when agents hit unfamiliar UI.
 * Downstream: Skills/Training UI, governance notifications.
 */

import mongoose from "mongoose";

export const TRAINING_STATUSES = ["pending", "in_progress", "completed", "dismissed"];

const trainingRequestSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
    status: {
      type: String,
      enum: TRAINING_STATUSES,
      default: "pending",
      index: true,
    },
    workflow: { type: String, default: "", trim: true },
    observation: { type: String, default: "", trim: true },
    recommendation: { type: String, default: "", trim: true },
    skill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
      default: null,
    },
  },
  { timestamps: true }
);

export const TrainingRequest = mongoose.model("TrainingRequest", trainingRequestSchema);
