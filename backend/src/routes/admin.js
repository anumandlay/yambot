/**
 * @fileoverview SaaS super-admin API — cross-tenant user visibility.
 * Purpose: List all registered tenants (users) with usage stats for platform operators.
 * Downstream: User, Agent, Task models; superAdminRequired middleware.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { toUserPublic } from "../utils/userPublic.js";
import { getPlatformSettings, toPlatformSettingsPublic } from "../models/PlatformSettings.js";
import { creditWallet } from "../utils/wallet.js";

export const adminRouter = Router();

/**
 * GET /api/admin/settings — platform pricing (super-admin).
 */
adminRouter.get("/settings", async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    res.json({ ok: true, settings: toPlatformSettingsPublic(settings) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/settings/pricing — set per-agent creation price (USD).
 * Body: { agentPriceUsd: number }
 */
adminRouter.put("/settings/pricing", async (req, res, next) => {
  try {
    const agentPriceUsd = Math.max(0, Number(req.body?.agentPriceUsd) || 0);
    const agentPriceCents = Math.round(agentPriceUsd * 100);
    const settings = await getPlatformSettings();
    settings.agentPriceCents = agentPriceCents;
    settings.updatedBy = req.userId;
    await settings.save();
    res.json({ ok: true, settings: toPlatformSettingsPublic(settings) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:userId/credits — grant free wallet credits.
 * Body: { amountUsd: number, note?: string }
 */
adminRouter.post("/users/:userId/credits", async (req, res, next) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) {
      res.status(404).json({ ok: false, detail: "User missing" });
      return;
    }
    const amountUsd = Number(req.body?.amountUsd);
    const amountCents = Math.round(amountUsd * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ ok: false, detail: "amountUsd must be positive" });
      return;
    }
    const note = String(req.body?.note || "Admin credit grant").trim();
    const result = await creditWallet({
      userId: String(target._id),
      amountCents,
      type: "admin_credit",
      note,
      adminUserId: req.userId,
      meta: { grantedBy: String(req.userId) },
    });
    res.json({
      ok: true,
      wallet: {
        balanceCents: result.balanceCents,
        balanceUsd: Number((result.balanceCents / 100).toFixed(2)),
      },
      transaction: result.transaction,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users — all registered users with agent/task/spend rollups.
 */
adminRouter.get("/users", async (req, res, next) => {
  try {
    const users = await User.find()
      .select("name email role walletBalanceCents createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    const [agentRows, taskRows, spendRows] = await Promise.all([
      Agent.aggregate([{ $group: { _id: "$user", agents: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: "$user", tasks: { $sum: 1 } } }]),
      Task.aggregate([
        { $match: { status: { $in: ["done", "error"] } } },
        {
          $group: {
            _id: "$user",
            completedTasks: { $sum: 1 },
            estimatedUsd: { $sum: "$llmUsage.estimatedUsd" },
          },
        },
      ]),
    ]);

    const agentsByUser = new Map(agentRows.map((r) => [String(r._id), r.agents]));
    const tasksByUser = new Map(taskRows.map((r) => [String(r._id), r.tasks]));
    const spendByUser = new Map(
      spendRows.map((r) => [
        String(r._id),
        {
          completedTasks: r.completedTasks || 0,
          estimatedUsd: Number((r.estimatedUsd || 0).toFixed(4)),
        },
      ])
    );

    const rows = users.map((u) => {
      const id = String(u._id);
      const spend = spendByUser.get(id) || { completedTasks: 0, estimatedUsd: 0 };
      return {
        ...toUserPublic(u),
        wallet: {
          balanceCents: Math.max(0, Number(u.walletBalanceCents) || 0),
          balanceUsd: Number((Math.max(0, Number(u.walletBalanceCents) || 0) / 100).toFixed(2)),
        },
        stats: {
          agents: agentsByUser.get(id) || 0,
          tasks: tasksByUser.get(id) || 0,
          completedTasks: spend.completedTasks,
          estimatedUsd: spend.estimatedUsd,
        },
      };
    });

    res.json({
      ok: true,
      total: rows.length,
      users: rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/overview — platform-wide SaaS metrics.
 */
adminRouter.get("/overview", async (req, res, next) => {
  try {
    const [userCount, agentCount, taskCount, spendRow] = await Promise.all([
      User.countDocuments(),
      Agent.countDocuments(),
      Task.countDocuments(),
      Task.aggregate([
        { $match: { status: { $in: ["done", "error"] } } },
        { $group: { _id: null, usd: { $sum: "$llmUsage.estimatedUsd" } } },
      ]),
    ]);

    res.json({
      ok: true,
      overview: {
        users: userCount,
        agents: agentCount,
        tasks: taskCount,
        estimatedUsd: Number((spendRow[0]?.usd || 0).toFixed(4)),
      },
    });
  } catch (err) {
    next(err);
  }
});
