/**
 * @fileoverview Executable workflow tests generated from blueprints / definitions.
 * Purpose: Sandbox-run API maps, handoffs, verifies — gate Architect build on critical fail.
 * Downstream: /api/workflows/:id/tests, architect apply.
 */

import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { startWorkflowRun } from "./apiWorkflowRunner.js";
import { runBlueprintTests } from "./architectPhase2.js";

/**
 * Generate test cases from a workflow definition + optional blueprint.
 * @param {object} def
 * @param {object|null} blueprintDoc
 * @returns {object[]}
 */
export function generateWorkflowTestCases(def, blueprintDoc = null) {
  /** @type {object[]} */
  const cases = [];
  cases.push({
    id: "structural",
    name: "Structural blueprint checks",
    blocking: true,
    kind: "structural",
  });
  if ((def.steps || []).some((s) => s.kind === "api_get" || s.kind === "api_write")) {
    cases.push({
      id: "sandbox_api",
      name: "Sandbox API GET→map→write",
      blocking: true,
      kind: "sandbox_run",
      environment: "sandbox",
      payload: { customerCount: 3 },
    });
  }
  if ((def.handoffs || []).length) {
    cases.push({
      id: "handoffs_present",
      name: "Handoff edges materialized",
      blocking: true,
      kind: "assert_handoffs",
    });
  }
  cases.push({
    id: "failure_policy",
    name: "Incident policy present",
    blocking: false,
    kind: "assert_policy",
  });
  if (blueprintDoc?.blueprint?.branches?.length) {
    cases.push({
      id: "branches_documented",
      name: "Conditional branches documented",
      blocking: false,
      kind: "assert_branches",
    });
  }
  return cases;
}

/**
 * Run all generated tests for a definition.
 * @param {string} userId
 * @param {string} definitionId
 * @param {{ blueprintDoc?: object|null }} [opts]
 */
export async function runWorkflowTestSuite(userId, definitionId, opts = {}) {
  const def = await WorkflowDefinition.findOne({ _id: definitionId, user: userId });
  if (!def) {
    return { ok: false, title: "Missing", detail: "Workflow definition not found." };
  }
  const cases = generateWorkflowTestCases(def, opts.blueprintDoc);
  /** @type {object[]} */
  const results = [];
  let failedBlocking = 0;

  for (const c of cases) {
    /** @type {object} */
    let r = { id: c.id, name: c.name, blocking: c.blocking, passed: false, detail: "" };
    try {
      if (c.kind === "structural") {
        if (opts.blueprintDoc) {
          const structural = runBlueprintTests(opts.blueprintDoc);
          const failed = (structural.tests || []).filter((t) => !t.ok && t.severity === "error");
          r.passed = failed.length === 0;
          r.detail = r.passed
            ? `Structural OK (${(structural.tests || []).length} checks)`
            : failed.map((t) => t.name || t.id).join("; ");
          r.structural = structural;
        } else {
          r.passed = (def.steps || []).length > 0 || (def.handoffs || []).length > 0;
          r.detail = r.passed ? "Definition has steps/handoffs" : "Empty workflow";
        }
      } else if (c.kind === "sandbox_run") {
        const run = await startWorkflowRun(userId, String(def._id), {
          environment: "sandbox",
          forceSandbox: true,
          payload: c.payload || {},
        });
        r.passed = Boolean(run.ok && run.run?.status === "succeeded");
        r.detail = r.passed ? `Sandbox run ${run.run?._id}` : run.detail || run.run?.error || "failed";
        r.runId = run.run?._id ? String(run.run._id) : "";
      } else if (c.kind === "assert_handoffs") {
        const withTriggers = (def.handoffs || []).filter((h) => h.triggerId || h.onEvent);
        r.passed = withTriggers.length > 0;
        r.detail = `${withTriggers.length} handoff(s)`;
      } else if (c.kind === "assert_policy") {
        r.passed = Number(def.incidentPolicy?.apiRetries) > 0;
        r.detail = `apiRetries=${def.incidentPolicy?.apiRetries ?? 0}`;
      } else if (c.kind === "assert_branches") {
        r.passed = true;
        r.detail = "Branches present on blueprint";
      } else {
        r.passed = true;
        r.detail = "skipped unknown kind";
      }
    } catch (err) {
      r.passed = false;
      r.detail = err?.message || String(err);
    }
    if (!r.passed && c.blocking) failedBlocking += 1;
    results.push(r);
  }

  const status = failedBlocking > 0 ? "failed" : "passed";
  def.lastTestStatus = status;
  def.lastTestAt = new Date();
  await def.save();

  return {
    ok: failedBlocking === 0,
    status,
    failedBlocking,
    results,
    definitionId: String(def._id),
  };
}
