/**
 * @fileoverview Cross-mode combo planner/runner — computer then Composio tail(s).
 * Purpose: “Open Vughy, update Notion + Slack, email…” and create+credentials email.
 * Downstream: chats.js (attach comboFollowup on Task), worker.js (resume after complete),
 * composioAutoRuntime.js (N-step Composio execution).
 */

import { Message } from "../models/Chat.js";
import {
  looksLikeComputerThenEmailCombo,
  enrichComputerGoalForEmailFollowup,
  extractEmailsFromComboText,
  extractCredentialsFromSummary,
  buildCredentialsEmailBody,
} from "./computerThenEmailFollowup.js";
import {
  planComposioMultiSteps,
  runComposioMultiStep,
  parseEmailRecipient,
  looksLikeSendEmailClause,
  looksLikeSendSlackClause,
} from "./composioAutoRuntime.js";
import {
  composioExecuteTool,
  decryptAgentComposioApiKey,
  expandComposioToolkitSlugs,
  composioListStatus,
  composioSearchTools,
  composioAuthorizeToolkit,
  composioWaitForToolkit,
} from "./composioService.js";

/**
 * @typedef {{
 *   kind: "computer"|"send_email"|"send_slack"|"intent",
 *   label: string,
 *   userText?: string,
 *   toolkit?: string,
 *   to?: string,
 *   usePriorContent?: boolean,
 *   specId?: string,
 *   goal?: string,
 * }} ComboStep
 */

/**
 * True when the ask needs a live browser step plus connected-app follow-ups.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeHybridCombo(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (looksLikeComputerThenEmailCombo(raw)) return true;

  const hasBrowse =
    /\b(open|check|see|browse|visit|look\s*(at|into)|scrape|extract|login|log\s*in)\b/i.test(
      raw
    ) &&
    /\b(vughy|crm|agency|website|site|portal|admin|http|www\.|\.com|\.io)\b/i.test(raw);
  const hasCreate =
    /\b(create|register|sign\s*up|make)\b/i.test(raw) &&
    /\b(account|crm|agency|vughy|signup|travel\s*agen)\b/i.test(raw);
  const hasComputer = hasBrowse || hasCreate;

  const hasNotion = /\bnotion\b/i.test(raw);
  const hasSlack = /\bslack\b/i.test(raw) || /#[a-z0-9_-]{2,}/i.test(raw);
  const hasEmail =
    looksLikeSendEmailClause(raw) ||
    (/\b(send|email|e-?mail|mail)\b/i.test(raw) && Boolean(parseEmailRecipient(raw)));
  const hasSheets = /\b(sheet|spreadsheet|gsheet)\b/i.test(raw);
  const hasComposioTail = hasNotion || hasSlack || hasEmail || hasSheets;

  if (!hasComputer || !hasComposioTail) return false;
  // Need a connector word or multiple clauses so plain “open vughy” alone is not hybrid.
  return /\b(and|then|also|after)\b/i.test(raw) || (hasComputer && hasComposioTail && hasEmail);
}

/**
 * True when the ask is 2+ Composio steps with no live computer requirement.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeComposioOnlyCombo(text) {
  const raw = String(text || "").trim();
  if (!raw || looksLikeHybridCombo(raw)) return false;
  const plan = planComposioMultiSteps(raw);
  return plan.length >= 2;
}

/**
 * Strip browser / create clauses so remaining text plans as Composio steps.
 * @param {string} text
 * @returns {string}
 */
export function extractComposioTailText(text) {
  let t = String(text || "").trim();
  // Drop leading browse/create chunks before the last "and/then" that starts an app verb.
  t = t.replace(
    /^[\s\S]*?\b(?:and|then|also)\s+(?=(?:update|post|send|email|e-?mail|mail|add|write|put|share|notify).*\b(?:notion|slack|gmail|email)|(?:notion|slack))/i,
    ""
  );
  // If still whole string, keep as-is for planComposioMultiSteps.
  return t.trim() || String(text || "").trim();
}

/**
 * Build ordered Composio follow-up steps after a computer run (Notion / Slack / email).
 * @param {string} userText
 * @returns {ComboStep[]}
 */
