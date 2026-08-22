/**
 * @fileoverview SiteProfile model — per-agent domain memory for browser automation.
 * Purpose: Phase 5 stores hints learned from successful/failed runs on each site.
 * Downstream: extension routes (worker read/write); injected into LLM prompts via learn.js.
 */

import mongoose from "mongoose";

const hintSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["selector", "flow", "avoid", "note"],
      default: "note",
    },
    content: { type: String, required: true, trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const siteProfileSchema = new mongoose.Schema(
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
    /** Registrable domain e.g. amazon.com */
    domain: { type: String, required: true, trim: true, lowercase: true },
    hints: { type: [hintSchema], default: [] },
    stats: {
      visits: { type: Number, default: 0 },
      successes: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
    },
    lastVisitedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
  },
  { timestamps: true }
);

siteProfileSchema.index({ agent: 1, domain: 1 }, { unique: true });

/**
 * Appends a hint and caps the list.
 * @param {import('mongoose').Document} doc
 * @param {{ kind?: string, content: string }} hint
 * @param {number} [cap]
 */
export function appendSiteHint(doc, hint, cap = 30) {
  const content = String(hint.content || "").trim();
  if (!content) return;
  doc.hints = doc.hints || [];
  const dup = doc.hints.some((h) => h.content === content);
  if (!dup) {
    doc.hints.unshift({
      kind: hint.kind || "note",
      content: content.slice(0, 500),
      at: new Date(),
    });
  }
  if (doc.hints.length > cap) doc.hints = doc.hints.slice(0, cap);
}

/**
 * @param {import('mongoose').Document} doc
 * @returns {object}
 */
export function toSiteProfileSnapshot(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    domain: p.domain,
    hints: (p.hints || []).slice(0, 12),
    stats: p.stats || {},
    lastVisitedAt: p.lastVisitedAt,
    lastSuccessAt: p.lastSuccessAt,
  };
}

export const SiteProfile = mongoose.model("SiteProfile", siteProfileSchema);
