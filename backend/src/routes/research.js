/**
 * @fileoverview Research API — queue SERP jobs for the Python Chrome scraper.
 * Purpose: Replace visaclap/Flask from Desktop/api.py with YamBot-owned endpoints.
 * Auth: user JWT for create/get; RESEARCH_WORKER_TOKEN for claim/progress/complete.
 */

import { Router } from "express";
import {
  ResearchJob,
  organicUrlsFromJob,
  jobsArrayFromResearchJob,
} from "../models/ResearchJob.js";
import { authRequired } from "../middleware/auth.js";

export const researchRouter = Router();

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function researchWorkerAuth(req, res, next) {
  const expected = String(process.env.RESEARCH_WORKER_TOKEN || "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      title: "Research worker not configured",
      detail: "Set RESEARCH_WORKER_TOKEN on the API server.",
    });
    return;
  }
  const got = String(
    req.headers["x-research-worker-token"] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
      ""
  ).trim();
  if (got !== expected) {
    res.status(401).json({
      ok: false,
      title: "Unauthorized",
      detail: "Invalid research worker token",
    });
    return;
  }
  next();
}

/**
 * POST /api/research/jobs — create a SERP scrape job (research agent Phase 1).
 * Body: { keywords: string[]|string, maxPages?, goal?, taskId?, agentId? }
 */
researchRouter.post("/jobs", authRequired, async (req, res, next) => {
  try {
    let keywords = req.body?.keywords;
    if (typeof keywords === "string") {
      keywords = keywords.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean);
    }
    if (!Array.isArray(keywords)) keywords = [];
    keywords = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 40);
    if (!keywords.length) {
      res.status(400).json({
        ok: false,
        title: "Keywords required",
        detail: "Provide keywords to scrape on Google.",
      });
      return;
    }
    const maxPages = Math.min(
      50,
      Math.max(1, Number(req.body?.maxPages) || 10)
    );
    const job = await ResearchJob.create({
      user: req.userId,
      task: req.body?.taskId || null,
      agent: req.body?.agentId || null,
      goal: String(req.body?.goal || "").trim().slice(0, 8000),
      maxPages,
      status: "pending",
      keywords: keywords.map((keyword) => ({
        keyword,
        status: "pending",
        pages: [],
      })),
    });
    res.status(201).json({ ok: true, job: publicJob(job) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/research/jobs/:id — poll job status + results (user).
 */
researchRouter.get("/jobs/:id", authRequired, async (req, res, next) => {
  try {
    const job = await ResearchJob.findOne({
      _id: req.params.id,
      user: req.userId,
    }).lean();
    if (!job) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Job missing" });
      return;
    }
    res.json({
      ok: true,
      job: publicJob(job),
      urls: organicUrlsFromJob(job),
      jobs: jobsArrayFromResearchJob(job),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/research/worker/claim — Python scraper takes next pending job.
 */
researchRouter.post("/worker/claim", researchWorkerAuth, async (req, res, next) => {
  try {
    const job = await ResearchJob.findOneAndUpdate(
      { status: "pending" },
      {
        $set: {
          status: "processing",
          claimedAt: new Date(),
          error: "",
        },
      },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!job) {
      res.json({ ok: true, job: null });
      return;
    }
    res.json({
      ok: true,
      job: {
        id: String(job._id),
        maxPages: job.maxPages,
        goal: job.goal,
        keywords: job.keywords.map((k) => k.keyword),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/research/worker/jobs/:id/page
 * Body: { keyword, page, data } — parsed SERP page (not raw HTML).
 */
researchRouter.post("/worker/jobs/:id/page", researchWorkerAuth, async (req, res, next) => {
  try {
    const job = await ResearchJob.findById(req.params.id);
    if (!job) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Job missing" });
      return;
    }
    const keyword = String(req.body?.keyword || "").trim();
    const pageNum = Math.max(1, Number(req.body?.page) || 1);
    const data = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
    const entry = job.keywords.find((k) => k.keyword === keyword);
    if (!entry) {
      res.status(400).json({
        ok: false,
        title: "Unknown keyword",
        detail: `Keyword not on job: ${keyword}`,
      });
      return;
    }
    entry.status = "processing";
    entry.pages = entry.pages.filter((p) => p.page !== pageNum);
    entry.pages.push({ page: pageNum, data, at: new Date() });
    entry.pages.sort((a, b) => a.page - b.page);
    job.status = "processing";
    await job.save();
    res.json({ ok: true, saved: { keyword, page: pageNum } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/research/worker/jobs/:id/keyword-done
 * Body: { keyword, status?: completed|failed, error? }
 */
researchRouter.post(
  "/worker/jobs/:id/keyword-done",
  researchWorkerAuth,
  async (req, res, next) => {
    try {
      const job = await ResearchJob.findById(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, title: "Not found", detail: "Job missing" });
        return;
      }
      const keyword = String(req.body?.keyword || "").trim();
      const entry = job.keywords.find((k) => k.keyword === keyword);
      if (!entry) {
        res.status(400).json({ ok: false, title: "Unknown keyword", detail: keyword });
        return;
      }
      const st = req.body?.status === "failed" ? "failed" : "completed";
      entry.status = st;
      if (req.body?.error) entry.error = String(req.body.error).slice(0, 2000);
      await job.save();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/research/worker/jobs/:id/complete
 */
researchRouter.post("/worker/jobs/:id/complete", researchWorkerAuth, async (req, res, next) => {
  try {
    const job = await ResearchJob.findById(req.params.id);
    if (!job) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Job missing" });
      return;
    }
    for (const k of job.keywords) {
      if (k.status === "pending" || k.status === "processing") k.status = "completed";
    }
    job.status = "completed";
    job.completedAt = new Date();
    job.error = "";
    await job.save();
    res.json({ ok: true, job: publicJob(job) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/research/worker/jobs/:id/fail
 * Body: { error }
 */
researchRouter.post("/worker/jobs/:id/fail", researchWorkerAuth, async (req, res, next) => {
  try {
    const job = await ResearchJob.findById(req.params.id);
    if (!job) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Job missing" });
      return;
    }
    job.status = "failed";
    job.error = String(req.body?.error || "Research scrape failed").slice(0, 4000);
    job.completedAt = new Date();
    await job.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * @param {object} job
 */
function publicJob(job) {
  const j = typeof job.toObject === "function" ? job.toObject() : { ...job };
  return {
    id: String(j._id),
    status: j.status,
    goal: j.goal || "",
    maxPages: j.maxPages,
    keywords: j.keywords || [],
    error: j.error || "",
    task: j.task ? String(j.task) : null,
    createdAt: j.createdAt,
    claimedAt: j.claimedAt,
    completedAt: j.completedAt,
  };
}
