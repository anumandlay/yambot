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
          meta: { workflowRunId: String(run._id), correlationId: run.correlationId },
        });
        result.taskId = String(enq.task._id);
        run.status = "waiting";
        run.context = ctx;
        run.stepResults.push(result);
        run.stepIndex = i + 1;
        if (idemKey) run.idempotencyKeys = [...(run.idempotencyKeys || []), idemKey];
        await run.save();
        return; // resume later when agent completes (P1 hook)
      }
    } else if (step.kind === "emit_event") {
      await emitEvent({
        userId,
        type: step.eventType || "system.note",
        source: "workflow",
        correlationId: run.correlationId,
        summary: step.name || step.eventType,
        payload: { runId: String(run._id), context: ctx.vars },
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
