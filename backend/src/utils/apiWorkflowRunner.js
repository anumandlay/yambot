/**
 * @fileoverview API / multi-step workflow runner with persisted WorkflowRun state.
 * Purpose: Execute GET→transform→agent→POST→verify without relying on LLM http alone.
 * Downstream: /api/workflows, architect apply, heal, sandbox tests.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { WorkflowDefinition, WorkflowRun } from "../models/WorkflowDefinition.js";
import { getEffectivePolicy } from "./policy.js";
import { emitEvent } from "./eventBus.js";
import { enqueueTask } from "./enqueueTask.js";
import { mintCorrelationId } from "./eventCatalog.js";
import { applyDataMaps, getByPath, renderTemplate } from "./handoffCompile.js";
import { CompanyMemory } from "../models/CompanyMemory.js";

/**
 * @param {string} host
 * @param {string[]} allowHosts
 * @returns {boolean}
 */
function hostAllowed(host, allowHosts) {
  if (!allowHosts?.length) return true;
  const h = String(host || "").toLowerCase();
  return allowHosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Resolve connection secret from company memory by authRef key.
 * @param {string} userId
 * @param {string} authRef
 * @returns {Promise<Record<string, string>>}
 */
async function resolveAuthHeaders(userId, authRef) {
  if (!authRef) return {};
  const row = await CompanyMemory.findOne({ user: userId, key: authRef }).lean();
  if (!row?.value) return {};
  const v = String(row.value).trim();
  if (v.startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through */
    }
  }
  return { Authorization: `Bearer ${v}` };
}

/**
 * Sleep helper.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute one HTTP step (or mock in sandbox).
 * @param {object} step
 * @param {object} ctx
 * @param {{ sandbox?: boolean, allowHosts?: string[], userId: string }} opts
 */
async function runHttpStep(step, ctx, opts) {
  const url = renderTemplate(step.urlTemplate || "", ctx);
  if (!url) throw new Error(`Step ${step.id}: missing URL`);
  const host = hostOf(url);
  if (!opts.sandbox && host && !hostAllowed(host, opts.allowHosts || [])) {
    throw new Error(`Host not allowed: ${host}`);
  }

  const method = String(step.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    ...(step.headers || {}),
    ...(await resolveAuthHeaders(opts.userId, step.authRef)),
  };
  let body;
  if (step.bodyTemplate != null && method !== "GET" && method !== "HEAD") {
    const raw =
      typeof step.bodyTemplate === "string"
        ? renderTemplate(step.bodyTemplate, ctx)
        : JSON.stringify(step.bodyTemplate);
    body = renderTemplate(raw, ctx);
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  if (opts.sandbox) {
    const mockStatus = method === "GET" ? 200 : 200;
    const mockBody =
      method === "GET"
        ? { sandbox: true, records: [{ id: "1", email: "sandbox@example.com", status: "new" }] }
        : { sandbox: true, ok: true, id: "written-1" };
    return { status: mockStatus, body: mockBody, url, method, sandbox: true };
  }

  const maxAttempts = Math.max(1, Number(step.retry?.maxAttempts) || 2);
  const backoff = Math.max(0, Number(step.retry?.backoffMs) || 1000);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Number(step.timeoutMs) || 30_000);
      const res = await fetch(url, {
        method,
        headers,
        body: body || undefined,
        signal: controller.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
      if (!res.ok && attempt < maxAttempts) {
        await sleep(backoff * attempt);
        continue;
      }
      return { status: res.status, body: parsed, url, method, sandbox: false };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) await sleep(backoff * attempt);
    }
  }
  throw lastErr || new Error("HTTP step failed");
}

/**
 * Run a workflow definition to completion (or until agent wait).
 * @param {string} userId
 * @param {string} definitionId
 * @param {{ payload?: object, environment?: string, correlationId?: string, forceSandbox?: boolean }} [opts]
 */
