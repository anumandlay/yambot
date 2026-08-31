/**
 * @fileoverview Entity model — company objects with temporal memory (world model seed).
 * Purpose: Track customers, leads, vendors, products with observation history.
 * Downstream: entity routes, goal autonomy, investigation evidence; group = territory; kind = custom table.
 */

import mongoose from "mongoose";

/**
 * Fixed world-model categories (agents cannot invent new type strings).
 * Use `kind` for user segments/tables (airlines, weather) inside a type.
 * - lead: prospect not sold yet
 * - customer: won / paying account
 * - vendor: supplier you buy from
 * - product: thing you sell
 * - process: workflow-linked object (prefer Process definitions UI)
 * - document: contract/file-style record
 * - ticket: support case as entity (prefer Ticket queue for email)
 * - custom: invented datasets; pair with kind + attributes
 */
export const ENTITY_TYPES = [
  "lead",
  "customer",
  "vendor",
  "product",
  "process",
  "document",
  "ticket",
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
    /**
     * Territory folder — same EntityGroup as Agent.group (type agent), e.g. USA.
     * Agents in that group share this lead pool; other groups cannot see it.
     */
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EntityGroup",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ENTITY_TYPES,
      default: "custom",
      index: true,
    },
    /**
     * Custom table name within the territory (e.g. weather, inventory).
     * Empty for normal leads/customers; use with type "custom" for ad-hoc datasets.
     */
    kind: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    externalId: { type: String, default: "", trim: true, index: true },
    status: { type: String, default: "active", trim: true },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    /**
     * Ontology relationships to other entities (customer←lead, order→invoice, …).
     */
    links: {
      type: [
        {
          rel: { type: String, default: "related_to", trim: true },
          entityId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Entity",
            required: true,
          },
        },
      ],
      default: [],
    },
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

entitySchema.index({ user: 1, group: 1, type: 1, status: 1 });
entitySchema.index({ user: 1, group: 1, kind: 1, status: 1 });

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
