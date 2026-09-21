/**
 * @fileoverview SiteProfile model — per-agent domain memory for browser automation.
 * Purpose: Phase 5 stores hints learned from successful/failed runs on each site.
 * Downstream: worker routes (read/write); injected into LLM prompts via learn.js.
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
 * Fingerprint for near-duplicate flow hints (same path, different wording/counts).
 * @param {string} content
 * @returns {string}
 */
export function siteFlowFingerprint(content) {
  const s = String(content || "")
    .toLowerCase()
    .replace(/successful (?:run|path) on [a-z0-9.-]+:\s*/i, "")
    .replace(/\d+\s*(?:of\s*)?\d+/g, "#")
    .replace(/\b\d+\s*days?\b/g, "#days")
    .replace(/https?:\/\/[^\s]+/g, (u) => {
      try {
        const url = new URL(u);
        return `${url.hostname}${url.pathname}`.replace(/\/+$/, "");
      } catch {
        return u;
      }
    })
    .replace(/[^a-z0-9/\s→>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return s;
}

/**
 * Appends a hint and caps the list.
 * Why: repeated successful runs must not stack near-duplicate `flow` hints that all get
 * injected into the LLM — upsert similar flows and keep a small cap.
 * @param {import('mongoose').Document} doc
 * @param {{ kind?: string, content: string }} hint
 * @param {number} [cap]
 */
export function appendSiteHint(doc, hint, cap = 12) {
  const content = String(hint.content || "").trim();
  if (!content) return;
  doc.hints = Array.isArray(doc.hints) ? [...doc.hints] : [];
  const kind = hint.kind || "note";
  const next = {
    kind,
    content: content.slice(0, 500),
    at: new Date(),
  };

  if (kind === "flow") {
    const fp = siteFlowFingerprint(content);
    doc.hints = doc.hints.filter(
      (h) => String(h.kind || "") !== "flow" || siteFlowFingerprint(h.content) !== fp
    );
    doc.hints.unshift(next);
  } else {
    if (doc.hints.some((h) => h.content === content)) return;
    doc.hints.unshift(next);
  }

  const flows = doc.hints.filter((h) => String(h.kind || "") === "flow").slice(0, 3);
  const rest = doc.hints.filter((h) => String(h.kind || "") !== "flow");
  doc.hints = [...flows, ...rest].slice(0, cap);
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
