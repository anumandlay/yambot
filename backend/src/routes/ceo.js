/**
 * @fileoverview CEO / Command Center API routes.
 * Purpose: Chat, diagnose, discover — safe high-level business control.
 * Downstream: CommandCenterPage.
 */

import { Router } from "express";
import { chatCeo, diagnoseCeo, discoverAutomations } from "../utils/ceoChat.js";

export const ceoRouter = Router();

ceoRouter.post("/chat", async (req, res, next) => {
  try {
    const result = await chatCeo(req.userId, {
      messages: req.body?.messages,
      profileId: req.body?.profileId,
    });
    if (!result.ok) {
      const status = /LLM|configured/i.test(String(result.title || "")) ? 400 : 400;
      res.status(status).json(result);
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
