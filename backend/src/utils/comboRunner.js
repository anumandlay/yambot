/**
 * @fileoverview Cross-mode combo planner/runner — computer then Composio tail(s).
 * Purpose: “Open Vughy, update Notion + Slack, email…” and create+credentials email.
 * Downstream: chats.js (attach comboFollowup on Task), worker.js (resume after complete),
 * composioAutoRuntime.js (N-step Composio execution).
 */

import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
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
  compactComposioExecuteResult,
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
import { llmChatCompletion } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";

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

  // Why: recipient@gmail.com must not count as “browse a .com site”.
  const noAddrs = raw.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");

  const hasBrowse =
    /\b(open|check|see|browse|visit|look\s*(at|into)|scrape|extract|login|log\s*in)\b/i.test(
      noAddrs
    ) &&
    /\b(vughy|crm|agency|website|site|portal|admin|https?:\/\/|www\.)\b/i.test(noAddrs);
  const hasCreate =
    /\b(create|register|sign\s*up|make)\b/i.test(noAddrs) &&
    /\b(account|crm|agency|vughy|signup|travel\s*agen)\b/i.test(noAddrs);
  const hasComputer = hasBrowse || hasCreate;

  const hasNotion = /\bnotion\b/i.test(raw);
  const hasSlack = /\bslack\b/i.test(raw) || /#[a-z0-9_-]{2,}/i.test(raw);
  // Why: “Email: foo@…” form labels must not count as a Gmail follow-up ask.
  const hasEmail =
    looksLikeSendEmailClause(raw) ||
    looksLikeComputerThenEmailCombo(raw) ||
    (/\bsend\b/i.test(raw) &&
      /\b(email|e-?mail|mail)\b/i.test(raw) &&
      Boolean(parseEmailRecipient(raw)));
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
 * @returns {{ version: number, recipe: string, userText: string, steps: ComboStep[], status: string, source?: string }|null}
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
    source: "heuristic",
  };
}

/**
 * Ambiguous computer ask that might be misread as combo (form Email/Password, @ in signup).
 * Why: these need LLM intent — not regex — so we do not invent Notion/email tails.
 * @param {string} text
 * @returns {boolean}
 */
export function maybeAmbiguousCombo(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (looksLikeHybridCombo(raw) || looksLikeComputerThenEmailCombo(raw)) return false;
  const hasComputer =
    /\b(open|create|register|sign\s*up|browse|visit|check|make)\b/i.test(raw) &&
    /\b(vughy|crm|agency|account|website|site|portal|https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})\b/i.test(
      raw
    );
  const hasEmailish =
    /@/.test(raw) ||
    /\b(email|e-?mail|password|notion|slack|sheet|spreadsheet)\b/i.test(raw);
  return hasComputer && hasEmailish;
}

/**
 * Map LLM / classify tails into Composio steps.
 * @param {string} userText
 * @param {string[]} tails
 * @param {string} [recipient]
 * @returns {ComboStep[]}
 */
export function stepsFromComboTails(userText, tails, recipient = "") {
  const raw = String(userText || "").trim();
  const to =
    String(recipient || "").trim() ||
    parseEmailRecipient(raw) ||
    extractEmailsFromComboText(raw)[0] ||
    "";
  /** @type {ComboStep[]} */
  const steps = [];
  const seen = new Set();
  for (const t of tails || []) {
    const key = String(t || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === "email" || key === "gmail" || key === "mail") {
      steps.push({
        kind: "send_email",
        label: to ? `Email ${to}` : "Send email",
        userText: raw,
        toolkit: "gmail",
        to: to || undefined,
        usePriorContent: true,
      });
    } else if (key === "slack") {
      steps.push({
        kind: "send_slack",
        label: "Slack message",
        userText: raw,
        toolkit: "slack",
        usePriorContent: true,
      });
    } else if (key === "notion") {
      steps.push({
        kind: "intent",
        label: "Notion update",
        userText: raw,
        toolkit: "notion",
        specId: "notion_write",
        usePriorContent: true,
      });
    } else if (key === "sheets" || key === "sheet" || key === "spreadsheet") {
      steps.push({
        kind: "intent",
        label: "Sheets update",
        userText: raw,
        toolkit: "googlesheets",
        specId: "sheets_write",
        usePriorContent: true,
      });
    }
  }
  return steps;
}

