/**
 * @fileoverview Company dashboard API — cross-agent KPIs and pipeline (Phase 4).
 * Purpose: Single view of entities, campaigns, processes, email activity.
 * Downstream: CompanyPage dashboard tab.
 */

import mongoose from "mongoose";
import { Router } from "express";
import { Entity } from "../models/Entity.js";
import { Campaign, Enrollment } from "../models/Campaign.js";
import { ProcessInstance, ProcessDefinition } from "../models/Process.js";
import { EmailMessage } from "../models/EmailMessage.js";
import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";
import { listEmailMessages } from "../utils/emailInboxWatcher.js";

export const companyDashboardRouter = Router();

/**
 * JWT user ids are strings; aggregate $match does not cast ObjectId paths.
 * @param {string|import("mongoose").Types.ObjectId} id
 * @returns {import("mongoose").Types.ObjectId}
 */
function asObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

companyDashboardRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.userId;
    const userOid = asObjectId(userId);
    const [
      entityCounts,
      enrollmentByStage,
      activeCampaigns,
      processInstances,
      recentEmail,
      agentWorkload,
      taskStats,
    ] = await Promise.all([
      Entity.aggregate([
        { $match: { user: userOid } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      Enrollment.aggregate([
        { $match: { user: userOid } },
        { $group: { _id: "$stage", count: { $sum: 1 } } },
      ]),
      Campaign.find({ user: userId, status: "active" })
        .select("name stats agent status")
        .limit(20)
        .lean(),
      ProcessInstance.find({ user: userId, status: "active" })
        .populate("definition", "name")
        .populate("entity", "name type")
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean(),
      listEmailMessages(userId, { limit: 15 }),
      Agent.find({ user: userId })
        .select("name computer role")
        .limit(50)
        .lean(),
      Task.aggregate([
        {
          $match: {
            user: userOid,
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const workload = await Promise.all(
      agentWorkload.map(async (a) => {
        const pending = await Task.countDocuments({
          user: userId,
          agent: a._id,
          status: { $in: ["pending", "running", "waiting_user"] },
        });
        return {
          _id: a._id,
          name: a.name,
          role: a.role,
          online: Boolean(
            a.computer?.lastSeenAt &&
              Date.now() - new Date(a.computer.lastSeenAt).getTime() < 45_000
          ),
          pendingTasks: pending,
        };
      })
    );

    res.json({
      ok: true,
      dashboard: {
        entitiesByType: entityCounts.map((r) => ({ type: r._id, count: r.count })),
        enrollmentsByStage: enrollmentByStage.map((r) => ({ stage: r._id, count: r.count })),
        activeCampaigns,
        activeProcessInstances: processInstances.map((p) => ({
          _id: p._id,
          definition: p.definition?.name,
          entity: p.entity?.name,
          currentStage: p.currentStage,
          status: p.status,
        })),
        recentEmail: recentEmail.map((m) => ({
          _id: m._id,
          direction: m.direction,
          subject: m.subject,
          from: m.from,
          to: m.to,
          entity: m.entity,
          createdAt: m.createdAt,
        })),
        agentWorkload: workload,
        tasksLast7Days: taskStats.map((r) => ({ status: r._id, count: r.count })),
      },
    });
  } catch (err) {
    next(err);
  }
});

companyDashboardRouter.get("/email", async (req, res, next) => {
  try {
    const messages = await listEmailMessages(req.userId, {
      agentId: req.query.agentId,
      entityId: req.query.entityId,
      limit: Number(req.query.limit) || 50,
    });
    res.json({ ok: true, messages });
  } catch (err) {
    next(err);
  }
});

companyDashboardRouter.get("/process-instances", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    const instances = await ProcessInstance.find(filter)
      .populate("definition", "name stages")
      .populate("entity", "name type")
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, instances });
  } catch (err) {
    next(err);
  }
});
