/**
 * @fileoverview ResearchJob — Google SERP scrape jobs for the Python Chrome worker.
 * Purpose: Queue keywords from research agents; Python scraper claims, scrapes with real
 * Chrome (same idea as Desktop/api.py), posts page results; agent Phase 2 uses URLs.
 * Downstream: `/api/research/*`; `research-scraper` Docker service.
 */

import mongoose from "mongoose";

const pageResultSchema = new mongoose.Schema(
  {
    page: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const keywordResultSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    pages: { type: [pageResultSchema], default: [] },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const researchJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    goal: { type: String, default: "", trim: true },
    maxPages: { type: Number, default: 10, min: 1, max: 50 },
    keywords: { type: [keywordResultSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    error: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

researchJobSchema.index({ status: 1, createdAt: 1 });

/**
 * Flatten organic URLs for Phase 2 LLM visits.
 * @param {object} job
 * @param {{ maxUrls?: number }} [opts]
 */
export function organicUrlsFromJob(job, opts = {}) {
  const maxUrls = Math.min(40, Math.max(1, Number(opts.maxUrls) || 15));
  const out = [];
  const seen = new Set();
  for (const kw of job.keywords || []) {
    for (const p of kw.pages || []) {
      const organic = p?.data?.organic_results || [];
      for (const r of organic) {
        const url = String(r?.url || "").trim();
        if (!url || seen.has(url)) continue;
        if (/^https?:\/\/([^/]*\.)?google\./i.test(url)) continue;
        seen.add(url);
        out.push({
          keyword: kw.keyword,
          title: String(r.title || "").trim(),
          url,
          snippet: String(r.snippet || "").trim(),
        });
        if (out.length >= maxUrls) return out;
      }
    }
  }
  return out;
}

/**
 * Shape matching prior worker research `jobs` array for chat/LLM continuity.
 * @param {object} job
 */
export function jobsArrayFromResearchJob(job) {
  return (job.keywords || []).map((kw) => ({
    keyword: kw.keyword,
    pages: (kw.pages || []).map((p) => ({
      [`page ${p.page}`]: p.data || {},
    })),
  }));
}

export const ResearchJob = mongoose.model("ResearchJob", researchJobSchema);
