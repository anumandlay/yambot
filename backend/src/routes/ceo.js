/**
 * @fileoverview CEO / Command Center API routes.
 * Purpose: Chat, diagnose, discover — safe high-level business control.
 * Downstream: CommandCenterPage.
 */

import { Router } from "express";
import { chatCeo, diagnoseCeo, discoverAutomations, sopToHireBrief, hireDepartment, optimizeModelCosts } from "../utils/ceoChat.js";

export const ceoRouter = Router();

ceoRouter.post("/chat", async (req, res, next) => {
  try {
    const result = await chatCeo(req.userId, {
      messages: req.body?.messages,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

ceoRouter.post("/diagnose", async (req, res, next) => {
  try {
    const result = await diagnoseCeo(req.userId, {
      agentId: req.body?.agentId,
      question: req.body?.question || req.body?.q,
      taskId: req.body?.taskId,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

ceoRouter.post("/discover", async (req, res, next) => {
  try {
    const result = await discoverAutomations(req.userId, {
      brief: req.body?.brief || req.body?.text,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

ceoRouter.post("/from-sop", async (req, res, next) => {
  try {
    const result = await sopToHireBrief(req.userId, {
      text: req.body?.text,
      documentId: req.body?.documentId,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

ceoRouter.post("/hire-department", async (req, res, next) => {
  try {
    const result = await hireDepartment(req.userId, {
      request: req.body?.request || req.body?.text,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

ceoRouter.get("/optimize-models", async (req, res, next) => {
  try {
    const result = await optimizeModelCosts(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