/**
 * @typedef {{
 *   mode: "none"|"computer_only"|"hybrid"|"composio_only",
 *   computerGoal: string,
 *   tails: string[],
 *   recipient: string,
 *   recipe: string,
 *   source: "heuristic"|"llm"|"none",
 *   reason?: string,
 * }} ComboClassification
 */

/**
 * Parse model JSON for combo intent.
 * @param {string} raw
 * @returns {ComboClassification|null}
 */
function parseComboClassificationJson(raw) {
  const cleaned = stripModelThinking(String(raw || "")).trim();
  if (!cleaned) return null;
  let jsonText = cleaned;
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  try {
    const obj = JSON.parse(jsonText);
    const modeRaw = String(obj.mode || obj.intent || "none")
      .trim()
      .toLowerCase();
    /** @type {ComboClassification["mode"]} */
    let mode = "none";
    if (modeRaw === "hybrid" || modeRaw === "combo") mode = "hybrid";
    else if (modeRaw === "computer_only" || modeRaw === "computer" || modeRaw === "browser") {
      mode = "computer_only";
    } else if (modeRaw === "composio_only" || modeRaw === "apps_only") {
      mode = "composio_only";
    } else if (modeRaw === "none") mode = "none";
    else return null;

    const tails = Array.isArray(obj.tails)
      ? obj.tails.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
      : [];
    return {
      mode,
      computerGoal: String(obj.computerGoal || obj.computer_goal || "").trim(),
      tails,
      recipient: String(obj.recipient || obj.to || "").trim(),
      recipe:
        String(obj.recipe || "").trim() ||
        (tails.includes("email") || tails.includes("gmail")
          ? "create_then_email"
          : "browse_then_composio_tail"),
      source: "llm",
      reason: String(obj.reason || "").trim().slice(0, 200),
    };
  } catch {
    return null;
  }
}

/**
 * LLM combo intent on the original user ask (not Auto-rewritten goals).
 * @param {string} text
 * @param {{
 *   apiKey?: string,
 *   llmApiKey?: string,
 *   llmBaseUrl?: string,
 *   llmModel?: string,
 *   signal?: AbortSignal|null,
 * }} [creds]
 * @returns {Promise<ComboClassification>}
 */
export async function classifyComboIntentWithLlm(text, creds = {}) {
  const raw = String(text || "").trim();
  const empty = {
    mode: /** @type {const} */ ("none"),
    computerGoal: "",
    tails: /** @type {string[]} */ ([]),
    recipient: "",
    recipe: "",
    source: /** @type {const} */ ("none"),
  };
  if (!raw) return empty;
  const apiKey = String(creds.apiKey || creds.llmApiKey || "").trim();
  if (!apiKey) return { ...empty, reason: "no_llm_key" };

  const system = `You classify YamBot chat asks into combo modes. Reply with ONLY JSON:
{"mode":"none"|"computer_only"|"hybrid"|"composio_only","computerGoal":"browser part only","tails":["email"|"slack"|"notion"|"sheets"],"recipient":"email if any","reason":"short"}

Rules:
- computer_only: browse/create/register/fill forms on a website. Form fields like Email:/Password: or dummy signup addresses are NOT a send-mail ask.
- hybrid: browser work THEN explicitly deliver/update via Notion, Slack, Gmail, or Sheets (e.g. "and send credentials to a@b.com", "and update Notion").
- composio_only: apps only, no live browser.
- none: greeting, Q&A, memory, unclear.
Never invent tails the user did not ask for.`;

  try {
    const result = await llmChatCompletion({
      apiKey,
      baseUrl: String(creds.llmBaseUrl || "").trim() || undefined,
      model: String(creds.llmModel || "").trim() || undefined,
      messages: [
        { role: "system", content: system },
        { role: "user", content: raw.slice(0, 4000) },
      ],
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 12_000,
      signal: creds.signal || null,
    });
    const parsed = parseComboClassificationJson(
      typeof result === "string" ? result : result?.content || ""
    );
    if (!parsed) return { ...empty, reason: "llm_parse_failed" };
    return parsed;
  } catch (err) {
    return { ...empty, reason: `llm_error:${String(err?.message || err).slice(0, 80)}` };
  }
}