export async function startWorkflowRun(userId, definitionId, opts = {}) {
  const def = await WorkflowDefinition.findOne({ _id: definitionId, user: userId });
  if (!def || !def.active) {
    return { ok: false, title: "Workflow missing", detail: "Definition not found or inactive." };
  }

  const environment = opts.forceSandbox
    ? "sandbox"
    : opts.environment || def.environment || "sandbox";
  const sandbox = environment === "sandbox" || environment === "draft";
  const correlationId = String(opts.correlationId || "").trim() || mintCorrelationId("wf");

  const user = await User.findById(userId);
  const policy = getEffectivePolicy(user?.settings || {});

  const run = await WorkflowRun.create({
    user: userId,
    definition: def._id,
    correlationId,
    environment,
    status: "running",
    stepIndex: 0,
    context: {
      correlationId,
      input: opts.payload || {},
      vars: { ...(opts.payload || {}) },
    },
    stepResults: [],
    attempt: 1,
  });

  try {
    await executeRun(userId, def, run, { sandbox, allowHosts: policy.httpAllowHosts || [] });
  } catch (err) {
    run.status = "failed";
    run.error = err?.message || String(err);
    await run.save();
    await emitEvent({
      userId,
      type: "workflow.failed",
      source: "workflow",
      significance: "high",
      correlationId,
      summary: run.error,
      payload: { runId: String(run._id), definitionId: String(def._id) },
    });
    return { ok: false, title: "Workflow failed", detail: run.error, run };
  }

  return { ok: true, run };
}

/**
 * @param {string} userId
 * @param {import('mongoose').Document} def
 * @param {import('mongoose').Document} run
 * @param {{ sandbox: boolean, allowHosts: string[] }} opts
 */
