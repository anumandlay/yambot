/**
 * @fileoverview CEO / Command Center API routes.
 * Purpose: Chat, diagnose, discover, business pulse — safe high-level business control.
 * Downstream: CommandCenterPage.
 */

import { Router } from "express";
import {
  chatCeo,
  diagnoseCeo,
  discoverAutomations,
  sopToHireBrief,
  hireDepartment,
  optimizeModelCosts,
} from "../utils/ceoChat.js";
import {
  buildBusinessPulse,
  applyPulseAction,
  applyAllModelOptimizations,
} from "../utils/businessPulse.js";

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

/**
 * GET /api/ceo/pulse — proactive business findings.
 */
ceoRouter.get("/pulse", async (req, res, next) => {
  try {
    const result = await buildBusinessPulse(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/pulse/act — apply a pulse action under authority policy.
 */
ceoRouter.post("/pulse/act", async (req, res, next) => {
  try {
    const result = await applyPulseAction(req.userId, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/optimize-models/apply — apply suggested LLM profile routes.
 */
ceoRouter.post("/optimize-models/apply", async (req, res, next) => {
  try {
    if (req.body?.agentId && req.body?.profileId) {
      const result = await applyPulseAction(req.userId, {
        type: "apply_model_route",
        authority: "internal",
        agentId: req.body.agentId,
        profileId: req.body.profileId,
        reason: req.body.reason,
      });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
      return;
    }
    const result = await applyAllModelOptimizations(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/hire-roles — create agents from SOP/department role briefs.
 */
ceoRouter.post("/hire-roles", async (req, res, next) => {
  try {
    const result = await applyPulseAction(req.userId, {
      type: "hire_roles",
      authority: "external",
      roles: req.body?.roles,
      departmentName: req.body?.departmentName,
      rationale: req.body?.rationale,
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
