/**
 * @fileoverview True self-heal — diagnose → sandbox test → apply → retry → verify.
 * Purpose: Replace instruction-append-only recovery with gated, learned playbooks.
 * Downstream: /api/heal, scheduler on failures, businessPulse integration.
 */

import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { recordDecision } from "../models/DecisionJournal.js";
import { emitEvent } from "./eventBus.js";
import { diagnoseCeo } from "./ceoChat.js";
import { runWorkflowTestSuite } from "./workflowTests.js";
import { retryWorkflowRun } from "./apiWorkflowRunner.js";

const AUTHORITY_RANK = {
  observe: 0,
  internal: 1,
  external: 2,
  financial: 3,
  critical: 4,
};

/**
 * @param {string} userId
 * @param {string} pattern
 * @returns {string}
 */
function playbookKey(pattern) {
  return `heal_playbook:${String(pattern || "generic")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .slice(0, 80)}`;
}

/**
 * @param {string} userId
 * @param {string} pattern
 */
async function loadPlaybook(userId, pattern) {
  const row = await CompanyMemory.findOne({ user: userId, key: playbookKey(pattern) }).lean();
  if (!row?.value) return null;
  try {
    return JSON.parse(String(row.value));
  } catch {
    return { steps: [{ type: "note", text: String(row.value) }], successCount: 0 };
  }
}

/**
 * @param {string} userId
 * @param {string} pattern
 * @param {object} playbook
 */
async function savePlaybook(userId, pattern, playbook) {
  const key = playbookKey(pattern);
  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      $set: {
        value: JSON.stringify(playbook).slice(0, 4000),
        category: "system",
        source: "heal",
        key,
      },
      $setOnInsert: { user: userId, confidence: 0.9 },
    },
    { upsert: true }
  );
}

/**
 * Loop guard: count recent heals for correlation/agent.
 * @param {string} userId
 * @param {string} guardKey
 */
async function underLoopGuard(userId, guardKey) {
  const key = `heal_guard:${guardKey}`;
  const row = await CompanyMemory.findOne({ user: userId, key }).lean();
  const now = Date.now();
  let data = { count: 0, window: now };
  if (row?.value) {
    try {
      data = JSON.parse(String(row.value));
    } catch {
      /* reset */
    }
  }
  if (now - Number(data.window || 0) > 60 * 60_000) {
    data = { count: 0, window: now };
  }
  if (data.count >= 3) return { ok: false, data };
  data.count += 1;
  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      $set: { value: JSON.stringify(data), category: "system", source: "heal", key },
      $setOnInsert: { user: userId },
    },
    { upsert: true }
  );
  return { ok: true, data };
}

/**
 * Classify error into a playbook pattern key.
 * @param {string} errorText
 */
export function classifyFailure(errorText) {
  const h = String(errorText || "").toLowerCase();
  if (/email|smtp|imap|mailbox|not configured/.test(h)) return "email_config";
  if (/captcha|challenge/.test(h)) return "captcha";
  if (/timeout|etimedout|aborted/.test(h)) return "timeout";
  if (/host not allowed|httpallow/.test(h)) return "http_allow";
  if (/401|403|unauthorized|forbidden/.test(h)) return "auth";
  if (/5\d\d|econnrefused|fetch failed/.test(h)) return "http_upstream";
  return "generic";
}

/**
 * Default playbook steps by pattern.
 * @param {string} pattern
 */
function defaultPlaybook(pattern) {
  const map = {
    email_config: {
      steps: [
        {
          type: "instruction_patch",
          text: "Before check_email: ensure SMTP/IMAP hosts and app password are configured; use Architect Sync mailbox if needed.",
        },
        { type: "suggest_href", href: "/connections", label: "Connections" },
      ],
    },
    captcha: {
      steps: [
        {
          type: "instruction_patch",
          text: "On CAPTCHA: pause LLM, request human Take control, then resume. Prefer Teach skill after solve.",
        },
      ],
    },
    timeout: {
      steps: [
        {
          type: "instruction_patch",
          text: "On timeout: retry once with narrower URL/goal; increase wait; avoid rapid schedule ticks.",
        },
        { type: "retry_workflow" },
      ],
    },
    http_allow: {
      steps: [
        {
          type: "instruction_patch",
          text: "Add required API host to Policies → HTTP allow hosts, then retry workflow.",
        },
        { type: "suggest_href", href: "/policies", label: "Policies" },
      ],
    },
    auth: {
      steps: [
        {
          type: "instruction_patch",
          text: "Refresh API token in Connections; do not log secrets.",
        },
        { type: "suggest_href", href: "/connections", label: "Connections" },
      ],
    },
    http_upstream: {
      steps: [{ type: "retry_workflow" }, { type: "instruction_patch", text: "Backoff on 5xx; verify upstream health." }],
    },
    generic: {
      steps: [
        {
          type: "instruction_patch",
          text: "Simplify standing instructions; verify last error; consider Watch-me demo for this site.",
        },
      ],
    },
  };
  return map[pattern] || map.generic;
}