async function executeRun(userId, def, run, opts) {
  let ctx = run.context || { vars: {} };
  const steps = def.steps || [];

  for (let i = run.stepIndex || 0; i < steps.length; i++) {
    const step = steps[i];
    run.stepIndex = i;
    run.status = "running";
    await run.save();

    const idemKey = step.idempotencyKeyTemplate
      ? renderTemplate(step.idempotencyKeyTemplate, ctx)
      : "";
    if (idemKey && (run.idempotencyKeys || []).includes(idemKey)) {
      run.stepResults.push({ stepId: step.id, skipped: true, reason: "idempotent" });
      continue;
    }

    /** @type {object} */
    let result = { stepId: step.id, kind: step.kind };

    if (step.kind === "api_get" || step.kind === "api_write") {
      const http = await runHttpStep(step, ctx, {
        sandbox: opts.sandbox,
        allowHosts: opts.allowHosts,
        userId,
      });
      result.http = { status: http.status, url: http.url, method: http.method, sandbox: http.sandbox };
      ctx.vars = ctx.vars || {};
      ctx.vars.lastHttp = http.body;
      ctx.vars.lastWriteStatus = http.status;
      if (step.kind === "api_get") ctx.vars.records = http.body;
      await emitEvent({
        userId,
        type: http.status >= 400 ? "api.failed" : "api.succeeded",
        source: "workflow",
        correlationId: run.correlationId,
        summary: `${step.method} ${http.url} → ${http.status}`,
        payload: { runId: String(run._id), stepId: step.id, status: http.status },
        significance: http.status >= 400 ? "high" : "low",
      });
      if (http.status >= 400) throw new Error(`HTTP ${http.status} on ${step.name || step.id}`);
    } else if (step.kind === "transform") {
      ctx = applyDataMaps(ctx, step.map || []);
      result.mapped = true;
    } else if (step.kind === "verify") {
      const val = getByPath(ctx, step.assertPath || "vars.lastWriteStatus");
      const expected = step.assertEquals;
      const ok =
        expected === undefined
          ? val != null && val !== false
          : JSON.stringify(val) === JSON.stringify(expected) || Number(val) === Number(expected);
      result.verify = { path: step.assertPath, value: val, expected, ok };
      if (!ok) throw new Error(`Verify failed: ${step.assertPath} !== ${JSON.stringify(expected)}`);
    } else if (step.kind === "agent_task") {
      const agentId = step.agentId || def.agentKeyToId?.[step.agentKey];
      if (!agentId) throw new Error(`No agent for step ${step.id}`);
      if (opts.sandbox) {
        ctx.vars = ctx.vars || {};
        ctx.vars.agentResult = { sandbox: true, processed: true };
        result.sandboxAgent = true;
      } else {
        const goalText = renderTemplate(step.goalTemplate || "Continue the workflow.", ctx);
        const enq = await enqueueTask({
          userId,
          agentId: String(agentId),
          goalText: `${goalText}\n\ncorrelationId=${run.correlationId}\nworkflowRunId=${run._id}`,
          source: "workflow",
          priority: "high",
          chatTitle: `Workflow · ${def.name}`.slice(0, 80),
          workflowRunId: String(run._id),
          correlationId: run.correlationId,
          meta: { workflowRunId: String(run._id), correlationId: run.correlationId },
        });
        result.taskId = String(enq.task._id);
        run.status = "waiting";
        run.context = ctx;
        run.stepResults.push(result);
        // Why: stepIndex points at the *next* step after this agent_task finishes.
        run.stepIndex = i + 1;
        if (idemKey) run.idempotencyKeys = [...(run.idempotencyKeys || []), idemKey];
        await run.save();
        return;
      }
    } else if (step.kind === "emit_event") {
      await emitEvent({
        userId,
        type: step.eventType || "system.note",
        source: "workflow",
        correlationId: run.correlationId,
        summary: step.name || step.eventType,
        payload: { runId: String(run._id), context: ctx.vars },
        dedupeKey: idemKey || undefined,
      });
      result.emitted = step.eventType;
    } else if (step.kind === "handoff") {
      await emitEvent({
        userId,
        type: "handoff.sent",
        source: "workflow",
        correlationId: run.correlationId,
        agentId: step.agentId || def.agentKeyToId?.[step.toAgentKey],
        summary: `Handoff to ${step.toAgentKey || step.agentKey}`,
        payload: { toAgentKey: step.toAgentKey, runId: String(run._id) },
      });
      result.handoff = true;
    } else if (step.kind === "delay" || step.kind === "wait_until") {
      let wakeAt = null;
      if (step.kind === "delay") {
        const ms = Math.max(0, Number(step.delayMs) || 0);
        // Why: sandbox proofs use tiny delays; production can wait days/weeks.
        const effectiveMs = opts.sandbox ? Math.min(ms, 50) : ms;
        wakeAt = new Date(Date.now() + effectiveMs);
      } else {
        const raw = renderTemplate(step.waitUntilTemplate || "", ctx);
        const parsed = Date.parse(raw);
        wakeAt = Number.isFinite(parsed) ? new Date(parsed) : new Date(Date.now() + 60_000);
        if (opts.sandbox && wakeAt.getTime() > Date.now() + 1000) {
          wakeAt = new Date(Date.now() + 50);
        }
      }
      result.wakeAt = wakeAt.toISOString();
      run.status = "waiting_delay";
      run.wakeAt = wakeAt;
      run.context = ctx;
      run.stepResults.push(result);
      run.stepIndex = i + 1;
      if (idemKey) run.idempotencyKeys = [...(run.idempotencyKeys || []), idemKey];
      await run.save();
      return;
    } else if (step.kind === "await_approval") {
      const { Approval } = await import("../models/Approval.js");
      const question =
        renderTemplate(step.approvalQuestion || step.name || "Approve workflow step?", ctx) ||
        "Approve workflow continuation?";
      const approval = await Approval.create({
        user: userId,
        agent: step.agentId || null,
        task: null,
        type: "custom",
        status: "pending",
        question: String(question).slice(0, 2000),
        context: { workflowRunId: String(run._id), stepId: step.id },
        workflowRunId: run._id,
      });
      result.approvalId = String(approval._id);
      run.status = "waiting_approval";
      run.approvalId = approval._id;
      run.context = ctx;
      run.stepResults.push(result);
      run.stepIndex = i + 1;
      if (idemKey) run.idempotencyKeys = [...(run.idempotencyKeys || []), idemKey];
      await run.save();
      return;
    }

    if (idemKey) run.idempotencyKeys = [...(run.idempotencyKeys || []), idemKey];
    run.stepResults.push(result);
    run.context = ctx;
    await run.save();
    await emitEvent({
      userId,
      type: "workflow.step.completed",
      source: "workflow",
      correlationId: run.correlationId,
      summary: `Step ${step.id} (${step.kind})`,
      payload: { runId: String(run._id), stepId: step.id },
      significance: "low",
    });
  }

  run.status = "succeeded";
  run.context = ctx;
  await run.save();
  await emitEvent({
    userId,
    type: "workflow.completed",
    source: "workflow",
    correlationId: run.correlationId,
    summary: `Workflow ${def.name} succeeded`,
    payload: { runId: String(run._id) },
  });
}

/**
 * Resume a workflow run that was waiting on an agent_task.
 * @param {string} userId
 * @param {string} runId
 * @param {{ success?: boolean, summary?: string, error?: string, taskId?: string }} [opts]
 */
