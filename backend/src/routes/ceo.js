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
import { runCeoLoop } from "../utils/ceoAutonomy.js";
import { auditCompany } from "../utils/companyAudit.js";
import { explainBusinessAction, generateSopFromAgent } from "../utils/explainability.js";

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
      sharedRules: req.body?.sharedRules,
      kpis: req.body?.kpis,
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

/**
 * POST /api/ceo/loop — run one CEO decide→execute cycle (respects operatingMode).
 */
ceoRouter.post("/loop", async (req, res, next) => {
  try {
    const result = await runCeoLoop(req.userId, {
      forceExecute: req.body?.forceExecute === true,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/audit-company — NL + structural company audit.
 */
ceoRouter.post("/audit-company", async (req, res, next) => {
  try {
    const result = await auditCompany(req.userId, {
      profileId: req.body?.profileId,
      withNarrative: req.body?.withNarrative !== false,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ceo/explain — explainability chain.
 */
ceoRouter.get("/explain", async (req, res, next) => {
  try {
    const result = await explainBusinessAction(req.userId, {
      taskId: req.query.taskId,
      runId: req.query.runId,
      correlationId: req.query.correlationId,
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

/**
 * POST /api/ceo/sop-from-agent — AI employee → SOP.
 */
ceoRouter.post("/sop-from-agent", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) {
      res.status(400).json({ ok: false, detail: "agentId required" });
      return;
    }
    const result = await generateSopFromAgent(req.userId, agentId);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/optimize-loop — run continuous optimization once (experiments).
 */
ceoRouter.post("/optimize-loop", async (req, res, next) => {
  try {
    const { runContinuousOptimize } = await import("../utils/continuousOptimize.js");
    const result = await runContinuousOptimize(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ceo/attribution — which agents/workflows moved KPIs.
 */
ceoRouter.get("/attribution", async (req, res, next) => {
  try {
    const { attributeOutcomes } = await import("../utils/attribution.js");
    const result = await attributeOutcomes(req.userId, {
      goalId: req.query.goalId,
      sinceDays: req.query.sinceDays,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ceo/causal-memory — load strategy lessons for CEO.
 */
ceoRouter.get("/causal-memory", async (req, res, next) => {
  try {
    const { loadCausalLessons } = await import("../utils/causalMemory.js");
    const result = await loadCausalLessons(req.userId, { limit: req.query.limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ceo/causal-memory — record or harvest causal lessons.
 */
ceoRouter.post("/causal-memory", async (req, res, next) => {
  try {
    const { recordCausalLesson, harvestCausalLessons } = await import(
      "../utils/causalMemory.js"
    );
    if (req.body?.harvest === true) {
      const result = await harvestCausalLessons(req.userId);
      res.json(result);
      return;
    }
    const result = await recordCausalLesson(req.userId, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
