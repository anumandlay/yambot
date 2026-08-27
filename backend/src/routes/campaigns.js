/**
 * @fileoverview Campaigns API — outreach sequences and enrollments (Phase 3).
 * Purpose: CRUD campaigns, enroll entities, view funnel stats.
 * Downstream: campaignEngine.js, CompanyPage campaigns tab.
 */

import { Router } from "express";
import {
  Campaign,
  Enrollment,
  CAMPAIGN_STATUSES,
  ENROLLMENT_STAGES,
  toCampaignPublic,
} from "../models/Campaign.js";
import { enrollCampaignEntities } from "../utils/campaignEngine.js";

export const campaignsRouter = Router();

campaignsRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, statuses: CAMPAIGN_STATUSES, stages: ENROLLMENT_STAGES });
});

campaignsRouter.get("/", async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ user: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, campaigns: campaigns.map(toCampaignPublic) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const campaign = await Campaign.create({
      user: req.userId,
      name: String(body.name || "Campaign").trim(),
      description: String(body.description || "").trim(),
      agent: body.agentId || body.agent || null,
      goal: body.goalId || body.goal || null,
      status: CAMPAIGN_STATUSES.includes(body.status) ? body.status : "draft",
      entityType: String(body.entityType || "lead").trim(),
      emailSubject: String(body.emailSubject || "").trim(),
      emailBody: String(body.emailBody || "").trim(),
      taskInstructions: String(body.taskInstructions || "").trim(),
      followUpDays: Array.isArray(body.followUpDays)
        ? body.followUpDays.map(Number).filter(Boolean)
        : [3, 7],
      batchSize: Math.min(50, Math.max(1, Number(body.batchSize) || 5)),
    });
    res.status(201).json({ ok: true, campaign: toCampaignPublic(campaign) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.put("/:id", async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, user: req.userId });
    if (!campaign) {
      res.status(404).json({ ok: false, detail: "Campaign missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) campaign.name = String(body.name).trim();
    if (body.description != null) campaign.description = String(body.description).trim();
    if (body.agentId != null || body.agent != null) campaign.agent = body.agentId || body.agent || null;
    if (body.goalId != null || body.goal != null) campaign.goal = body.goalId || body.goal || null;
    if (body.status != null && CAMPAIGN_STATUSES.includes(body.status)) campaign.status = body.status;
    if (body.entityType != null) campaign.entityType = String(body.entityType).trim();
    if (body.emailSubject != null) campaign.emailSubject = String(body.emailSubject).trim();
    if (body.emailBody != null) campaign.emailBody = String(body.emailBody).trim();
    if (body.taskInstructions != null) campaign.taskInstructions = String(body.taskInstructions).trim();
    if (body.followUpDays != null && Array.isArray(body.followUpDays)) {
      campaign.followUpDays = body.followUpDays.map(Number).filter(Boolean);
    }
    if (body.batchSize != null) campaign.batchSize = Math.min(50, Math.max(1, Number(body.batchSize) || 5));
    await campaign.save();
    res.json({ ok: true, campaign: toCampaignPublic(campaign) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.delete("/:id", async (req, res, next) => {
  try {
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!campaign) {
      res.status(404).json({ ok: false, detail: "Campaign missing" });
      return;
    }
    await Enrollment.deleteMany({ campaign: campaign._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post("/:id/enroll", async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, user: req.userId });
    if (!campaign) {
      res.status(404).json({ ok: false, detail: "Campaign missing" });
      return;
    }
    const limit = Number(req.body?.limit) || 0;
    const result = await enrollCampaignEntities(campaign, { limit });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.get("/:id/enrollments", async (req, res, next) => {
  try {
    const enrollments = await Enrollment.find({
      user: req.userId,
      campaign: req.params.id,
    })
      .populate("entity", "name type status attributes")
      .sort({ updatedAt: -1 })
      .limit(Math.min(500, Number(req.query.limit) || 200))
      .lean();
    res.json({ ok: true, enrollments });
  } catch (err) {
    next(err);
  }
});