export async function resumeWorkflowRun(userId, runId, opts = {}) {
  const run = await WorkflowRun.findOne({ _id: runId, user: userId });
  if (!run) return { ok: false, title: "Missing", detail: "Run not found" };
  const waitStatuses = ["waiting", "waiting_delay", "waiting_approval"];
  if (!waitStatuses.includes(run.status) && opts.force !== true) {
    return { ok: false, title: "Not waiting", detail: `Run status is ${run.status}` };
  }
  const def = await WorkflowDefinition.findOne({ _id: run.definition, user: userId });
  if (!def) return { ok: false, title: "Missing", detail: "Definition not found" };

  const ctx = run.context || { vars: {} };
  ctx.vars = ctx.vars || {};
  if (opts.approvalDecision) {
    ctx.vars.approval = {
      decision: opts.approvalDecision,
      note: String(opts.summary || "").slice(0, 500),
    };
    if (opts.approvalDecision === "denied") {
      run.status = "cancelled";
      run.error = "Approval denied";
      run.context = ctx;
      await run.save();
      return { ok: false, title: "Denied", detail: "Approval denied", run };
    }
  }
  if (opts.success !== undefined || opts.summary || opts.error || opts.taskId) {
    ctx.vars.agentResult = {
      success: opts.success !== false,
      summary: String(opts.summary || "").slice(0, 4000),
      error: String(opts.error || "").slice(0, 2000),
      taskId: opts.taskId || null,
    };
  }
  run.context = ctx;

  if (opts.success === false && run.status === "waiting") {
    run.status = "failed";
    run.error = String(opts.error || opts.summary || "Agent step failed").slice(0, 2000);
    await run.save();
    await emitEvent({
      userId,
      type: "workflow.failed",
      source: "workflow",
      significance: "high",
      correlationId: run.correlationId,
      summary: run.error,
      payload: { runId: String(run._id), taskId: opts.taskId },
    });
    return { ok: false, title: "Agent step failed", detail: run.error, run };
  }

  const user = await User.findById(userId);
  const policy = getEffectivePolicy(user?.settings || {});
  const sandbox = run.environment === "sandbox" || run.environment === "draft";
  run.status = "running";
  run.wakeAt = null;
  await run.save();

  try {
    await executeRun(userId, def, run, {
      sandbox,
      allowHosts: policy.httpAllowHosts || [],
    });
  } catch (err) {
    run.status = "failed";
    run.error = err?.message || String(err);
    await run.save();
    await emitEvent({
      userId,
      type: "workflow.failed",
      source: "workflow",
      significance: "high",
      correlationId: run.correlationId,
      summary: run.error,
      payload: { runId: String(run._id) },
    });
    return { ok: false, title: "Resume failed", detail: run.error, run };
  }
  return { ok: true, run };
}

/**
 * Wake durable delay waits whose wakeAt has passed.
 * @returns {Promise<{ resumed: number }>}
 */
export async function tickWorkflowWaits() {
  const due = await WorkflowRun.find({
    status: "waiting_delay",
    wakeAt: { $lte: new Date() },
  })
    .limit(40)
    .select("_id user");
  let resumed = 0;
  for (const row of due) {
    const result = await resumeWorkflowRun(String(row.user), String(row._id), { force: true });
    if (result.ok || result.run?.status === "succeeded" || result.run?.status === "waiting") {
      resumed += 1;
    }
  }
  return { resumed };
}

/**
 * Retry a failed run (idempotent where keys recorded).
 * @param {string} userId
 * @param {string} runId
 */
export async function retryWorkflowRun(userId, runId) {
  const run = await WorkflowRun.findOne({ _id: runId, user: userId });
  if (!run) return { ok: false, title: "Missing", detail: "Run not found" };
  if (run.attempt >= 5) {
    return { ok: false, title: "Loop guard", detail: "Max retry attempts (5) reached for this run." };
  }
  const def = await WorkflowDefinition.findOne({ _id: run.definition, user: userId });
  if (!def) return { ok: false, title: "Missing", detail: "Definition not found" };

  run.attempt += 1;
  run.status = "running";
  run.error = "";
  run.stepIndex = 0;
  run.stepResults = [];
  await run.save();

  const user = await User.findById(userId);
  const policy = getEffectivePolicy(user?.settings || {});
  const sandbox = run.environment === "sandbox" || run.environment === "draft";
  try {
    await executeRun(userId, def, run, {
      sandbox,
      allowHosts: policy.httpAllowHosts || [],
    });
  } catch (err) {
    run.status = "failed";
    run.error = err?.message || String(err);
    await run.save();
    return { ok: false, title: "Retry failed", detail: run.error, run };
  }
  return { ok: true, run };
}
