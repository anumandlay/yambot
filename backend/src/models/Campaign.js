/**
 * @fileoverview Campaign + Enrollment — outreach sequences and per-contact state (Phase 3).
 * Purpose: Durable marketing/sales loops with stages and scheduled next actions.
 * Downstream: campaignEngine.js, campaigns API, worker context.
 */

import mongoose from "mongoose";

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "archived"];
export const ENROLLMENT_STAGES = [
  "queued",
  "pending_send",
  "sent",
  "awaiting_reply",
  "engaged",
  "converted",
  "unsubscribed",
  "bounced",
  "failed",
];

const campaignSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    /** Optional goal whose instructions guide each touch. */
    goal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
    },
    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      default: "draft",
      index: true,
    },
    /** Entity type filter when enrolling (e.g. lead). */
    entityType: { type: String, default: "lead", trim: true },
    /** Plain-text templates — {{name}}, {{email}} from entity attributes. */
    emailSubject: { type: String, default: "", trim: true },
    emailBody: { type: String, default: "", trim: true },
    /** Free-text goal override when no linked Goal document. */
    taskInstructions: { type: String, default: "", trim: true },
    followUpDays: { type: [Number], default: [3, 7] },
    batchSize: { type: Number, default: 5, min: 1, max: 50 },
    pollInboxMinutes: { type: Number, default: 15, min: 5 },
    stats: {
      enrolled: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      replied: { type: Number, default: 0 },
      converted: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

const enrollmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    stage: {
      type: String,
      enum: ENROLLMENT_STAGES,
      default: "queued",
      index: true,
    },
    nextActionAt: { type: Date, default: null, index: true },
    lastEmailMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailMessage",
      default: null,
    },
    touchCount: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

enrollmentSchema.index({ user: 1, campaign: 1, entity: 1 }, { unique: true });

/**
 * @param {object} entity
 * @param {string} template
 * @returns {string}
 */
export function renderCampaignTemplate(template, entity) {
  const attrs = entity?.attributes && typeof entity.attributes === "object" ? entity.attributes : {};
  const email = String(attrs.email || attrs.Email || "").trim();
  const name = String(entity?.name || attrs.name || "").trim();
  return String(template || "")
    .split("{{name}}").join(name)
    .split("{{email}}").join(email)
    .split("{{entityId}}").join(String(entity?._id || ""));
}

/**
 * @param {import('mongoose').Document|object} doc
 */
export function toCampaignPublic(doc) {
  const c = doc.toObject ? doc.toObject() : doc;
  return {
    _id: c._id,
    name: c.name,
    description: c.description || "",
    agent: c.agent,
    goal: c.goal,
    status: c.status,
    entityType: c.entityType,
    emailSubject: c.emailSubject,
    emailBody: c.emailBody,
    taskInstructions: c.taskInstructions,
    followUpDays: c.followUpDays || [],
    batchSize: c.batchSize,
    pollInboxMinutes: c.pollInboxMinutes,
    stats: c.stats || {},
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const Campaign = mongoose.model("Campaign", campaignSchema);
export const Enrollment = mongoose.model("Enrollment", enrollmentSchema);