/**
 * Classify combo intent: explicit heuristic first, else LLM when ambiguous.
 * @param {string} text
 * @param {{
 *   apiKey?: string,
 *   llmApiKey?: string,
 *   llmBaseUrl?: string,
 *   llmModel?: string,
 *   signal?: AbortSignal|null,
 *   skipLlm?: boolean,
 * }} [opts]
 * @returns {Promise<ComboClassification & { followup?: ReturnType<typeof buildComboFollowupForTask> }>}
 */
export async function classifyComboIntent(text, opts = {}) {
  const raw = String(text || "").trim();
  const base = {
    mode: /** @type {const} */ ("none"),
    computerGoal: "",
    tails: /** @type {string[]} */ ([]),
    recipient: "",
    recipe: "",
    source: /** @type {const} */ ("none"),
  };
  if (!raw) return base;

  // Why: clear phrases stay free — no LLM cost.
  if (looksLikeHybridCombo(raw) || looksLikeComputerThenEmailCombo(raw)) {
    const plan = planComboFromText(raw);
    if (plan.mode === "hybrid" && plan.composioSteps.length) {
      return {
        mode: "hybrid",
        computerGoal: plan.computerGoal || raw,
        tails: plan.composioSteps.map((s) =>
          s.kind === "send_email"
            ? "email"
            : s.kind === "send_slack" || s.toolkit === "slack"
              ? "slack"
              : s.toolkit === "notion" || String(s.specId || "").startsWith("notion")
                ? "notion"
                : s.toolkit || s.kind
        ),
        recipient:
          parseEmailRecipient(raw) || extractEmailsFromComboText(raw)[0] || "",
        recipe: plan.recipe,
        source: "heuristic",
        followup: {
          version: 1,
          recipe: plan.recipe,
          userText: raw,
          steps: plan.composioSteps,
          status: "pending",
          source: "heuristic",
        },
      };
    }
  }

  if (opts.skipLlm || !maybeAmbiguousCombo(raw)) {
    return { ...base, mode: "computer_only", computerGoal: raw, reason: "not_combo_phrase" };
  }

  const llm = await classifyComboIntentWithLlm(raw, opts);
  if (llm.mode === "hybrid") {
    const steps = stepsFromComboTails(raw, llm.tails, llm.recipient);
    if (!steps.length) {
      return {
        ...llm,
        mode: "computer_only",
        computerGoal: llm.computerGoal || raw,
        reason: llm.reason || "hybrid_no_tails",
      };
    }
    return {
      ...llm,
      computerGoal: llm.computerGoal || raw,
      followup: {
        version: 1,
        recipe: llm.recipe || "browse_then_composio_tail",
        userText: raw,
        steps,
        status: "pending",
        source: "llm",
      },
    };
  }
  if (llm.mode === "composio_only") return llm;
  if (llm.mode === "computer_only") {
    return { ...llm, computerGoal: llm.computerGoal || raw };
  }
  return { ...base, mode: "computer_only", computerGoal: raw, reason: llm.reason || "llm_none" };
}

/**
 * Resolve comboFollowup for Task create: prefer Auto classification, else explicit heuristic on user text.
 * @param {string} userText
 * @param {{ followup?: object|null }} [fromAuto]
 * @returns {{ version: number, recipe: string, userText: string, steps: ComboStep[], status: string, source?: string }|null}
 */
export function resolveComboFollowupForQueue(userText, fromAuto = {}) {
  const fromTurn = fromAuto?.followup;
  if (fromTurn && Array.isArray(fromTurn.steps) && fromTurn.steps.length) {
    return {
      version: 1,
      recipe: String(fromTurn.recipe || "browse_then_composio_tail"),
      userText: String(fromTurn.userText || userText || "").trim(),
      steps: fromTurn.steps,
      status: "pending",
      source: String(fromTurn.source || "auto"),
    };
  }
  // Why: Computer mode / no Auto classify — only explicit hybrid phrases on the original bubble.
  return buildComboFollowupForTask(userText);
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
      const toolkit = String(args.toolkit || "").trim();
      const data = await composioWaitForToolkit({
        userId,
        apiKey,
        toolkit,
        toolkitSlugs,
        timeoutMs: Number(args.timeoutMs) || 25_000,
      });
      if (data?.ok && data?.connected && toolkit) {
        try {
          const { ensureComposioToolkitToolCache } = await import("./composioService.js");
          await ensureComposioToolkitToolCache(agent, {
            apiKey,
            toolkits: [toolkit],
            force: true,
          });
        } catch {
          /* non-fatal */
        }
      }
      return JSON.stringify(data).slice(0, 4000);
    }
    if (kind === "composio_execute") {
      const toolSlug = String(args.tool || args.slug || "").trim();
      const send = await composioExecuteTool({
        userId,
        apiKey,
        sessionId: state.sessionId,
        toolkitSlugs,
        tool: toolSlug,
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
      // Why: schedule/combo ticks used raw 8KB JSON — Gmail lists truncated mid-payload so
      // subject/preview vanished (chat path already compactComposioExecuteResult first).
      const compact = compactComposioExecuteResult(send, toolSlug);
      return JSON.stringify(compact).slice(0, 8000);
    }
    return JSON.stringify({ ok: false, detail: `Unknown lookup ${kind}` });
  };
}

