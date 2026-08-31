/**
 * @fileoverview Heal API — diagnose and apply gated self-healing.
 * Purpose: Failure → diagnose → sandbox test → apply → retry.
 * Downstream: healController, Command Center.
 */

import { Router } from "express";
import { diagnoseForHeal, applyHeal } from "../utils/healController.js";

export const healRouter = Router();

healRouter.post("/diagnose", async (req, res, next) => {
  try {
    const result = await diagnoseForHeal(req.userId, req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

healRouter.post("/apply", async (req, res, next) => {
  try {
    const result = await applyHeal(req.userId, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
