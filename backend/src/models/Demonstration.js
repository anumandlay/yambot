/**
 * @fileoverview Demonstration model — captured human workflows for skill generation.
 * Purpose: Record Take-control sessions as training data (observation → action → result).
 * Downstream: skills routes, worker demo capture endpoint.
 */

import mongoose from "mongoose";

const demonstrationSchema = new mongoose.Schema(
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
      index: true,
    },
    title: { type: String, default: "", trim: true },
    steps: {
      type: [
        {
          at: { type: Date, default: Date.now },
          observation: { type: String, default: "" },
          action: { type: mongoose.Schema.Types.Mixed, default: {} },
          result: { type: String, default: "" },
        },
      ],
      default: [],
    },
    convertedSkill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
      default: null,
    },
  },
  { timestamps: true }
);

export const Demonstration = mongoose.model("Demonstration", demonstrationSchema);
