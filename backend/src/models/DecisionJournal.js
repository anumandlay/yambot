/**
 * @fileoverview Decision journal — durable record of CEO/owner/authority decisions.
 * Purpose: “Why did YamBot change outreach?” with rationale and outcome.
 * Downstream: /api/decisions, policies authority levels, CEO chat.
 */

import mongoose from "mongoose";

export const AUTHORITY_LEVELS = ["observe", "internal", "external", "financial", "critical"];

const decisionJournalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorType: {
      type: String,
      enum: ["user", "ceo", "manager", "agent", "system"],
      default: "user",
    },
    actorId: { type: String, default: "", trim: true },
    authorityLevel: {
      type: String,
      enum: AUTHORITY_LEVELS,
      default: "internal",
      index: true,
    },
    decision: { type: String, required: true, trim: true, maxlength: 500 },
    rationale: { type: String, default: "", trim: true, maxlength: 4000 },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    outcome: { type: String, default: "pending", trim: true },
    approved: { type: Boolean, default: true },
  },
  { timestamps: true }
);

decisionJournalSchema.index({ user: 1, createdAt: -1 });

export const DecisionJournal = mongoose.model("DecisionJournal", decisionJournalSchema);

/**
 * @param {string} userId
 * @param {object} entry
 */
export async function recordDecision(userId, entry = {}) {
  return DecisionJournal.create({
    user: userId,
    actorType: entry.actorType || "user",
    actorId: String(entry.actorId || "").slice(0, 80),
    authorityLevel: AUTHORITY_LEVELS.includes(entry.authorityLevel)
      ? entry.authorityLevel
      : "internal",
    decision: String(entry.decision || "").trim().slice(0, 500),
    rationale: String(entry.rationale || "").trim().slice(0, 4000),
    context: entry.context && typeof entry.context === "object" ? entry.context : {},
    outcome: String(entry.outcome || "recorded").slice(0, 200),
    approved: entry.approved !== false,
  });
}
