/**
 * @fileoverview Entity model — company objects with temporal memory (world model seed).
 * Purpose: Track customers, leads, vendors, products with observation history.
 * Downstream: entity routes, goal autonomy, investigation evidence.
 */

import mongoose from "mongoose";

export const ENTITY_TYPES = [
  "customer",
  "lead",
  "vendor",
  "product",
  "process",
  "document",
  "custom",
];

const observationSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    source: { type: String, default: "system", trim: true },
    kind: { type: String, default: "note", trim: true },
    content: { type: String, default: "", trim: true },
    confidence: { type: Number, default: 1, min: 0, max: 1 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const entitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ENTITY_TYPES,
      default: "custom",
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    externalId: { type: String, default: "", trim: true, index: true },
    status: { type: String, default: "active", trim: true },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Temporal memory — newest observations last (capped on write). */
    observations: { type: [observationSchema], default: [] },
    relatedGoals: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Goal" }],
      default: [],
    },
    relatedAgents: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * @param {import('mongoose').Document} entity
 * @param {object} obs
 */
export function appendEntityObservation(entity, obs) {
  entity.observations = entity.observations || [];
  entity.observations.push({
    at: obs.at || new Date(),
    source: obs.source || "system",
    kind: obs.kind || "note",
    content: String(obs.content || "").slice(0, 4000),
    confidence: Math.min(1, Math.max(0, Number(obs.confidence) || 1)),
    meta: obs.meta || {},
  });
  if (entity.observations.length > 100) {
    entity.observations = entity.observations.slice(-100);
  }
  entity.markModified("observations");
}

export const Entity = mongoose.model("Entity", entitySchema);
