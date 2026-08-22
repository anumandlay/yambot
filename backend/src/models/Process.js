/**
 * @fileoverview Process models — workflow graphs and running instances (process mining seed).
 * Purpose: Represent company processes, track stage, detect bottlenecks.
 * Downstream: processes routes, manager autonomy, BI endpoints.
 */

import mongoose from "mongoose";

const stageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const processDefinitionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    stages: { type: [stageSchema], default: [] },
    transitions: {
      type: [{ from: String, to: String }],
      default: [],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const processInstanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    definition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProcessDefinition",
      required: true,
      index: true,
    },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    currentStage: { type: String, default: "", index: true },
    status: {
      type: String,
      enum: ["active", "completed", "stuck", "cancelled"],
      default: "active",
      index: true,
    },
    history: {
      type: [
        {
          stage: String,
          at: { type: Date, default: Date.now },
          note: { type: String, default: "" },
        },
      ],
      default: [],
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ProcessDefinition = mongoose.model("ProcessDefinition", processDefinitionSchema);
export const ProcessInstance = mongoose.model("ProcessInstance", processInstanceSchema);

/**
 * Computes stage counts for bottleneck analysis.
 * @param {import('mongoose').Types.ObjectId} userId
 * @param {string} definitionId
 */
export async function computeProcessBottlenecks(userId, definitionId) {
  const rows = await ProcessInstance.aggregate([
    {
      $match: {
        user: userId,
        definition: new mongoose.Types.ObjectId(definitionId),
        status: "active",
      },
    },
    { $group: { _id: "$currentStage", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((r) => ({ stage: r._id || "(unset)", count: r.count }));
}
