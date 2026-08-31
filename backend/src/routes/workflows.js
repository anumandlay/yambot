/**
 * @fileoverview Workflow API — definitions, runs, sandbox tests.
 * Purpose: Executable Business Runtime surface for Command Center / Architect.
 * Downstream: WorkflowDefinition, apiWorkflowRunner, workflowTests.
 */

import { Router } from "express";
import { WorkflowDefinition, WorkflowRun } from "../models/WorkflowDefinition.js";
import { startWorkflowRun, retryWorkflowRun, resumeWorkflowRun } from "../utils/apiWorkflowRunner.js";
import { runWorkflowTestSuite, generateWorkflowTestCases } from "../utils/workflowTests.js";
import { promoteWorkflow, rollbackWorkflow } from "../utils/workflowCanary.js";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";

export const workflowsRouter = Router();

workflowsRouter.get("/", async (req, res, next) => {
  try {
    const defs = await WorkflowDefinition.find({ user: req.userId, active: true })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json({ ok: true, workflows: defs });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.get("/:id", async (req, res, next) => {
  try {
    const def = await WorkflowDefinition.findOne({
      _id: req.params.id,
      user: req.userId,
    }).lean();
    if (!def) {
      res.status(404).json({ ok: false, detail: "Not found" });
      return;
    }
    res.json({ ok: true, workflow: def });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post("/:id/run", async (req, res, next) => {
  try {
    const result = await startWorkflowRun(req.userId, req.params.id, {
      payload: req.body?.payload,
      environment: req.body?.environment,
      correlationId: req.body?.correlationId,
      forceSandbox: req.body?.sandbox === true,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

workflowsRouter.get("/runs/:runId", async (req, res, next) => {
  try {
    const run = await WorkflowRun.findOne({
      _id: req.params.runId,
      user: req.userId,
    }).lean();
    if (!run) {
      res.status(404).json({ ok: false, detail: "Run not found" });
      return;
    }
    res.json({ ok: true, run });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post("/runs/:runId/retry", async (req, res, next) => {
  try {
    const result = await retryWorkflowRun(req.userId, req.params.runId);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post("/runs/:runId/resume", async (req, res, next) => {
  try {
    const result = await resumeWorkflowRun(req.userId, req.params.runId, {
      success: req.body?.success !== false,
      summary: req.body?.summary,
      error: req.body?.error,
      taskId: req.body?.taskId,
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

workflowsRouter.post("/:id/promote", async (req, res, next) => {
  try {
    const result = await promoteWorkflow(req.userId, req.params.id, {
      to: req.body?.to,
      skipTests: req.body?.skipTests === true,
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

workflowsRouter.post("/:id/rollback", async (req, res, next) => {
  try {
    const result = await rollbackWorkflow(req.userId, req.params.id, {
      reason: req.body?.reason,
      to: req.body?.to,
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

workflowsRouter.post("/:id/tests/generate", async (req, res, next) => {
  try {
    const def = await WorkflowDefinition.findOne({
      _id: req.params.id,
      user: req.userId,
    }).lean();
    if (!def) {
      res.status(404).json({ ok: false, detail: "Not found" });
      return;
    }
    let blueprintDoc = null;
    if (def.blueprintId) {
      blueprintDoc = await BusinessBlueprint.findOne({
        _id: def.blueprintId,
        user: req.userId,
      }).lean();
    }
    res.json({
      ok: true,
      cases: generateWorkflowTestCases(def, blueprintDoc),
    });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post("/:id/tests/run", async (req, res, next) => {
  try {
    const def = await WorkflowDefinition.findOne({
      _id: req.params.id,
      user: req.userId,
    });
    if (!def) {
      res.status(404).json({ ok: false, detail: "Not found" });
      return;
    }
    let blueprintDoc = null;
    if (def.blueprintId) {
      blueprintDoc = await BusinessBlueprint.findOne({
        _id: def.blueprintId,
        user: req.userId,
      });
    }
    const suite = await runWorkflowTestSuite(req.userId, String(def._id), {
      blueprintDoc,
    });
    res.json(suite);
  } catch (err) {
    next(err);
  }
});
