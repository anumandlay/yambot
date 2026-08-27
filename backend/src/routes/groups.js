/**
 * @fileoverview Entity groups API — CRUD folders for agents and goals.
 * Purpose: List/create/rename/delete groups; members link via Agent.group / Goal.group.
 * Downstream: EntityGroup model, AgentsPage, GoalsPage.
 */

import { Router } from "express";
import { EntityGroup, ENTITY_GROUP_TYPES, toEntityGroupPublic } from "../models/EntityGroup.js";
import { Agent } from "../models/Agent.js";
import { Goal } from "../models/Goal.js";

export const groupsRouter = Router();

/**
 * @param {unknown} value
 * @returns {'agent'|'goal'|null}
 */
function normalizeGroupType(value) {
  const t = String(value || "").trim();
  return ENTITY_GROUP_TYPES.includes(t) ? /** @type {'agent'|'goal'} */ (t) : null;
}

groupsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    const type = normalizeGroupType(req.query.type);
    if (type) filter.type = type;
    const groups = await EntityGroup.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ ok: true, groups: groups.map(toEntityGroupPublic) });
  } catch (err) {
    next(err);
  }
});

groupsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const type = normalizeGroupType(body.type);
    const name = String(body.name || "").trim();
    if (!type) {
      res.status(400).json({ ok: false, detail: "type must be agent or goal" });
      return;
    }
    if (!name) {
      res.status(400).json({ ok: false, detail: "Group name required" });
      return;
    }
    const group = await EntityGroup.create({
      user: req.userId,
      type,
      name: name.slice(0, 80),
      description: String(body.description || "").trim().slice(0, 500),
      sortOrder: Number(body.sortOrder) || 0,
    });
    res.status(201).json({ ok: true, group: toEntityGroupPublic(group) });
  } catch (err) {
    next(err);
  }
});

groupsRouter.put("/:id", async (req, res, next) => {
  try {
    const group = await EntityGroup.findOne({ _id: req.params.id, user: req.userId });
    if (!group) {
      res.status(404).json({ ok: false, detail: "Group missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) group.name = String(body.name).trim().slice(0, 80);
    if (body.description != null) group.description = String(body.description).trim().slice(0, 500);
    if (body.sortOrder != null) group.sortOrder = Number(body.sortOrder) || 0;
    await group.save();
    res.json({ ok: true, group: toEntityGroupPublic(group) });
  } catch (err) {
    next(err);
  }
});

groupsRouter.delete("/:id", async (req, res, next) => {
  try {
    const group = await EntityGroup.findOne({ _id: req.params.id, user: req.userId });
    if (!group) {
      res.status(404).json({ ok: false, detail: "Group missing" });
      return;
    }
    if (group.type === "agent") {
      await Agent.updateMany({ user: req.userId, group: group._id }, { $unset: { group: 1 } });
    } else {
      await Goal.updateMany({ user: req.userId, group: group._id }, { $unset: { group: 1 } });
    }
    await group.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
