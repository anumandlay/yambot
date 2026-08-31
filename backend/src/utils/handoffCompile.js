/**
 * @fileoverview Compile Architect blueprint into WorkflowDefinition + handoff triggers.
 * Purpose: Make plan.apis / handoffs / dataMaps executable at apply time.
 * Downstream: architect apply, apiWorkflowRunner, workflowTests.
 */

import { Trigger, TRIGGER_TYPES, TRIGGER_ACTIONS, normalizeTriggerEventType } from "../models/Trigger.js";
import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { normalizeEventType } from "./eventCatalog.js";

/**
 * Resolve a dotted path from an object (simple JSONPath-lite).
 * @param {object} obj
 * @param {string} path
 * @returns {unknown}
 */
export function getByPath(obj, path) {
  if (!path || path === "$" || path === ".") return obj;
  const clean = String(path).replace(/^\$\.?/, "");
  if (!clean) return obj;
  return clean.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

/**
 * Apply dataMaps: copy from source paths in ctx into target paths.
 * @param {object} ctx
 * @param {{ from?: string, to?: string, source?: string, target?: string }[]} maps
 * @returns {object}
 */
export function applyDataMaps(ctx, maps) {
  const out = { ...ctx, vars: { ...(ctx.vars || {}) } };
  for (const m of maps || []) {
    const from = m.from || m.source || "";
    const to = m.to || m.target || "";
    if (!from || !to) continue;
    const val = getByPath(out, from);
    const parts = String(to).replace(/^\$\.?/, "").split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return out;
}

/**
 * Render {{var}} templates from context.
 * @param {string} template
 * @param {object} ctx
 * @returns {string}
 */
export function renderTemplate(template, ctx) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = getByPath(ctx, key);
    return v == null ? "" : String(v);
  });
}

/**
 * Build workflow steps from blueprint plan.apis + dataMaps.
 * @param {object} blueprint
 * @param {Record<string, string>} agentKeyToId
 * @returns {object[]}
 */
export function compileStepsFromBlueprint(blueprint, agentKeyToId = {}) {
  const plan = blueprint?.plan || {};
  const apis = Array.isArray(plan.apis) ? plan.apis : [];
  const maps = Array.isArray(blueprint?.dataMaps) ? blueprint.dataMaps : [];
  /** @type {object[]} */
  const steps = [];

  apis.forEach((api, i) => {
    const method = String(api.method || "GET").toUpperCase();
    const host = String(api.hostHint || "").replace(/\/$/, "");
    const path = String(api.pathHint || "/").startsWith("http")
      ? String(api.pathHint)
      : `${host}${String(api.pathHint || "/").startsWith("/") ? "" : "/"}${api.pathHint || ""}`;
    const kind = method === "GET" || method === "HEAD" ? "api_get" : "api_write";
    steps.push({
      id: `api_${i}`,
      kind,
      name: String(api.purpose || `${method} ${path}`).slice(0, 160),
      method,
      urlTemplate: path || host,
      map: [],
      agentKey: String(api.usedByAgentKey || ""),
      agentId: agentKeyToId[String(api.usedByAgentKey || "")] || null,
      timeoutMs: 30_000,
      retry: { maxAttempts: 3, backoffMs: 1000 },
      idempotencyKeyTemplate: `api_${i}_{{correlationId}}`,
    });
    if (kind === "api_get" && maps.length) {
      steps.push({
        id: `map_${i}`,
        kind: "transform",
        name: "Apply data maps",
        map: maps.map((m) => ({
          from: m.source || m.from || "",
          to: m.target || m.to || "",
          note: m.note || "",
        })),
      });
    }
  });

  // Agent processing step when GET then POST pattern exists
  const hasGet = steps.some((s) => s.kind === "api_get");
  const hasWrite = steps.some((s) => s.kind === "api_write");
  const firstAgentKey =
    Object.keys(agentKeyToId)[0] ||
    (plan.agents || [])[0]?.key ||
    "";
  if (hasGet && firstAgentKey) {
    const insertAt = steps.findIndex((s) => s.kind === "transform") + 1 || 1;
    steps.splice(insertAt, 0, {
      id: "agent_process",
      kind: "agent_task",
      name: "Agent processes records",
      agentKey: firstAgentKey,
      agentId: agentKeyToId[firstAgentKey] || null,
      goalTemplate:
        "Process the workflow context JSON and produce the outbound payload fields needed for the next API write. Context: {{vars}}",
      timeoutMs: 600_000,
      retry: { maxAttempts: 1, backoffMs: 0 },
    });
  }
  if (hasWrite) {
    steps.push({
      id: "verify_write",
      kind: "verify",
      name: "Verify write succeeded",
      assertPath: "vars.lastWriteStatus",
      assertEquals: 200,
    });
  }

  return steps;
}