export function planHybridComposioTail(userText) {
  const raw = String(userText || "").trim();
  /** @type {ComboStep[]} */
  const steps = [];

  // Prefer structured multi-step planner on the tail; fall back to mention-based steps.
  const tailText = extractComposioTailText(raw);
  const planned = planComposioMultiSteps(tailText);
  if (planned.length >= 1) {
    for (const s of planned) {
      steps.push({
        ...s,
        usePriorContent:
          s.kind === "send_email" || s.kind === "send_slack" || s.specId === "notion_write"
            ? true
            : Boolean(s.usePriorContent),
      });
    }
  }

  const hasNotion = steps.some((s) => s.toolkit === "notion" || /notion/i.test(s.label || ""));
  const hasSlack = steps.some((s) => s.kind === "send_slack" || s.toolkit === "slack");
  const hasEmail = steps.some((s) => s.kind === "send_email");

  if (/\bnotion\b/i.test(raw) && !hasNotion) {
    const write =
      /\b(update|add|create|write|put|post|save)\b/i.test(raw) ||
      /\bin\s+notion\b/i.test(raw);
    steps.unshift({
      kind: "intent",
      label: write ? "Notion update" : "Notion fetch",
      userText: raw,
      toolkit: "notion",
      specId: write ? "notion_write" : "notion_fetch",
      usePriorContent: write,
    });
  }
  if ((/\bslack\b/i.test(raw) || /#[a-z0-9_-]{2,}/i.test(raw)) && !hasSlack) {
    steps.push({
      kind: "send_slack",
      label: "Slack message",
      userText: raw,
      toolkit: "slack",
      usePriorContent: true,
    });
  }
  if (
    (/\b(send|email|e-?mail|mail)\b/i.test(raw) || parseEmailRecipient(raw)) &&
    !hasEmail
  ) {
    const to = parseEmailRecipient(raw) || extractEmailsFromComboText(raw)[0] || "";
    steps.push({
      kind: "send_email",
      label: to ? `Email ${to}` : "Email",
      userText: raw,
      toolkit: "gmail",
      to,
      usePriorContent: true,
    });
  }

  // Deduplicate by kind+toolkit
  const seen = new Set();
  const out = [];
  for (const s of steps) {
    const key = `${s.kind}:${s.toolkit || ""}:${s.specId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 5);
}

/**
 * Enrich the computer goal so the worker captures data for the Composio tail.
 * @param {string} goalText
 * @param {string} userText
 * @param {ComboStep[]} [tail]
 * @returns {string}
 */
export function enrichComputerGoalForCombo(goalText, userText = "", tail = []) {
  const src = String(userText || goalText || "").trim();
  const base = String(goalText || userText || "").trim();
  if (!base) return base;

  if (looksLikeComputerThenEmailCombo(src) && (!tail.length || tail.every((s) => s.kind === "send_email"))) {
    return enrichComputerGoalForEmailFollowup(base, src);
  }

  if (!looksLikeHybridCombo(src)) return base;
  if (/MULTI-STEP JOB|COMBO FOLLOW-UP/i.test(base)) return base;

  const apps = [];
  for (const s of tail.length ? tail : planHybridComposioTail(src)) {
    if (s.toolkit === "notion" || s.specId?.startsWith("notion")) apps.push("Notion");
    if (s.kind === "send_slack" || s.toolkit === "slack") apps.push("Slack");
    if (s.kind === "send_email" || s.toolkit === "gmail") apps.push("email");
  }
  const appList = [...new Set(apps)].join(", ") || "connected apps";

  return `${base}

MULTI-STEP JOB (browser does step 1 only):
1) Complete the site work (open/check/create as asked). Capture the important results in your finish summary as plain text (tables, lists, credentials, URLs).
2) If you created an account, include on their own lines when known:
Account email: …
Password: …
Login URL: …
3) Do NOT open Gmail, Slack, or Notion in the browser — delivery/update via ${appList} runs after this computer job.`;
}

/**
 * Full combo plan for chat routing.
 * @param {string} text
 * @returns {{
 *   mode: "none"|"composio_only"|"hybrid",
 *   computerGoal: string,
 *   composioSteps: ComboStep[],
 *   recipe: string,
 * }}
 */
export function planComboFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { mode: "none", computerGoal: "", composioSteps: [], recipe: "" };
  }

  if (looksLikeHybridCombo(raw)) {
    const composioSteps = planHybridComposioTail(raw);
    let computerGoal = raw
      .replace(/\band\s+send\b[\s\S]*$/i, "")
      .replace(/\band\s+update\b[\s\S]*$/i, "")
      .replace(/\band\s+(?:post|notify|email|e-?mail|mail)\b[\s\S]*$/i, "")
      .trim();
    if (computerGoal.length < 12) computerGoal = raw;
    const recipe = looksLikeComputerThenEmailCombo(raw)
      ? "create_then_email"
      : "browse_then_composio_tail";
    return {
      mode: "hybrid",
      computerGoal,
      composioSteps,
      recipe,
    };
  }

  const composioSteps = planComposioMultiSteps(raw);
  if (composioSteps.length >= 2) {
    return {
      mode: "composio_only",
      computerGoal: "",
      composioSteps,
      recipe: "composio_multistep",
    };
  }

  return { mode: "none", computerGoal: "", composioSteps: [], recipe: "" };
}

/**
 * Build Task.comboFollowup payload for a hybrid queue.
 * @param {string} userText
 * @returns {{ version: number, recipe: string, userText: string, steps: ComboStep[], status: string }|null}
 */
export function buildComboFollowupForTask(userText) {
  const plan = planComboFromText(userText);
  if (plan.mode !== "hybrid" || !plan.composioSteps.length) return null;
  return {
    version: 1,
    recipe: plan.recipe,
    userText: String(userText || "").trim(),
    steps: plan.composioSteps,
    status: "pending",
  };
}

/**
 * Runtime bridge so runComposioMultiStep can execute from worker/agent context.
 * @param {{
 *   userId: string,
 *   agent: object,
 * }} opts
 */
export function buildComposioExecuteLookupFromAgent(opts) {
  const userId = String(opts.userId || "").trim();
  const agent = opts.agent;
  const apiKey = decryptAgentComposioApiKey(agent);
  const toolkitSlugs = expandComposioToolkitSlugs(
    Array.isArray(agent?.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
  );

  /** @type {{ sessionId: string|null }} */
  const state = {
    sessionId: String(agent?.composio?.sessionId || "").trim() || null,
  };

  /**
   * @param {string} kind
   * @param {object} _runtime
   * @param {object} [args]
   */
  return async function executeLookup(kind, _runtime, args = {}) {
    if (!apiKey) {
      return JSON.stringify({
        ok: false,
        detail: "No Composio API key on this agent.",
      });
    }
    if (agent?.composio?.enabled === false) {
      return JSON.stringify({ ok: false, detail: "Composio is disabled for this agent." });
    }
    if (kind === "composio_list") {
      return JSON.stringify(
        await composioListStatus({ userId, apiKey, toolkitSlugs })
      ).slice(0, 4000);
    }
    if (kind === "composio_search") {
      return JSON.stringify(
        await composioSearchTools({
          apiKey,
          query: args.query || args.q || "",
          toolkitSlugs,
          limit: 12,
        })
      ).slice(0, 4000);
    }
    if (kind === "composio_connect") {
      const data = await composioAuthorizeToolkit({
        userId,
        apiKey,
        toolkit: args.toolkit || args.app || "",
        toolkitSlugs,
        sessionId: state.sessionId,
      });
      if (data?.sessionId) state.sessionId = data.sessionId;
      return JSON.stringify(data).slice(0, 4000);
    }
    if (kind === "composio_wait") {
      const data = await composioWaitForToolkit({
        userId,
        apiKey,
        toolkit: args.toolkit || "",
        toolkitSlugs,
        timeoutMs: Number(args.timeoutMs) || 25_000,
      });
      return JSON.stringify(data).slice(0, 4000);
    }
    if (kind === "composio_execute") {
      const send = await composioExecuteTool({
        userId,
        apiKey,
        sessionId: state.sessionId,
        toolkitSlugs,
        tool: args.tool || args.slug || "",
        arguments: args.arguments || args.args || {},
      });
      if (send.sessionId) {
        state.sessionId = send.sessionId;
        try {
          if (agent.composio && String(agent.composio.sessionId || "") !== send.sessionId) {
            agent.composio.sessionId = send.sessionId;
            agent.markModified?.("composio");
            await agent.save?.();
          }
        } catch {
          /* non-fatal */
        }
      }
      return JSON.stringify(send).slice(0, 8000);
    }
    return JSON.stringify({ ok: false, detail: `Unknown lookup ${kind}` });
  };
}

/**
 * After a successful computer run, execute remaining Composio combo steps.
 * @param {{
 *   userId: string,
 *   agent: object,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, content?: string }|null>}
 */
export async function resumeComboAfterComputer(opts) {
  const success = opts.success !== false;
  const summary = String(opts.summary || "").trim();
  const task = opts.task;
  const agent = opts.agent;
  const userId = String(opts.userId || "").trim();
  if (!success || !summary || !task?.chat || !userId || !agent) return null;

  /** @type {{ steps?: ComboStep[], userText?: string, status?: string, recipe?: string }|null} */
  let followup = task.comboFollowup && typeof task.comboFollowup === "object" ? task.comboFollowup : null;

  // Legacy: create+email without comboFollowup field still works via detector on goal.
  if (!followup?.steps?.length) {
    const goal = String(task.goal || "");
    if (looksLikeComputerThenEmailCombo(goal) || looksLikeComputerThenEmailCombo(followup?.userText || "")) {
      followup = buildComboFollowupForTask(followup?.userText || goal);
    } else if (looksLikeHybridCombo(goal)) {
      followup = buildComboFollowupForTask(goal);
    } else {
      return { ok: true, skipped: true, reason: "not_combo" };
    }
  }

  if (!followup?.steps?.length) {
    return { ok: true, skipped: true, reason: "no_steps" };
  }

  if (!agent.composio?.enabled) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content:
        "Computer step finished, but Composio is off — enable it under Agents → Composio to run Notion/Slack/email follow-ups.",
      meta: { taskId: task._id, kind: "combo_followup", success: false, reason: "composio_off" },
    });
    return { ok: false, reason: "composio_off" };
  }

  const apiKey = decryptAgentComposioApiKey(agent);
  if (!apiKey) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content:
        "Computer step finished, but this agent has no Composio API key — add one under Agents → Composio.",
      meta: { taskId: task._id, kind: "combo_followup", success: false, reason: "no_api_key" },
    });
    return { ok: false, reason: "no_api_key" };
  }

  // Credentials email: prefer labeled body when recipe is create_then_email.
  let priorContent = summary;
  if (followup.recipe === "create_then_email" || looksLikeComputerThenEmailCombo(followup.userText || "")) {
    const to =
      parseEmailRecipient(followup.userText || "") ||
      extractEmailsFromComboText(followup.userText || task.goal || "")[0] ||
      "";
    const creds = extractCredentialsFromSummary(summary, { excludeEmails: to ? [to] : [] });
    if (creds.accountEmail || creds.password) {
      priorContent = buildCredentialsEmailBody(creds, summary);
    }
  }

  const executeLookup = buildComposioExecuteLookupFromAgent({ userId, agent });
  const runtime = {
    userId,
    composioApiKey: apiKey,
    composioEnabled: true,
    composioToolkitSlugs: expandComposioToolkitSlugs(
      Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
    ),
    composioSessionId: String(agent.composio?.sessionId || "").trim() || null,
  };

  await Message.create({
    chat: task.chat,
    role: "assistant",
    content: `Running ${followup.steps.length} follow-up step(s) via connected apps…`,
    meta: {
      taskId: task._id,
      kind: "combo_followup_progress",
      stepCount: followup.steps.length,
    },
  });

  const multi = await runComposioMultiStep({
    runtime,
    userText: followup.userText || String(task.goal || ""),
    plan: followup.steps,
    executeLookup,
    // Seed prior from computer summary before first Composio step.
    initialPriorContent: priorContent,
  });

  try {
    task.comboFollowup = {
      ...followup,
      status: multi.ok ? "done" : multi.needsConnect ? "needs_connect" : "error",
      completedAt: new Date().toISOString(),
      resultPreview: String(multi.content || "").slice(0, 500),
    };
    task.markModified?.("comboFollowup");
    await task.save?.();
  } catch {
    /* non-fatal */
  }

  await Message.create({
    chat: task.chat,
    role: "assistant",
    content: String(multi.content || "").trim() || "Follow-up steps finished.",
    meta: {
      taskId: task._id,
      kind: "combo_followup",
      success: Boolean(multi.ok),
      needsConnect: Boolean(multi.needsConnect),
      recipe: followup.recipe || "",
    },
  });

  return {
    ok: Boolean(multi.ok),
    reason: multi.needsConnect ? "needs_connect" : multi.ok ? "ok" : "error",
    content: multi.content,
  };
}

// Re-export detectors used by chats / tests
export { looksLikeComputerThenEmailCombo, enrichComputerGoalForEmailFollowup };