/**
 * Diagnose a failure and propose a heal plan (does not apply).
 * @param {string} userId
 * @param {{ taskId?: string, runId?: string, agentId?: string, errorHint?: string }} body
 */
export async function diagnoseForHeal(userId, body = {}) {
  const taskId = String(body.taskId || "").trim();
  let errorHint = String(body.errorHint || "").trim();
  let agentId = String(body.agentId || "").trim();

  if (taskId && mongoose.isValidObjectId(taskId)) {
    const task = await Task.findOne({ _id: taskId, user: userId }).lean();
    if (task) {
      errorHint = errorHint || String(task.lastError || task.resultSummary || "");
      agentId = agentId || (task.agent ? String(task.agent) : "");
    }
  }

  const pattern = classifyFailure(errorHint);
  const stored = await loadPlaybook(userId, pattern);
  const playbook = stored || defaultPlaybook(pattern);

  let diagnosis = null;
  if (agentId && mongoose.isValidObjectId(agentId)) {
    diagnosis = await diagnoseCeo(userId, {
      agentId,
      taskId,
      question: `Heal diagnose: ${errorHint.slice(0, 400)}`,
    });
  }

  return {
    ok: true,
    pattern,
    playbook,
    fromMemory: Boolean(stored),
    diagnosis,
    agentId,
    errorHint: errorHint.slice(0, 500),
  };
}

/**
 * Apply heal: authority check → optional sandbox test → patch → optional retry.
 * @param {string} userId
 * @param {object} body
 */
export async function applyHeal(userId, body = {}) {
  const user = await User.findById(userId).select("settings");
  const maxAuthority = user?.settings?.maxAuthorityLevel || "external";
  const mode = user?.settings?.operatingMode || "assisted";
  if (AUTHORITY_RANK[maxAuthority] < AUTHORITY_RANK.internal) {
    return {
      ok: false,
      title: "Blocked by authority",
      detail: "Self-heal apply requires at least internal authority.",
    };
  }
  if (mode === "observe" || mode === "recommend") {
    return {
      ok: false,
      title: "Blocked by operating mode",
      detail: `Mode “${mode}” cannot auto-apply heals. Switch to assisted/autonomous under Policies.`,
    };
  }

  const agentId = String(body.agentId || "").trim();
  const errorHint = String(body.errorHint || "").trim();
  const pattern = String(body.pattern || classifyFailure(errorHint));
  const guard = await underLoopGuard(userId, `${agentId || "na"}:${pattern}`);
  if (!guard.ok) {
    return {
      ok: false,
      title: "Loop guard",
      detail: "Already applied 3 heals for this agent/pattern in the last hour.",
    };
  }

  const playbook = body.playbook || (await loadPlaybook(userId, pattern)) || defaultPlaybook(pattern);

  // Sandbox regression when a workflow is linked
  const definitionId = String(body.definitionId || "").trim();
  if (definitionId && mongoose.isValidObjectId(definitionId)) {
    const suite = await runWorkflowTestSuite(userId, definitionId, {});
    if (!suite.ok) {
      return {
        ok: false,
        title: "Sandbox tests failed",
        detail: "Heal blocked: critical workflow tests did not pass.",
        suite,
      };
    }
  }

  /** @type {string[]} */
  const applied = [];
  if (agentId && mongoose.isValidObjectId(agentId)) {
    const agent = await Agent.findOne({ _id: agentId, user: userId });
    if (agent) {
      for (const step of playbook.steps || []) {
        if (step.type === "instruction_patch" && step.text) {
          const tip = `\n\n[Heal ${new Date().toISOString().slice(0, 10)} · ${pattern}]\n${step.text}`;
          agent.instructions = `${String(agent.instructions || "").trim()}${tip}`.slice(0, 8000);
          applied.push("instruction_patch");
        }
      }
      await agent.save();
    }
  }

  if ((playbook.steps || []).some((s) => s.type === "retry_workflow") && body.runId) {
    const retry = await retryWorkflowRun(userId, String(body.runId));
    applied.push(retry.ok ? "retry_ok" : "retry_failed");
    if (!retry.ok) {
      return { ok: false, title: "Retry failed", detail: retry.detail, applied };
    }
  }

  playbook.successCount = Number(playbook.successCount || 0) + 1;
  playbook.lastVerifiedAt = new Date().toISOString();
  await savePlaybook(userId, pattern, playbook);

  await recordDecision(userId, {
    actorType: "system",
    authorityLevel: "internal",
    decision: `Heal applied (${pattern})`,
    rationale: errorHint.slice(0, 400),
    context: { agentId, pattern, applied },
    outcome: "healed",
    approved: true,
  });

  await emitEvent({
    userId,
    type: "heal.applied",
    source: "heal",
    significance: "medium",
    agentId: agentId || null,
    summary: `Heal ${pattern}: ${applied.join(",")}`,
    payload: { pattern, applied },
  });

  return {
    ok: true,
    pattern,
    applied,
    playbook,
    detail: `Heal applied (${applied.join(", ") || "recorded"}).`,
  };
}