/**
 * Compile handoff edges from blueprint graph / reply triggers / branches.
 * @param {object} blueprint
 * @param {Record<string, string>} agentKeyToId
 * @returns {object[]}
 */
export function compileHandoffsFromBlueprint(blueprint, agentKeyToId = {}) {
  const plan = blueprint?.plan || {};
  const triggers = Array.isArray(plan.triggers) ? plan.triggers : [];
  /** @type {object[]} */
  const handoffs = [];

  for (const t of triggers) {
    const onEvent = normalizeEventType(
      t.config?.eventType || (t.type === "event" ? "email.replied" : "")
    );
    if (!onEvent) continue;
    const toKey = String(t.agentKey || "").trim();
    if (!toKey) continue;
    handoffs.push({
      fromAgentKey: "",
      toAgentKey: toKey,
      onEvent,
      condition: String(t.purpose || ""),
      payloadMap: { summary: "$.summary", correlationId: "$.correlationId" },
      dedupeKeyTemplate: `${onEvent}_{{entityId}}_{{correlationId}}`,
      timeoutMs: 0,
      triggerId: null,
    });
  }

  const edges = blueprint?.graph?.edges || [];
  for (const e of edges) {
    const from = String(e.from || e.source || "");
    const to = String(e.to || e.target || "");
    if (!from || !to) continue;
    if (agentKeyToId[from] && agentKeyToId[to]) {
      handoffs.push({
        fromAgentKey: from,
        toAgentKey: to,
        onEvent: "agent.completed",
        condition: String(e.label || e.when || ""),
        payloadMap: {},
        dedupeKeyTemplate: `handoff_${from}_${to}_{{correlationId}}`,
        timeoutMs: 0,
        triggerId: null,
      });
    }
  }

  return handoffs;
}

/**
 * Ensure event triggers exist for handoffs; return updated handoffs with triggerIds.
 * @param {string} userId
 * @param {object[]} handoffs
 * @param {Record<string, string>} agentKeyToId
 * @returns {Promise<{ handoffs: object[], triggerIds: string[] }>}
 */
export async function materializeHandoffTriggers(userId, handoffs, agentKeyToId) {
  /** @type {string[]} */
  const triggerIds = [];
  const out = [];
  for (const h of handoffs) {
    const agentId = agentKeyToId[h.toAgentKey];
    if (!agentId) {
      out.push(h);
      continue;
    }
    const eventType = normalizeTriggerEventType(h.onEvent) || h.onEvent;
    const name = `Handoff: ${eventType} → ${h.toAgentKey}`.slice(0, 120);
    let trigger = await Trigger.findOne({
      user: userId,
      name,
      agent: agentId,
      type: "event",
    });
    if (!trigger) {
      trigger = await Trigger.create({
        user: userId,
        name,
        enabled: true,
        type: TRIGGER_TYPES.includes("event") ? "event" : "event",
        agent: agentId,
        config: { eventType },
        action: TRIGGER_ACTIONS.includes("enqueue_task") ? "enqueue_task" : "enqueue_task",
        actionConfig: {
          instructions: `Handoff on ${eventType}. Use correlationId and entity context from the event payload. ${h.condition || ""}`.slice(
            0,
            4000
          ),
        },
      });
    }
    triggerIds.push(String(trigger._id));
    out.push({ ...h, triggerId: trigger._id });
  }
  return { handoffs: out, triggerIds };
}

/**
 * Create or update WorkflowDefinition after blueprint build.
 * @param {string} userId
 * @param {object} opts
 * @returns {Promise<import('mongoose').Document>}
 */
export async function compileWorkflowFromBlueprint(userId, opts) {
  const {
    blueprint,
    blueprintId,
    agentKeyToId,
    incidentPolicy,
    environment = "production",
    skipMaterialize = false,
  } = opts;
  const steps = compileStepsFromBlueprint(blueprint, agentKeyToId);
  let handoffs = compileHandoffsFromBlueprint(blueprint, agentKeyToId);
  /** @type {string[]} */
  let triggerIds = [];
  if (!skipMaterialize) {
    const mat = await materializeHandoffTriggers(userId, handoffs, agentKeyToId);
    handoffs = mat.handoffs;
    triggerIds = mat.triggerIds;
  }

  const name =
    String(blueprint?.summary || blueprint?.understanding?.objective || "Business workflow").slice(
      0,
      160
    );

  let def = blueprintId
    ? await WorkflowDefinition.findOne({ user: userId, blueprintId })
    : null;
  if (!def) {
    def = new WorkflowDefinition({ user: userId, blueprintId: blueprintId || null });
  }
  def.name = name;
  def.environment = environment;
  def.version = (def.version || 0) + 1;
  def.steps = steps;
  def.handoffs = handoffs;
  def.agentKeyToId = agentKeyToId;
  def.incidentPolicy = incidentPolicy || def.incidentPolicy || {};
  def.active = true;
  await def.save();
  return { def, triggerIds };
}