/**
 * After a successful computer run, ask confirm before Composio follow-ups
 * (or run immediately when skipConfirm is set).
 * @param {{
 *   userId: string,
 *   agent: object,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 *   skipConfirm?: boolean,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, content?: string, pending?: boolean }|null>}
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

  // Why: combo must be attached at queue from the original user ask (heuristic or LLM).
  // Never re-detect from Auto-rewritten task.goal (Email:/Password: form fields looked like send).
  if (!followup?.steps?.length) {
    return { ok: true, skipped: true, reason: "not_combo" };
  }

  if (!followup?.steps?.length) {
    return { ok: true, skipped: true, reason: "no_steps" };
  }

  if (String(followup.status || "") === "awaiting_confirm") {
    return { ok: true, skipped: true, reason: "already_awaiting_confirm", pending: true };
  }
  if (["done", "cancelled", "error", "needs_connect"].includes(String(followup.status || ""))) {
    return { ok: true, skipped: true, reason: `already_${followup.status}` };
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

  if (opts.skipConfirm === true) {
    return executeComboFollowupSteps({
      userId,
      agent,
      task,
      followup: { ...followup, priorContent, computerSummary: summary },
      priorContent,
    });
  }

  const stepLabels = (followup.steps || [])
    .map((s) => String(s.label || s.kind || s.specId || "step").trim())
    .filter(Boolean)
    .slice(0, 8);
  const ask = [
    `Computer step finished. I can run ${followup.steps.length} connected-app follow-up(s):`,
    stepLabels.length ? `• ${stepLabels.join("\n• ")}` : "",
    `Reply **confirm send** or **yes** to run them, or **cancel** to skip.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    task.comboFollowup = {
      ...followup,
      status: "awaiting_confirm",
      priorContent: String(priorContent || "").slice(0, 12000),
      computerSummary: String(summary || "").slice(0, 8000),
      askedAt: new Date().toISOString(),
    };
    task.markModified?.("comboFollowup");
    await task.save?.();
  } catch {
    /* non-fatal */
  }

  await Message.create({
    chat: task.chat,
    role: "assistant",
    content: ask,
    meta: {
      taskId: task._id,
      kind: "combo_followup_pending",
      stepCount: followup.steps.length,
      pendingComboFollowup: {
        taskId: String(task._id),
        agentId: String(agent._id || agent.id || ""),
        stepCount: followup.steps.length,
        stepLabels,
        recipe: followup.recipe || "",
      },
    },
  });

  return { ok: true, pending: true, reason: "awaiting_confirm", content: ask };
}

/**
 * Newest pending hybrid combo follow-up from recent chat messages.
 * @param {object[]} messages
 * @param {{ excludeIds?: string[] }} [opts]
 * @returns {object|null}
 */
export function resolvePendingComboFollowupFromMessages(messages, opts = {}) {
  const exclude = new Set((opts.excludeIds || []).map((id) => String(id)));
  const rows = (Array.isArray(messages) ? messages : []).filter(
    (m) => m && !exclude.has(String(m._id || ""))
  );
  const newestFirst = [...rows].sort((a, b) => {
    const aid = String(a._id || "");
    const bid = String(b._id || "");
    if (aid && bid) return bid.localeCompare(aid);
    return 0;
  });
  for (const m of newestFirst) {
    const role = String(m?.role || "");
    if (role !== "assistant" && role !== "agent") continue;
    const pending = m?.meta?.pendingComboFollowup;
    if (pending && typeof pending === "object" && pending.taskId) return pending;
    const kind = String(m?.meta?.kind || "");
    if (kind === "combo_followup_pending" && m?.meta?.taskId) {
      return { taskId: String(m.meta.taskId), stepCount: m.meta.stepCount || 0 };
    }
    break;
  }
  return null;
}

