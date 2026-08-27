/**
 * @fileoverview Teams API — agent groups for assignment.
 * Purpose: Team-based round-robin ticket assignment.
 * Downstream: Company settings, ticketAssign.
 */

import { Router } from "express";
import { Team } from "../models/Team.js";

export const teamsRouter = Router();

teamsRouter.get("/", async (req, res, next) => {
  try {
    const teams = await Team.find({ user: req.userId }).sort({ name: 1 }).lean();
    res.json({ ok: true, teams });
  } catch (err) {
    next(err);
  }
});

teamsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, detail: "name required" });
      return;
    }
    if (body.defaultForTickets) {
      await Team.updateMany({ user: req.userId }, { $set: { defaultForTickets: false } });
    }
    const team = await Team.create({
      user: req.userId,
      name,
      description: body.description || "",
      memberAgents: Array.isArray(body.memberAgentIds) ? body.memberAgentIds : [],
      defaultForTickets: Boolean(body.defaultForTickets),
    });
    res.status(201).json({ ok: true, team });
  } catch (err) {
    next(err);
  }
});

teamsRouter.put("/:id", async (req, res, next) => {
  try {
    const team = await Team.findOne({ _id: req.params.id, user: req.userId });
    if (!team) {
      res.status(404).json({ ok: false, detail: "Team missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) team.name = String(body.name).trim();
    if (body.description != null) team.description = String(body.description);
    if (Array.isArray(body.memberAgentIds)) team.memberAgents = body.memberAgentIds;
    if (body.defaultForTickets != null) {
      if (body.defaultForTickets) {
        await Team.updateMany({ user: req.userId, _id: { $ne: team._id } }, { $set: { defaultForTickets: false } });
      }
      team.defaultForTickets = Boolean(body.defaultForTickets);
    }
    await team.save();
    res.json({ ok: true, team });
  } catch (err) {
    next(err);
  }
});
