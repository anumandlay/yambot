/**
 * @fileoverview Approvals API — human approval queue (Layer 2).
 * Purpose: Dashboard approve/deny; workers poll pending approval status.
 * Downstream: Approval model, worker submit gate, Governance UI.
 */

import { Router } from "express";
import { Approval } from "../models/Approval.js";
import { Task } from "../models/Task.js";
import { writeAudit } from "../utils/audit.js";
import { clearAgentNeedsAttention } from "../models/Agent.js";

export const approvalsRouter = Router();

approvalsRouter.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status || "pending");
    const filter = { user: req.userId };
    if (status !== "all") filter.status = status;
    const approvals = await Approval.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, approvals });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/approvals/:id/resolve — approve or deny.
 * Body: { decision: "approved"|"denied", note? }
 */
approvalsRouter.post("/:id/resolve", async (req, res, next) => {
  try {
    const approval = await Approval.findOne({ _id: req.params.id, user: req.userId });
    if (!approval) {
      res.status(404).json({ ok: false, detail: "Approval missing" });
      return;
    }
    if (approval.status !== "pending") {
      res.json({ ok: true, approval, alreadyResolved: true });
      return;
    }
    const decision = req.body?.decision === "approved" ? "approved" : "denied";
    approval.status = decision;
    approval.resolutionNote = String(req.body?.note || "").slice(0, 500);
    approval.resolvedAt = new Date();
    await approval.save();

    const task = await Task.findOne({ _id: approval.task, user: req.userId });
    if (task) {
      task.events.push({
        type: decision === "approved" ? "approval_granted" : "approval_denied",
        payload: { approvalId: approval._id, note: approval.resolutionNote },
      });
      if (decision === "approved" && task.status === "waiting_user") {
        task.status = "running";
      }
      await task.save();
      if (task.agent) {
        await clearAgentNeedsAttention(task.agent);
      }
    }

    await writeAudit({
      userId: req.userId,
      action: `approval.${decision}`,
      taskId: approval.task ? String(approval.task) : null,
      agentId: approval.agent ? String(approval.agent) : null,
      detail: approval.question?.slice(0, 200),
    });

    // Resume durable workflow waiting on this approval
    const runId = approval.workflowRunId || approval.context?.workflowRunId;
    if (runId) {
      const { resumeWorkflowRun } = await import("../utils/apiWorkflowRunner.js");
      await resumeWorkflowRun(req.userId, String(runId), {
        approvalDecision: decision,
        summary: approval.resolutionNote,
        force: true,
      }).catch(() => null);
    }

    res.json({ ok: true, approval });
  } catch (err) {
    next(err);
  }
});