/**
 * @param {{ userId: string, taskId: string }} opts
 * @returns {Promise<{ ok: boolean, content: string }>}
 */
export async function cancelPendingComboFollowup(opts) {
  const userId = String(opts.userId || "").trim();
  const taskId = String(opts.taskId || "").trim();
  if (!userId || !taskId) {
    return { ok: false, content: "Could not cancel — missing task." };
  }
  const task = await Task.findOne({ _id: taskId, user: userId });
  if (!task) {
    return { ok: false, content: "Could not find that follow-up task." };
  }
  const followup =
    task.comboFollowup && typeof task.comboFollowup === "object" ? { ...task.comboFollowup } : {};
  followup.status = "cancelled";
  followup.cancelledAt = new Date().toISOString();
  task.comboFollowup = followup;
  task.markModified?.("comboFollowup");
  await task.save();
  return {
    ok: true,
    content: "Cancelled — I will not run the connected-app follow-up steps.",
  };
}

/**
 * User confirmed — run stored Composio combo steps after computer.
 * @param {{ userId: string, agent: object, taskId: string, postResultMessage?: boolean }} opts
 * @returns {Promise<{ ok: boolean, content: string, reason?: string }>}
 */
export async function executeApprovedComboFollowup(opts) {
  const userId = String(opts.userId || "").trim();
  const taskId = String(opts.taskId || "").trim();
  const agent = opts.agent;
  if (!userId || !taskId || !agent) {
    return { ok: false, content: "Could not run follow-ups — missing task or agent." };
  }
  const task = await Task.findOne({ _id: taskId, user: userId });
  if (!task) {
    return { ok: false, content: "Could not find that follow-up task." };
  }
  const followup =
    task.comboFollowup && typeof task.comboFollowup === "object" ? task.comboFollowup : null;
  if (!followup?.steps?.length) {
    return { ok: false, content: "No pending connected-app follow-ups on that task." };
  }
  if (String(followup.status || "") === "done") {
    return { ok: true, content: "Those follow-ups already finished." };
  }
  if (String(followup.status || "") === "cancelled") {
    return { ok: false, content: "Those follow-ups were cancelled." };
  }
  const priorContent = String(followup.priorContent || followup.computerSummary || "").trim();
  return executeComboFollowupSteps({
    userId,
    agent,
    task,
    followup,
    priorContent,
    // Why: chats.js persists the assistant reply — avoid a duplicate result bubble.
    postResultMessage: opts.postResultMessage !== false ? true : false,
  });
}

/**
 * Shared executor for confirmed (or skipConfirm) combo follow-ups.
 * @param {{
 *   userId: string,
 *   agent: object,
 *   task: object,
 *   followup: object,
 *   priorContent: string,
 *   postResultMessage?: boolean,
 * }} opts
 */
async function executeComboFollowupSteps(opts) {
  const { userId, agent, task, followup } = opts;
  const priorContent = String(opts.priorContent || "").trim();
  const postResultMessage = opts.postResultMessage !== false;
  const apiKey = decryptAgentComposioApiKey(agent);
  if (!apiKey) {
    return { ok: false, content: "No Composio API key on this agent.", reason: "no_api_key" };
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

  if (task.chat) {
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
  }

  const multi = await runComposioMultiStep({
    runtime,
    userText: followup.userText || String(task.goal || ""),
    plan: followup.steps,
    executeLookup,
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

  const content = String(multi.content || "").trim() || "Follow-up steps finished.";
  if (task.chat && postResultMessage) {
    await Message.create({
      chat: task.chat,
      role: "assistant",
      content,
      meta: {
        taskId: task._id,
        kind: "combo_followup",
        success: Boolean(multi.ok),
        needsConnect: Boolean(multi.needsConnect),
        recipe: followup.recipe || "",
      },
    });
  }

  return {
    ok: Boolean(multi.ok),
    reason: multi.needsConnect ? "needs_connect" : multi.ok ? "ok" : "error",
    content,
  };
}

// Re-export detectors used by chats / tests
export { looksLikeComputerThenEmailCombo, enrichComputerGoalForEmailFollowup };
