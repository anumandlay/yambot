/**
 * @fileoverview Hermes-style Auto chat turn — model picks from YamBot chat tools.
 * Purpose: The chat LLM decides three modes — normal REPLY, live QUEUE_GOAL (computer/peers),
 * or Composio app tools. No Jev / heuristic short-circuit for that choice.
 * Downstream: chats.js Auto mode only.
 */

import { llmChatCompletion, llmChatCompletionMessage, llmChatCompletionStream } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";
import {
  classifyMessageIntent,
  looksLikeMemoryStoreRequest,
  looksLikeMemoryForgetRequest,
  looksLikeSessionScratchRequest,
  looksLikeDayHistoryOrStatusRequest,
  looksLikeVagueChatFollowup,
  looksLikeComposioAppRequest,
} from "./messageIntent.js";
import { emitReplyDelta } from "./replyDelta.js";
import {
  matchComposioIntent,
  compactComposioExecuteResult,
  runComposioIntentExecute,
  looksLikeFakeInboxActionText,
  looksLikeMultiStepComposioRequest,
  planComposioMultiSteps,
  runComposioMultiStep,
  COMPOSIO_INTENT_SPECS,
} from "./composioAutoRuntime.js";
import { looksLikeHybridCombo, planComboFromText } from "./comboRunner.js";
import {
  looksLikeScheduleManageRequest,
  parseScheduleFromChat,
  applyScheduleFromChat,
} from "./scheduleFromChat.js";
import { startOrResumeTaskPlan } from "./taskPlanRunner.js";

export {
  looksLikeGmailInboxRequest,
  looksLikeSlackSendRequest,
  looksLikeSheetsReadRequest,
  looksLikeFakeInboxActionText,
  looksLikeGmailLabelRequest,
  looksLikeMultiStepComposioRequest,
  planComposioMultiSteps,
  compactComposioExecuteResult,
  matchComposioIntent,
  buildGmailUnreadToolArgs,
  formatGmailUnreadSummaryFromToolResult,
} from "./composioAutoRuntime.js";

/**
 * OpenAI-compatible tool schemas for Auto chat (YamBot-only surface).
 * Terminal: reply, queue_goal. Lookup (loop): check_run_status, list_peer_agents.
 * Why: model proposes; runtime validates — never starts Playwright from a lookup tool.
 * @type {object[]}
 */
export const AUTO_CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "reply",
      description:
        "Answer in chat with the FINAL result for the user. For Gmail/Slack/Composio tasks, only after composio_execute (or a clear error). Never say hold on / digging / pulling — finish the work with tools first. Use for questions, memory-store, and capability asks. Do NOT use when the user wants a live browse/run right now.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Plain prose reply for the user (no tool JSON).",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_goal",
      description:
        "Start the cloud computer / peer workers for a LIVE browser job NOW (open a site, click/fill, message peers). Do NOT use for Gmail/Slack/Sheets/Notion/GitHub via Composio — use composio_* tools. Do NOT use for past-work questions or memory-store — use reply.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description:
              "Exact instructions for the worker / peer run. If the user gave an if/then condition, keep THAT condition verbatim — do not reuse older conditions from chat.",
          },
          ack: {
            type: "string",
            description:
              "One short real status sentence for the user. No meta commentary, no angle-bracket placeholders.",
          },
        },
        required: ["goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_run_status",
      description:
        "Look up whether this agent currently has a running, waiting, or pending computer task. Use before answering status questions. Does not start the browser.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_peer_agents",
      description:
        "List peer agent names this agent can message_agent (managedAgents). Use when the user asks who they can fan-out to. Does not start the browser.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_list",
      description:
        "List Composio apps enabled for this agent and which ones the user has connected. Use before composio_execute. Does not start the browser.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_search",
      description:
        "Search Composio tools for this agent’s enabled apps (e.g. query \"send email\" or \"create issue\"). Returns tool slugs to pass to composio_execute. Prefer this over guessing GMAIL_* / SLACK_* names.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What the user wants to do, in plain English",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_connect",
      description:
        "Start Composio OAuth for one app enabled on this agent. Returns redirectUrl — paste that URL in your reply so the user can click it. After they authorize, call composio_wait then retry.",
      parameters: {
        type: "object",
        properties: {
          toolkit: {
            type: "string",
            description: "Composio toolkit slug from the agent’s enabled apps",
          },
        },
        required: ["toolkit"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_wait",
      description:
        "Poll until a toolkit finishes OAuth (ACTIVE). Call after the user opens the connect link or says they connected. Then retry composio_execute.",
      parameters: {
        type: "object",
        properties: {
          toolkit: {
            type: "string",
            description: "Toolkit slug to wait for (e.g. gmail)",
          },
        },
        required: ["toolkit"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_execute",
      description:
        "Run one Composio tool for a connected app enabled on this agent. Prefer composio_search first for the tool slug. If not connected, use composio_connect then composio_wait.",
      parameters: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Composio tool slug from composio_search, e.g. GMAIL_SEND_EMAIL",
          },
          arguments: {
            type: "object",
            description: "Arguments object for the tool (provider-specific fields).",
          },
        },
        required: ["tool"],
      },
    },
  },
];

/** Max model↔tool rounds in one Auto message (lookups + final reply/queue). */
export const AUTO_CHAT_MAX_TOOL_ROUNDS = 6;

/**
 * @param {{ onProgress?: (step: { id: string, label: string, pct: number }) => void }} [opts]
 * @returns {{
 *   markFirstToken: () => void,
 *   hasFirstToken: () => boolean,
 *   markDecision: (action: string) => void,
 *   addLookup: (name: string) => void,
 *   getLookups: () => string[],
 *   setPath: (path: string) => void,
 *   setToolRounds: (n: number) => void,
 *   emitProgress: (label: string, pct: number, id?: string) => void,
 *   wrapOnDelta: (onDelta?: (chunk: string) => void) => ((chunk: string) => void)|undefined,
 *   finish: (extra?: object) => object,
 * }}
 */
export function createAutoTimingTracker(opts = {}) {
  const t0 = Date.now();
  /** @type {number|null} */
  let firstTokenMs = null;
  /** @type {number|null} */
  let decisionMs = null;
  /** @type {number|null} */
  let prepMs = null;
  /** @type {string|null} */
  let decisionAction = null;
  /** @type {string[]} */
  const lookups = [];
  let toolRounds = 0;
  let path = "unknown";
  let progressPct = 0;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

  /**
   * @param {string} name
   * @returns {string}
   */
  function labelForLookup(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("composio_search")) return "Searching app tools…";
    if (n.includes("composio_execute")) return "Running connected app…";
    if (n.includes("composio_connect")) return "Opening connect link…";
    if (n.includes("composio_wait")) return "Waiting for connection…";
    if (n.includes("composio_list")) return "Checking app status…";
    if (n.startsWith("composio")) return "Working with Composio…";
    return "Working…";
  }

  /**
   * Why: never let the bar jump backwards when emitProgress and addLookup interleave.
   * @param {string} label
   * @param {number} pct
   * @param {string} [id]
   */
  function pushProgress(label, pct, id = "composio") {
    if (!onProgress) return;
    const next = Math.max(progressPct, Math.max(0, Math.min(100, Number(pct) || 0)));
    progressPct = next;
    onProgress({
      id: String(id || "composio"),
      label: String(label || "Working…"),
      pct: next,
    });
  }

  return {
    markFirstToken() {
      if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
    },
    /**
     * Call after prepareChatPromptContext so the chip can show prep vs model time.
     */
    markPrepDone() {
      if (prepMs == null) prepMs = Date.now() - t0;
    },
    markDecision(action) {
      if (decisionMs == null) {
        decisionMs = Date.now() - t0;
        decisionAction = String(action || "");
      }
    },
    addLookup(name) {
      const key = String(name || "lookup");
      lookups.push(key);
      if (/^composio/i.test(key)) {
        const n = lookups.filter((l) => /^composio/i.test(l)).length;
        pushProgress(labelForLookup(key), Math.min(92, 18 + n * 22));
      }
    },
    getLookups() {
      return lookups.slice();
    },
    setPath(p) {
      path = String(p || path);
    },
    setToolRounds(n) {
      toolRounds = Math.max(0, Number(n) || 0);
    },
    emitProgress(label, pct, id = "composio") {
      pushProgress(label, pct, id);
    },
    wrapOnDelta(onDelta) {
      if (typeof onDelta !== "function") return undefined;
      return (chunk) => {
        if (String(chunk || "").length) this.markFirstToken();
        onDelta(chunk);
      };
    },
    /**
     * @returns {boolean}
     */
    hasFirstToken() {
      return firstTokenMs != null;
    },
    finish(extra = {}) {
      const totalMs = Date.now() - t0;
      return {
        totalMs,
        firstTokenMs,
        prepMs,
        decisionMs,
        decisionAction,
        toolRounds,
        lookupCount: lookups.length,
        lookups: lookups.slice(0, 8),
        path,
        ...extra,
      };
    },
  };
}

/**
 * Human-readable one-liner for ops icons / logs.
 * @param {object|null|undefined} timing
 * @returns {string}
 */
export function formatAutoTimingSummary(timing) {
  if (!timing || typeof timing !== "object") return "";
  const total = Number(timing.totalMs);
  if (!Number.isFinite(total)) return "";
  const parts = [`${(total / 1000).toFixed(2)}s total`];
  if (timing.firstTokenMs != null) {
    parts.push(`first token ${(Number(timing.firstTokenMs) / 1000).toFixed(2)}s`);
  }
  if (timing.prepMs != null) {
    parts.push(`prep ${(Number(timing.prepMs) / 1000).toFixed(2)}s`);
  }
  if (timing.decisionMs != null) {
    parts.push(`decision ${(Number(timing.decisionMs) / 1000).toFixed(2)}s`);
  }
  if (timing.toolRounds) parts.push(`${timing.toolRounds} tool round(s)`);
  if (timing.lookupCount) parts.push(`${timing.lookupCount} lookup(s)`);
  if (timing.path) parts.push(String(timing.path));
  return parts.join(" · ");
}

/**
 * @param {string} rawArgs
 * @returns {object}
 */
function parseToolArgs(rawArgs) {
  let s = String(rawArgs || "").trim();
  if (!s) return {};
  // Why: some providers emit single quotes, trailing commas, or unquoted keys.
  const quoteKeys = (input) =>
    String(input || "").replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  const attempts = [
    s,
    s.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/'/g, '"'),
    s.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"'),
    quoteKeys(s),
    quoteKeys(s.replace(/,\s*([}\]])/g, "$1")),
    quoteKeys(s.replace(/'/g, '"')),
    quoteKeys(s.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"')),
  ];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try next */
    }
  }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    for (const candidate of [
      m[0],
      m[0].replace(/,\s*([}\]])/g, "$1"),
      m[0].replace(/'/g, '"'),
      quoteKeys(m[0].replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"')),
    ]) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        /* continue */
      }
    }
  }
  // Why: bare string args sometimes arrive without JSON wrapping.
  if (!s.startsWith("{") && !s.startsWith("[")) {
    return { content: s, goal: s };
  }
  return {};
}

/**
 * Detects when the model echoed angle-bracket prompt placeholders instead of filling them in.
 * Why: models often copy `ack: <optional one short sentence…>` literally into chat.
 * @param {string} text
 * @returns {boolean}
 */
export function isPromptPlaceholder(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/^\.{1,5}$/.test(s) || /^…+$/.test(s)) return true;
  if (/^<[^>\n]{2,120}>$/i.test(s)) return true;
  if (
    /optional one short sentence|exact instructions for the worker|plain prose for the user|^<one sentence>$/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

/**
 * True when text looks like a real user-facing answer (draft, list, explanation) — not an ack dump.
 * Why: long multi-sentence drafts were wiped by the deliberation filter.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSubstantiveUserReply(text) {
  const s = String(text || "").trim();
  if (s.length < 60) return false;
  if (
    /^(subject\s*:|dear\s+\w|hi\s+\w|hello\s+\w|to\s*:|from\s*:|here(?:'|’)s (a |the )?(draft|email|message)|draft email|email draft)/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(subject\s*:|best regards|sincerely|kind regards)\b/i.test(s)) return true;
  // Multi-line body without planning meta → keep (email drafts, bullet answers).
  const lines = s.split(/\n/).filter((l) => l.trim().length > 0);
  if (lines.length >= 3 && !/should we be rude|we can say|one short real status|meta commentary/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Take user-facing prose after the last protocol REPLY/ANSWER marker.
 * Why: models often dump scratchpad then glue “….REPLY\nYes…” — line-1-only parsers leak the notes.
 * @param {string} raw
 * @returns {string|null} Body after marker, or null when no protocol marker found.
 */
export function extractAfterLastReplyMarker(raw) {
  const s = String(raw || "");
  if (!s.trim()) return null;
  // Protocol token: start of string/line, or glued after punctuation (e.g. "sentence.REPLY\n…").
  // Why: skip prose like “Output REPLY with …” — that REPLY is not followed by end-of-line.
  const re = /(?:^|[\r\n]|[.!?])\s*(REPLY|ANSWER)\s*(?:\r?\n|$)/gi;
  let last = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    last = m;
  }
  if (!last) return null;
  const after = s.slice(last.index + last[0].length).trim();
  return after || null;
}

/**
 * Strip protocol headers / tool-call junk / leaked placeholders from user-visible reply text.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeAutoReplyContent(text) {
  let s = stripModelThinking(String(text || "")).trim();
  if (!s) return "";
  // Why: prefer body after mid-text REPLY before other cleanup — drops leaked capability-Q scratchpads.
  const afterMarker = extractAfterLastReplyMarker(s);
  if (afterMarker != null) s = afterMarker;
  s = s
    .replace(/^REPLY\s*\n+/i, "")
    .replace(/^ANSWER\s*\n+/i, "")
    .replace(/^QUEUE_GOAL\s*\n+/i, "")
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/<\/?tool_call>/gi, "")
    .replace(/<\/?function_call>/gi, "")
    .trim();
  // Drop accidental goal:/ack: labels left in a reply body.
  if (/^goal:\s*/i.test(s) && /\nack:\s*/i.test(s)) {
    return "";
  }
  if (isPromptPlaceholder(s)) return "";
  // Why: never strip email drafts / multi-line answers as “planning notes”.
  if (looksLikeSubstantiveUserReply(s)) {
    return s
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();
  }
  // Why: models often dump planning notes then the real ack in quotes — keep only the ack.
  if (looksLikeAutoDeliberation(s)) {
    const extracted = extractQuotedOrFinalAck(s);
    if (extracted) return extracted;
    // Why: never keep scratchpad just because it is long — empty is better than leaking notes.
    return "";
  }
  // Why: models append meta like: "On it." Short one sentence. Rude but okay.
  s = s
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(
      /\s*(Short one sentence|Rude but okay|optional short status|one short sentence|That's (neutral|fine)\.?)[^.]*\.?\s*$/gi,
      ""
    )
    .trim();
  if (looksLikeAutoDeliberation(s)) {
    if (looksLikeSubstantiveUserReply(s)) return s;
    return extractQuotedOrFinalAck(s);
  }
  return s;
}

/**
 * True when the model wrote planning notes instead of the user-facing sentence.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeAutoDeliberation(text) {
  const s = String(text || "").trim();
  if (s.length < 40) return false;
  // Why: drafts/explanations are long on purpose — never classify them as scratchpad.
  if (looksLikeSubstantiveUserReply(s)) return false;
  const hit =
    /should we be rude|user profile empty|meta commentary|we can say|that's (neutral|fine)|one short real status|optional short|output format|output reply|could be ["'“]|the ack is|do not invent tone|authoritative from USER|tone\?|don't invent|do not invent|planning|let's see|i need to|we need (an? )?answer|the user (wants|asked|said)|capability question|per instructions|don'?t queue|do not queue|no specific site|reply directly|queue_goal|as the assistant|in the (prompt|system)/i.test(
      s
    );
  if (hit) {
    return s.split(/[.!?\n]/).filter((p) => p.trim().length > 8).length >= 2 || s.includes('"') || s.length > 120;
  }
  // Why: only treat long freeform as scratchpad when it has planning cues — not every email draft.
  return false;
}

/**
 * User asked to write/draft/summarize from chat — never fall back to the generic “I am here” line.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeWriteFromContextRequest(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return /\b(draft|write|compose|prepare|make)\b.+\b(email|mail|message|letter|note|reply|reminder)\b|\b(email|mail)\b.+\b(draft|remind|expiration|expir)\b|\b(summarize|summary|list (them|the emails|above)|only email)\b/i.test(
    s
  );
}

/**
 * User asked to actually send mail via agent SMTP (not draft, not Composio Gmail).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSendEmailRequest(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  // Why: “Did you send the email?” is status Q&A — not a new SMTP send job.
  if (
    /\b(did you|have you|was (the |it )?|were (the |they )?)\s*(already\s+)?(send|sent|email(ed)?)\b/i.test(
      s
    ) ||
    /\b(send|sent)\b.+\?\s*$/i.test(s)
  ) {
    return false;
  }
  // Why: “Send email using composio” must use Gmail API tools, not agent SMTP harden.
  if (/\bcomposio\b/i.test(s) || looksLikeComposioAppRequest(s)) return false;
  if (looksLikeWriteFromContextRequest(s) && !/\bsend\b/i.test(s)) return false;
  return (
    /\bsend\b.+\b(them|these|those|the|above)?\s*(the\s+)?(emails?|mails?|reminders?)\b/i.test(s) ||
    /\b(email|mail)\s+(them|these|those|everyone|all)\b/i.test(s) ||
    /\bsend\b.+\b(reminder|expiration|expiry)\b.+\b(email|mail)\b/i.test(s) ||
    /\bsend\b.+\b(email|mail)\b.+\b(to|them|these|those|recipients?)\b/i.test(s) ||
    /^send\s+(them|it|the\s+emails?)\b/i.test(s)
  );
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmailsFromText(text) {
  const found = String(text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const out = [];
  const seen = new Set();
  for (const raw of found) {
    const e = String(raw || "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * Pull the latest draft (Subject + body) from packed chat context if present.
 * @param {string} chatContext
 * @returns {{ subject: string, body: string, toLine: string }}
 */
export function extractEmailDraftFromChatContext(chatContext) {
  const blob = String(chatContext || "");
  if (!blob.trim()) return { subject: "", body: "", toLine: "" };
  // Prefer the last ASSISTANT block that looks like a draft.
  const chunks = blob.split(/(?=^(?:USER|ASSISTANT|AGENT|SYSTEM):)/im);
  let subject = "";
  let body = "";
  let toLine = "";
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const chunk = String(chunks[i] || "");
    if (!/^ASSISTANT:/i.test(chunk.trim())) continue;
    const text = chunk.replace(/^ASSISTANT:\s*/i, "").trim();
    if (!/\bsubject\s*:/i.test(text) && !/\bdear\s+/i.test(text) && !/\bbest regards\b/i.test(text)) {
      continue;
    }
    const toM = text.match(/\bto\s*:\s*([^\n]+)/i);
    if (toM) toLine = String(toM[1] || "").trim();
    const subM = text.match(/\bsubject\s*:\s*([^\n]+)/i);
    if (subM) subject = String(subM[1] || "").trim();
    let rest = text;
    if (subM) {
      rest = text.slice(text.toLowerCase().indexOf("subject:") + subM[0].length).trim();
    }
    rest = rest.replace(/^\s*to\s*:[^\n]*\n?/i, "").trim();
    body = rest.slice(0, 4000);
    break;
  }
  return { subject, body, toLine };
}

/**
 * Build a worker goal that forces send_email and never navigates to mangled address-URLs.
 * @param {{
 *   userText?: string,
 *   chatContext?: string,
 *   fromAddress?: string,
 * }} opts
 * @returns {{ ok: true, goal: string, ack: string, recipients: string[] } | { ok: false, reason: string }}
 */
export function buildSendEmailGoalFromContext(opts = {}) {
  const userText = String(opts.userText || "").trim();
  const chatContext = String(opts.chatContext || "").trim();
  const fromAddress = String(opts.fromAddress || "").trim().toLowerCase();
  const draft = extractEmailDraftFromChatContext(chatContext);
  const recipients = [
    ...extractEmailsFromText(draft.toLine),
    ...extractEmailsFromText(chatContext),
    ...extractEmailsFromText(userText),
  ].filter((e) => e && e !== fromAddress);
  const uniq = [...new Set(recipients)];
  if (!uniq.length) {
    return { ok: false, reason: "no_recipients" };
  }
  const subject =
    draft.subject ||
    "Reminder: Your trial is expiring soon";
  const body =
    draft.body ||
    [
      "Hello,",
      "",
      "This is a friendly reminder that your trial subscription is approaching its expiration date.",
      "Please review your account and select a suitable plan if you would like to continue without interruption.",
      "",
      "Best regards",
    ].join("\n");
  const recipientLines = uniq.map((e) => `- ${e}`).join("\n");
  const goal = [
    "Send outbound email using the send_email action ONLY (agent SMTP EMAIL IDENTITY).",
    "Do NOT open a browser, do NOT navigate, and do NOT turn any email address into a website URL.",
    "Never call navigate/open_tab for recipient addresses.",
    "",
    `Recipients (one send_email per address):`,
    recipientLines,
    "",
    `Subject: ${subject}`,
    "",
    "Body:",
    body,
    "",
    "After all sends succeed, finish with a short summary of who received the email.",
  ].join("\n");
  const ack =
    uniq.length === 1
      ? `On it — sending the email to ${uniq[0]} now.`
      : `On it — sending the email to ${uniq.length} recipients now.`;
  return { ok: true, goal, ack, recipients: uniq };
}

/**
 * True when a navigate URL looks like a mangled email local-part (e.g. alex.parker.demo from an address).
 * @param {string} url
 * @param {string} [goalText]
 * @returns {boolean}
 */
export function looksLikeMangledEmailNavigateUrl(url, goalText = "") {
  let host = "";
  try {
    host = new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host || host.includes(" ")) return false;
  const emails = extractEmailsFromText(goalText);
  for (const email of emails) {
    const local = email.split("@")[0] || "";
    if (local.length >= 5 && (host === local || host.startsWith(`${local}.`))) return true;
  }
  // Hostname that is only dotted labels with no common public suffix used as a real site here.
  if (/^(?:[a-z0-9-]+\.){2,}[a-z0-9-]+$/i.test(host) && emails.length && /send_email|recipients?/i.test(goalText)) {
    return true;
  }
  return false;
}

/**
 * Pull the intended user-facing ack/reply out of a planning dump.
 * @param {string} text
 * @returns {string}
 */
export function extractQuotedOrFinalAck(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  const afterMarker = extractAfterLastReplyMarker(s);
  if (afterMarker && !looksLikeAutoDeliberation(afterMarker)) {
    return afterMarker.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  }
  const quotes = [...s.matchAll(/["“]([^"”]{8,160})["”]/g)].map((m) => String(m[1] || "").trim());
  const good = quotes.filter(
    (q) =>
      !/meta|profile|should we|we can say|output format|one short real status|capability question/i.test(q) &&
      !isPromptPlaceholder(q)
  );
  if (good.length) return good[good.length - 1];
  const lines = s
    .split(/\n+/)
    .map((l) => l.replace(/^ack:\s*/i, "").replace(/^["'“”]+|["'“”]+$/g, "").trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (
      /^(on it|checking|starting|opening|looking|working|got it|okay|ok|yes[, ]|sure[, ])\b/i.test(line) &&
      line.length <= 220 &&
      !looksLikeAutoDeliberation(line)
    ) {
      return line;
    }
  }
  return "";
}

/**
 * True when the model goal still reflects the user's if-condition (not an older chat rule).
 * @param {string} userText
 * @param {string} goal
 * @returns {boolean}
 */
export function userConditionReflectedInGoal(userText, goal) {
  const u = String(userText || "");
  const g = String(goal || "").toLowerCase();
  if (!/\bif\b/i.test(u)) return true;
  const clause = (u.match(/\bif\b([\s\S]+?)(?:\.|$)/i) || [])[1] || u;
  const tokens = String(clause)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !/^(than|then|with|from|this|that|have|more|less)$/i.test(t));
  if (!tokens.length) return true;
  const hits = tokens.filter((t) => g.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

/**
 * True when the user asked for a LIVE browser/CRM job (not Composio-only, not chat Q&A).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeLiveComputerJobRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (looksLikeComposioAppRequest(t)) return false;
  if (looksLikeMemoryStoreRequest(t)) return false;
  if (looksLikeMemoryForgetRequest(t)) return false;
  if (looksLikeSessionScratchRequest(t)) return false;
  if (looksLikeDayHistoryOrStatusRequest(t)) return false;
  if (looksLikeVagueChatFollowup(t)) return false;
  const lower = t.toLowerCase();
  if (
    /\b(create|register|sign\s*up|open|log\s*in|navigate|go to|visit|fill|submit|click)\b/i.test(
      lower
    ) &&
    /\b(crm|vughy|account|agency|admin|website|site|page|form|browser)\b/i.test(lower)
  ) {
    return true;
  }
  const c = classifyMessageIntent(t, {});
  return (
    c.intent === "goal" &&
    (c.reason === "has_url_or_domain" ||
      c.reason === "explicit_task" ||
      c.reason === "question_shaped_but_actionable")
  );
}

/**
 * True when the model only promised to start work (“On it — creating…”) without a result.
 * Why: after tool exhaustion the LLM often REPLY-acks instead of queue_goal — no task is created.
 * @param {string} content
 * @returns {boolean}
 */
export function looksLikePromiseOnlyComputerAck(content) {
  const t = String(content || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 320) return false;
  if (/\b(done|created|registered|here(?:'s| is)|credentials\s*:|username\s*:|password\s*(is|:))\b/i.test(t)) {
    return false;
  }
  if (
    /^(on it|starting|working on (it|this|that)|got it|sure|okay|ok)\b/i.test(t) &&
    /\b(creat|register|open|check|run|brows|comput|account|crm|vughy|now|process)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(creating|registering|starting the (process|computer|browser)|will (create|register|open|start))\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Default short ack when Auto queues a computer goal without one.
 * @param {string} goal
 * @param {string} [agentName]
 * @returns {string}
 */
export function defaultQueueAck(goal, agentName = "Agent") {
  const g = String(goal || "").replace(/\s+/g, " ").trim();
  const preview = g.length > 90 ? `${g.slice(0, 87)}…` : g;
  const who = String(agentName || "Agent").trim() || "Agent";
  // Why: peer-delegation goals must not sound like this agent is browsing.
  if (
    /\[PEER FANOUT/i.test(g) ||
    /\bYou must call message_agent\b/i.test(g) ||
    /\b(tell|ask|message)\b[\s\S]{0,80}\b(agent|peer)\b[\s\S]{0,40}\b(to|that)\b/i.test(g)
  ) {
    return preview
      ? `Asking a peer agent to handle this (their computer, not ${who}’s): ${preview}`
      : `Asking a peer agent to handle this — their computer, not ${who}’s.`;
  }
  if (!preview) return `Starting ${who}’s computer now.`;
  return `Starting ${who}’s computer: ${preview}`;
}

/**
 * Runtime validation after model proposes reply/queue_goal.
 * Why: never trust empty goals, leaked headers, or unknown actions.
 * @param {{ action?: string, content?: string, goal?: string, ack?: string, reason?: string, timing?: object }} result
 * @param {{
 *   userText?: string,
 *   agentName?: string,
 *   chatContext?: string,
 *   emailConfigured?: boolean,
 *   fromAddress?: string,
 * }} [ctx]
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string, timing?: object }}
 */
export function ensureAutoTurnResult(result, ctx = {}) {
  const userText = String(ctx.userText || "").trim();
  const agentName = String(ctx.agentName || "Agent").trim() || "Agent";
  const chatContext = String(ctx.chatContext || "").trim();
  const emailConfigured = Boolean(ctx.emailConfigured);
  const fromAddress = String(ctx.fromAddress || "").trim();
  const reason = String(result?.reason || "normalized").trim() || "normalized";
  let action =
    result?.action === "queue_goal" || result?.action === "goal" || result?.action === "run"
      ? "queue_goal"
      : "reply";

  let content = sanitizeAutoReplyContent(result?.content || "");
  let goal = String(result?.goal || "").replace(/\s+/g, " ").trim();
  let ack = sanitizeAutoReplyContent(result?.ack || "");
  // Why: never queue literal template text like "<exact instructions for the worker>" or "...".
  if (isPromptPlaceholder(goal) || goal.length < 8) goal = "";

  // Why: "send them the emails" must become a concrete send_email goal — never browse mangled addresses.
  // Skip when the user asked for Composio/Gmail API (SMTP harden must not hijack that path).
  if (looksLikeSendEmailRequest(userText) && !looksLikeComposioAppRequest(userText)) {
    if (!emailConfigured) {
      return {
        action: "reply",
        content:
          "Agent SMTP is off or incomplete. Open Agents → Edit → Email (SMTP), turn on “Enable agent SMTP”, fill host/from/password, and Save — or say “send using composio” if Gmail is connected.",
        goal: "",
        ack: "",
        reason: `${reason}_send_email_smtp_missing`,
        timing: result?.timing,
      };
    }
    const built = buildSendEmailGoalFromContext({ userText, chatContext, fromAddress });
    if (!built.ok) {
      return {
        action: "reply",
        content:
          "I don’t see recipient email addresses in this chat yet. Paste the addresses (or run the list again), then ask me to send.",
        goal: "",
        ack: "",
        reason: `${reason}_send_email_no_recipients`,
        timing: result?.timing,
      };
    }
    return {
      action: "queue_goal",
      content: built.ack,
      goal: built.goal,
      ack: built.ack,
      reason: `${reason}_send_email_hardened`,
      timing: result?.timing,
    };
  }

  // Why: teach-prefs / forget with URLs must never become a Chromium goal — even if the model mis-queues.
  if (
    action === "queue_goal" &&
    (looksLikeMemoryStoreRequest(userText) ||
      looksLikeMemoryForgetRequest(userText) ||
      looksLikeSessionScratchRequest(userText))
  ) {
    return {
      action: "reply",
      content:
        content ||
        (looksLikeMemoryForgetRequest(userText)
          ? "Got it — I’ll forget that. No computer run started."
          : looksLikeSessionScratchRequest(userText)
            ? "Got it — noted for this chat only. No computer run started."
            : "Got it — I’ll remember those preferences for this agent. No computer run started."),
      goal: "",
      ack: "",
      reason: `${reason}_memory_store_forced_reply`,
      timing: result?.timing,
    };
  }

  // Why: Gmail/Slack/… via Composio must never start Playwright — unless this is clearly a CRM/register live job.
  if (
    action === "queue_goal" &&
    looksLikeComposioAppRequest(userText) &&
    !looksLikeLiveComputerJobRequest(userText)
  ) {
    return {
      action: "reply",
      content:
        content ||
        "That uses your connected Composio apps (not the cloud browser). Ask again in Auto — I’ll search/execute the app tools instead of starting the computer.",
      goal: "",
      ack: "",
      reason: `${reason}_composio_forced_reply`,
      timing: result?.timing,
    };
  }

  // Why: "what we did today" / vague "what" must never become a browser goal from chat context.
  if (
    action === "queue_goal" &&
    (looksLikeDayHistoryOrStatusRequest(userText) || looksLikeVagueChatFollowup(userText))
  ) {
    return {
      action: "reply",
      content:
        content ||
        "I can summarize from day history in chat — no computer run. Ask again if the answer was empty.",
      goal: "",
      ack: "",
      reason: `${reason}_day_history_forced_reply`,
      timing: result?.timing,
    };
  }

  if (action === "queue_goal") {
    if (!goal) goal = userText;
    // Why: Auto often reinjects older if-rules from chat (e.g. days_left < 15) when the user
    // changed the condition — pin the ACTIVE USER MESSAGE so the worker evaluates THIS request.
    if (userText && /\bif\b/i.test(userText) && !userConditionReflectedInGoal(userText, goal)) {
      goal = `${goal}\n\nACTIVE USER MESSAGE (follow THIS condition exactly; ignore older if-rules from chat or SITE MEMORY):\n${userText}`;
    } else if (userText && goal === userText) {
      // ok
    } else if (userText && /\bif\b/i.test(userText) && !/\bACTIVE USER MESSAGE\b/i.test(goal)) {
      goal = `${goal}\n\nACTIVE USER MESSAGE (authoritative conditions):\n${userText}`;
    }
    if (!goal) {
      // Cannot queue without instructions — fall back to a safe chat reply.
      return {
        action: "reply",
        content:
          content ||
          "I need a clearer computer goal (what site or peer work should I run?).",
        goal: "",
        ack: "",
        reason: `${reason}_empty_goal_to_reply`,
        timing: result?.timing,
      };
    }
    if (!ack) ack = defaultQueueAck(goal, agentName);
    // Why: never show planning dumps as the queue ack bubble.
    if (looksLikeAutoDeliberation(ack) || !ack) {
      ack = defaultQueueAck(goal, agentName);
    }
    return {
      action: "queue_goal",
      content: ack,
      goal,
      ack,
      reason,
      timing: result?.timing,
    };
  }

  if (!content) {
    // Empty reply — if the user clearly needed the computer, queue instead.
    if (userText && autoTurnHeuristicGate(userText) === "queue_goal") {
      const g = userText;
      const a = defaultQueueAck(g, agentName);
      return {
        action: "queue_goal",
        content: a,
        goal: g,
        ack: a,
        reason: `${reason}_empty_reply_to_queue`,
        timing: result?.timing,
      };
    }
    // Why: draft/write follow-ups must not collapse to the generic greeting placeholder.
    if (looksLikeWriteFromContextRequest(userText)) {
      content =
        "I could not draft that from chat context. Please try again, or paste the emails/details to include.";
    } else {
      content =
        "I am here. Ask a question, or send a computer goal (open a site, ask peers, etc.).";
    }
  }

  // Why: model REPLY’d “On it — creating…” after tool exhaustion — no Task was created.
  if (
    action === "reply" &&
    userText &&
    looksLikeLiveComputerJobRequest(userText) &&
    looksLikePromiseOnlyComputerAck(content)
  ) {
    const g = userText;
    const a = content || defaultQueueAck(g, agentName);
    return {
      action: "queue_goal",
      content: a,
      goal: g,
      ack: a,
      reason: `${reason}_promise_ack_to_queue`,
      timing: result?.timing,
    };
  }

  return {
    action: "reply",
    content,
    goal: "",
    ack: "",
    reason,
    timing: result?.timing,
  };
}

/**
 * Last-resort parse when the model returns junk / mixed formats.
 * @param {string} raw
 * @param {string} userText
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string }}
 */
export function recoverMalformedAutoOutput(raw, userText = "") {
  const cleaned = stripModelThinking(String(raw || "")).trim();
  const user = String(userText || "").trim();

  if (!cleaned) {
    if (user && autoTurnHeuristicGate(user) === "queue_goal") {
      return { action: "queue_goal", content: "", goal: user, ack: "" };
    }
    return { action: "reply", content: "", goal: "", ack: "" };
  }

  // Tool-call XML / JSON-ish name fields
  if (/queue_goal|QUEUE_GOAL|"action"\s*:\s*"queue/i.test(cleaned)) {
    const goalMatch =
      cleaned.match(/"goal"\s*:\s*"([^"]+)"/i) ||
      cleaned.match(/goal:\s*(.+)$/im);
    const ackMatch =
      cleaned.match(/"ack"\s*:\s*"([^"]+)"/i) ||
      cleaned.match(/ack:\s*(.+)$/im);
    const goal = String(goalMatch?.[1] || user || "").trim();
    const ack = String(ackMatch?.[1] || "").trim();
    if (goal) return { action: "queue_goal", content: ack, goal, ack };
  }

  if (/"name"\s*:\s*"reply"|REPLY\b|ANSWER\b/i.test(cleaned)) {
    const contentMatch =
      cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/i) ||
      cleaned.match(/^REPLY\s*\n+([\s\S]+)/i);
    let content = contentMatch ? contentMatch[1] : null;
    if (!content) {
      content = extractAfterLastReplyMarker(cleaned) || cleaned;
    }
    try {
      content = JSON.parse(`"${content}"`);
    } catch {
      content = sanitizeAutoReplyContent(content);
    }
    return {
      action: "reply",
      content: sanitizeAutoReplyContent(content) || sanitizeAutoReplyContent(cleaned),
      goal: "",
      ack: "",
    };
  }

  if (user && autoTurnHeuristicGate(user) === "queue_goal") {
    return { action: "queue_goal", content: "", goal: user, ack: "" };
  }

  return {
    action: "reply",
    content: sanitizeAutoReplyContent(cleaned),
    goal: "",
    ack: "",
  };
}

/**
 * Map native tool_calls into Auto turn result (terminal tools only).
 * @param {{ id: string, name: string, arguments: string }[]} toolCalls
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string }|null}
 */
export function parseAutoToolCalls(toolCalls) {
  const list = Array.isArray(toolCalls) ? toolCalls : [];
  for (const tc of list) {
    const name = String(tc?.name || "")
      .trim()
      .toLowerCase();
    const args = parseToolArgs(tc?.arguments);
    if (name === "queue_goal" || name === "queuegoal" || name === "run_goal") {
      const goal = String(args.goal || args.task || args.content || "").trim();
      const ack = String(args.ack || args.note || "").trim();
      if (!goal && !ack) continue;
      return {
        action: "queue_goal",
        content: ack,
        goal: goal || ack,
        ack,
      };
    }
    if (name === "reply" || name === "answer" || name === "chat_reply") {
      const content = String(args.content || args.reply || args.message || "").trim();
      if (!content) continue;
      return { action: "reply", content, goal: "", ack: "" };
    }
  }
  return null;
}

/**
 * True when the model printed a fake worker-style ACTION: composio_*() line.
 * @param {string} content
 * @returns {boolean}
 */
export function looksLikeFakeComposioActionText(content) {
  const t = String(content || "");
  return (
    /ACTION\s*:\s*composio_\w+\s*\(/i.test(t) || looksLikeFakeInboxActionText(t)
  );
}

/**
 * Extract args inside the first balanced `(…)` after `from` (handles nested JSON).
 * Why: naive [^)]* truncates ACTION: composio_execute(tool=X, arguments={…}).
 * @param {string} raw
 * @param {number} from
 * @returns {{ args: string, end: number }|null}
 */
function extractBalancedParenArgs(raw, from) {
  const s = String(raw || "");
  const open = s.indexOf("(", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { args: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Parse fake ACTION: composio_list() / composio_search(query="…") lines into lookup specs.
 * @param {string} content
 * @returns {{ kind: string, args: object }[]}
 */
export function parseFakeComposioActionText(content) {
  const raw = String(content || "");
  /** @type {{ kind: string, args: object }[]} */
  const out = [];
  const headRe = /ACTION\s*:\s*(composio_\w+)\s*/gi;
  let m;
  while ((m = headRe.exec(raw)) !== null) {
    const name = String(m[1] || "").trim().toLowerCase();
    const kind = classifyAutoToolName({ name });
    if (
      kind !== "composio_list" &&
      kind !== "composio_search" &&
      kind !== "composio_connect" &&
      kind !== "composio_wait" &&
      kind !== "composio_execute"
    ) {
      continue;
    }
    const balanced = extractBalancedParenArgs(raw, m.index + m[0].length - 1);
    const argStr = String(balanced?.args || "").trim();
    if (balanced) headRe.lastIndex = Math.max(headRe.lastIndex, balanced.end);
    /** @type {Record<string, unknown>} */
    const args = {};
    if (argStr) {
      const jsonMatch = argStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[0]);
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            Object.assign(args, obj);
          }
        } catch {
          /* ignore */
        }
      }
      const q = argStr.match(/(?:query|q|search)\s*[=:]\s*["']?([^"',)]+)["']?/i);
      if (q && !args.query) args.query = q[1].trim();
      const tool = argStr.match(/(?:tool|slug|action)\s*[=:]\s*["']?([A-Za-z0-9_]+)["']?/i);
      if (tool && !args.tool) args.tool = tool[1].trim();
      const toolkit = argStr.match(/(?:toolkit|app)\s*[=:]\s*["']?([A-Za-z0-9_-]+)["']?/i);
      if (toolkit && !args.toolkit) args.toolkit = toolkit[1].trim();
      // Why: models put tool slug as first positional: composio_execute(GMAIL_FETCH_EMAILS, …)
      if (!args.tool && kind === "composio_execute") {
        const pos = argStr.match(/^\s*["']?([A-Z][A-Z0-9_]{3,})["']?\s*(?:,|$)/);
        if (pos) args.tool = pos[1].trim();
      }
    }
    // Why: bare composio_search() with no query — use the user text if we have it later.
    out.push({ kind, args });
  }
  return out;
}

/**
 * Strip leftover fake ACTION: composio_* lines from a user-visible reply.
 * Why: never show the old “send the same request once more” dead-end — empty means keep looping upstream.
 * @param {string} content
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitizeFakeComposioActionReply(content, fallback) {
  const raw = String(content || "").trim();
  if (!looksLikeFakeComposioActionText(raw) && !looksLikeFakeInboxActionText(raw)) {
    return raw;
  }
  // Strip balanced ACTION: composio_*(…) and ACTION: check_email(…) / navigate(…) spans.
  let cleaned = raw;
  const headRe =
    /ACTION\s*:\s*(?:composio_\w+|check_email|fetch_email|get_emails?|list_emails?|read_emails?|check_mail|fetch_mail|navigate|goto|open_url|click|type)\s*/gi;
  let m;
  const cuts = [];
  while ((m = headRe.exec(raw)) !== null) {
    const start = m.index;
    const balanced = extractBalancedParenArgs(raw, m.index + m[0].length - 1);
    const end = balanced ? balanced.end : Math.min(raw.length, start + m[0].length);
    cuts.push([start, end]);
    if (balanced) headRe.lastIndex = Math.max(headRe.lastIndex, end);
  }
  for (let i = cuts.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, cuts[i][0]) + cleaned.slice(cuts[i][1]);
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length >= 8) return cleaned;
  return String(fallback || "").trim();
}

/**
 * Deterministic Composio intent path (Gmail / Slack / Sheets starters).
 * Why: intent → known tool → compact result → reply; LLM is optional polish only.
 * @param {{
 *   runtime: object,
 *   userText: string,
 *   creds: object,
 *   onDelta?: (chunk: string) => void,
 *   track: ReturnType<typeof createAutoTimingTracker>,
 *   spec?: object|null,
 * }} opts
 */
export async function runDeterministicComposioIntentTurn(opts) {
  const { runtime, userText, creds, onDelta, track } = opts;

  // Why: LLM understands “check email and give me update” as one step; heuristics split on “and”.
  const { resolveComposioPlan } = await import("./composioLlmPlan.js");
  const multiPlan = await resolveComposioPlan(userText, creds);
  if (multiPlan.length >= 2 && runtime?.composioApiKey) {
    track.setPath("composio_multistep");
    track.emitProgress?.(`Multi-step (${multiPlan.length})…`, 10);
    track.addLookup("composio_execute");
    const multi = await runComposioMultiStep({
      runtime,
      userText,
      plan: multiPlan,
      executeLookup: executeAutoLookupTool,
      onProgress: (label, pct) => track.emitProgress?.(label, pct),
    });
    if (multi.needsConnect) track.addLookup("composio_connect");
    track.emitProgress?.(multi.ok ? "Finishing…" : "Need connection…", 95);
    let content = String(multi.content || "").trim();
    if (typeof onDelta === "function") onDelta(content);
    track.markDecision("reply");
    return {
      action: "reply",
      content,
      goal: "",
      ack: "",
      reason: multi.ok
        ? "composio_multistep"
        : multi.needsConnect
          ? "composio_multistep_connect"
          : "composio_multistep_error",
      timing: track.finish(),
    };
  }

  // Why: LLM may return a single planned intent (compound wording collapsed).
  const plannedSpec =
    multiPlan.length === 1 && multiPlan[0].kind === "intent" && multiPlan[0].specId
      ? COMPOSIO_INTENT_SPECS.find((s) => s.id === multiPlan[0].specId) || null
      : null;

  const spec = opts.spec || plannedSpec || matchComposioIntent(userText);
  if (!spec) {
    return {
      action: "reply",
      content: "I could not map that to a Composio app action.",
      goal: "",
      ack: "",
      reason: "composio_intent_unmatched",
      timing: track.finish(),
    };
  }
  track.emitProgress?.(`Working with ${spec.label}…`, 15);
  track.addLookup("composio_search");
  track.addLookup("composio_execute");
  track.setPath(`composio_${spec.id}_direct`);
  track.emitProgress?.(`Running ${spec.label}…`, 55);
  const ran = await runComposioIntentExecute({
    runtime,
    userText,
    spec,
    executeLookup: executeAutoLookupTool,
  });
  if (ran.needsConnect) {
    track.addLookup("composio_connect");
    track.emitProgress?.("Need app connection…", 85);
  } else {
    track.emitProgress?.("Finishing…", 95);
  }
  let content = String(ran.content || "").trim();

  const looksStructured =
    /^Top unread/i.test(content) ||
    /^Labeled /i.test(content) ||
    /^No emails matched/i.test(content) ||
    /^Posted to Slack/i.test(content) ||
    /^Google Sheet/i.test(content) ||
    /^Google Spreadsheets/i.test(content) ||
    /^No spreadsheets found/i.test(content) ||
    /Also emailed this list/i.test(content) ||
    /^\d+\.\s+/m.test(content) ||
    /^Connect /i.test(content) ||
    /^To (post|read|label)/i.test(content);
  if (!ran.ok && !ran.needsConnect && !looksStructured) {
    try {
      const polished = await llmChatCompletion({
        apiKey: creds.apiKey,
        baseUrl: creds.llmBaseUrl || "",
        model: creds.llmModel || "",
        openAiAccountId: creds.openAiAccountId,
        temperature: 0.2,
        maxTokens: 700,
        timeoutMs: 45_000,
        messages: [
          {
            role: "system",
            content:
              "Explain this Composio tool result in plain prose. Use ONLY the JSON. " +
              "Do not invent that an app is disconnected when the JSON shows success/data. No ACTION: lines.",
          },
          {
            role: "user",
            content:
              `User ask: ${String(userText || "").slice(0, 400)}\n\n` +
              `Intent: ${spec.id}\nTool: ${ran.tool || "unknown"}\n` +
              `Result JSON:\n${String(ran.resultText || "").slice(0, 3500)}`,
          },
        ],
      });
      const text = String(polished || "").trim();
      if (
        text.length >= 12 &&
        !looksLikeFakeComposioActionText(text) &&
        !looksLikeComposioStallReply(text) &&
        !/disconnected|not enabled/i.test(text)
      ) {
        content = text;
      }
    } catch (err) {
      console.warn("[auto] composio intent polish failed:", err?.message || err);
    }
  }

  if (typeof onDelta === "function") onDelta(content);
  track.markDecision("reply");
  return {
    action: "reply",
    content,
    goal: "",
    ack: "",
    reason: ran.ok
      ? `composio_${spec.id}_direct`
      : ran.needsConnect
        ? `composio_${spec.id}_connect`
        : `composio_${spec.id}_error`,
    timing: track.finish(),
  };
}

/** @deprecated use runDeterministicComposioIntentTurn */
export async function runDeterministicGmailUnreadTurn(opts) {
  return runDeterministicComposioIntentTurn({
    ...opts,
    spec: matchComposioIntent(opts.userText) || undefined,
  });
}

/**
 * True when the model “replied” with a stall / filler instead of a real Composio result summary.
 * Why: “Hold on while I pull the unread…” was returned as the final chat answer.
 * @param {string} content
 * @returns {boolean}
 */
export function looksLikeComposioStallReply(content) {
  const t = String(content || "").trim();
  if (!t) return true;
  const stall =
    /\b(hold on|one (sec|second|moment|minute)|dig through|pull(ing)? (the )?unread|let me (check|look|fetch|search|pull|dig)|working on (it|that)|i('ll| will) (check|look|search|fetch|pull|dig|get)|give me a (sec|moment)|fine[,!]?\s+i('ll| will))\b/i.test(
      t
    );
  if (!stall) return false;
  // Real inbox summaries usually list senders/subjects or say none found.
  if (
    t.length > 100 &&
    /\b(from:|subject:|sender:|no unread|0 unread|here (are|is)|top \d|1[\).]|•\s+\S)/i.test(t)
  ) {
    return false;
  }
  return true;
}

/**
 * @param {string[]} lookups
 * @returns {{ searched: boolean, executed: boolean, listed: boolean }}
 */
export function summarizeComposioLookups(lookups) {
  const L = (Array.isArray(lookups) ? lookups : []).map((x) => String(x || "").toLowerCase());
  return {
    listed: L.some((x) => x.includes("composio_list")),
    searched: L.some((x) => x.includes("composio_search") || x.includes("composio_list")),
    executed: L.some((x) => x.includes("composio_execute")),
  };
}

/**
 * Classify the first tool call in a batch.
 * @param {{ id: string, name: string, arguments: string }} tc
 * @returns {"reply"|"queue_goal"|"check_run_status"|"list_peer_agents"|"composio_list"|"composio_search"|"composio_connect"|"composio_wait"|"composio_execute"|"unknown"}
 */
export function classifyAutoToolName(tc) {
  const name = String(tc?.name || "")
    .trim()
    .toLowerCase();
  if (name === "reply" || name === "answer" || name === "chat_reply") return "reply";
  if (name === "queue_goal" || name === "queuegoal" || name === "run_goal") return "queue_goal";
  if (name === "check_run_status" || name === "run_status" || name === "status") {
    return "check_run_status";
  }
  if (name === "list_peer_agents" || name === "list_peers" || name === "peers") {
    return "list_peer_agents";
  }
  if (name === "composio_list" || name === "composio_status") return "composio_list";
  if (name === "composio_search" || name === "composio_find_tools") return "composio_search";
  if (name === "composio_connect" || name === "composio_authorize") return "composio_connect";
  if (name === "composio_wait" || name === "composio_wait_connect") return "composio_wait";
  if (name === "composio_execute" || name === "composio_run") return "composio_execute";
  return "unknown";
}

/**
 * Run one non-terminal Auto tool via runtime callbacks.
 * @param {string} kind
 * @param {{
 *   checkRunStatus?: () => Promise<object|string>,
 *   listPeerAgents?: () => Promise<object|string>,
 *   userId?: string,
 *   composioSessionId?: string|null,
 *   composioApiKey?: string|null,
 *   composioToolkitSlugs?: string[],
 *   composioEnabled?: boolean,
 *   saveComposioSessionId?: (id: string) => Promise<void>,
 * }} [runtime]
 * @param {object} [args]
 * @returns {Promise<string>}
 */
export async function executeAutoLookupTool(kind, runtime = {}, args = {}) {
  try {
    if (kind === "check_run_status") {
      if (typeof runtime.checkRunStatus !== "function") {
        return JSON.stringify({ ok: false, detail: "check_run_status not available" });
      }
      const data = await runtime.checkRunStatus();
      return typeof data === "string" ? data : JSON.stringify(data);
    }
    if (kind === "list_peer_agents") {
      if (typeof runtime.listPeerAgents !== "function") {
        return JSON.stringify({ ok: false, detail: "list_peer_agents not available" });
      }
      const data = await runtime.listPeerAgents();
      return typeof data === "string" ? data : JSON.stringify(data);
    }
    if (
      kind === "composio_list" ||
      kind === "composio_search" ||
      kind === "composio_connect" ||
      kind === "composio_wait" ||
      kind === "composio_execute"
    ) {
      // Why: product is agent-only Composio — chat uses the agent’s encrypted key only.
      const apiKey = String(runtime.composioApiKey || "").trim();
      if (!apiKey) {
        return JSON.stringify({
          ok: false,
          detail:
            "No Composio API key on this agent. Open Agents → edit → Composio, paste a key, enable apps, and save.",
        });
      }
      if (runtime.composioEnabled === false) {
        return JSON.stringify({
          ok: false,
          detail: "Composio is disabled for this agent. Enable it under Agents → Composio.",
        });
      }
      const userId = String(runtime.userId || "").trim();
      if (!userId) {
        return JSON.stringify({ ok: false, detail: "userId missing for Composio" });
      }
      const toolkitSlugs = Array.isArray(runtime.composioToolkitSlugs)
        ? runtime.composioToolkitSlugs
        : [];
      if (kind === "composio_list") {
        const { composioListStatus } = await import("./composioService.js");
        const data = await composioListStatus({
          userId,
          apiKey,
          toolkitSlugs,
        });
        return JSON.stringify(data).slice(0, 4000);
      }
      if (kind === "composio_search") {
        const { composioSearchTools } = await import("./composioService.js");
        const data = await composioSearchTools({
          apiKey,
          query: args.query || args.q || args.search || "",
          toolkitSlugs,
          limit: 12,
        });
        return JSON.stringify(data).slice(0, 4000);
      }
      if (kind === "composio_connect") {
        const { composioAuthorizeToolkit } = await import("./composioService.js");
        const result = await composioAuthorizeToolkit({
          userId,
          apiKey,
          toolkit: args.toolkit || args.app || args.slug,
          sessionId: runtime.composioSessionId,
          toolkitSlugs,
        });
        if (result.sessionId && typeof runtime.saveComposioSessionId === "function") {
          await runtime.saveComposioSessionId(result.sessionId).catch(() => {});
        }
        return JSON.stringify({
          ...result,
          hint: result.ok
            ? "Include redirectUrl as a plain URL in your reply so the user can click it. Then call composio_wait after they connect."
            : undefined,
        }).slice(0, 4000);
      }
      if (kind === "composio_wait") {
        const { composioWaitForToolkit } = await import("./composioService.js");
        const result = await composioWaitForToolkit({
          userId,
          apiKey,
          toolkit: args.toolkit || args.app || args.slug,
          toolkitSlugs,
          timeoutMs: Number(args.timeoutMs) || 25_000,
        });
        return JSON.stringify(result).slice(0, 4000);
      }
      if (kind === "composio_execute") {
        const { composioExecuteTool } = await import("./composioService.js");
        const toolSlug = String(args.tool || args.slug || args.action || "").trim();
        let toolArgs =
          args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
            ? args.arguments
            : args.params && typeof args.params === "object" && !Array.isArray(args.params)
              ? args.params
              : null;
        // Why: fake ACTION / flat tool calls put query/max_results on the top-level args object.
        if (!toolArgs) {
          toolArgs = { ...args };
          delete toolArgs.tool;
          delete toolArgs.slug;
          delete toolArgs.action;
          delete toolArgs.arguments;
          delete toolArgs.params;
        }
        const result = await composioExecuteTool({
          userId,
          apiKey,
          sessionId: runtime.composioSessionId,
          toolkitSlugs,
          tool: toolSlug,
          arguments: toolArgs,
        });
        if (result.sessionId && typeof runtime.saveComposioSessionId === "function") {
          await runtime.saveComposioSessionId(result.sessionId).catch(() => {});
        }
        const compact = compactComposioExecuteResult(result, toolSlug);
        const errText = String(compact.error || result.error || "").toLowerCase();
        if (
          !result.ok &&
          /not connected|unauthorized|auth|no connected account|connect/i.test(errText)
        ) {
          return JSON.stringify({
            ...compact,
            hint: "App may not be connected. Call composio_connect for that toolkit, then composio_wait, then retry.",
          }).slice(0, 8000);
        }
        return JSON.stringify(compact).slice(0, 8000);
      }
    }
  } catch (err) {
    return JSON.stringify({ ok: false, detail: String(err?.message || err) });
  }
  return JSON.stringify({ ok: false, detail: `Unknown lookup tool: ${kind}` });
}

/**
 * @param {string} raw
 * @param {string} [userText]
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string }}
 */
export function parseAutoTurnOutput(raw, userText = "") {
  const cleaned = stripModelThinking(String(raw || "")).trim();
  if (!cleaned) {
    return recoverMalformedAutoOutput("", userText);
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const action =
        parsed.action === "queue_goal" || parsed.action === "goal" || parsed.action === "run"
          ? "queue_goal"
          : "reply";
      const content = String(parsed.content || parsed.reply || parsed.message || "").trim();
      const goal = String(parsed.goal || parsed.task || content).trim();
      const ack = String(parsed.ack || parsed.note || "").trim();
      if (action === "queue_goal") {
        return { action, content: ack || content, goal: goal || content, ack };
      }
      return {
        action: "reply",
        content: sanitizeAutoReplyContent(content || cleaned),
        goal: "",
        ack: "",
      };
    } catch {
      /* fall through — maybe trailing commas / single quotes */
      const loose = parseToolArgs(jsonMatch[0]);
      if (loose && (loose.action || loose.goal || loose.content || loose.reply)) {
        const action =
          loose.action === "queue_goal" || loose.action === "goal" || loose.action === "run"
            ? "queue_goal"
            : loose.goal && !loose.content
              ? "queue_goal"
              : "reply";
        if (action === "queue_goal") {
          const goal = String(loose.goal || loose.task || userText || "").trim();
          const ack = String(loose.ack || loose.note || "").trim();
          if (goal) return { action, content: ack, goal, ack };
        }
        const content = String(loose.content || loose.reply || loose.message || "").trim();
        if (content) {
          return { action: "reply", content: sanitizeAutoReplyContent(content), goal: "", ack: "" };
        }
      }
    }
  }

  const lines = cleaned.split(/\r?\n/);
  const head = String(lines[0] || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z_]/g, "");
  const body = lines.slice(1).join("\n").trim();

  if (head === "QUEUE_GOAL" || head === "GOAL" || head === "RUN") {
    let goal = "";
    let ack = "";
    for (const line of body.split(/\r?\n/)) {
      const mGoal = line.match(/^goal:\s*(.*)$/i);
      const mAck = line.match(/^ack:\s*(.*)$/i);
      if (mGoal) goal = mGoal[1].trim();
      else if (mAck) ack = mAck[1].trim();
    }
    if (!goal) goal = body.replace(/^ack:.*$/im, "").trim();
    return { action: "queue_goal", content: ack, goal: goal || body, ack };
  }

  if (head === "REPLY" || head === "ANSWER") {
    return {
      action: "reply",
      content: sanitizeAutoReplyContent(body || cleaned),
      goal: "",
      ack: "",
    };
  }

  // Why: scratchpad then glued “…REPLY\nYes…” — first line is not REPLY; take body after last marker.
  const afterReply = extractAfterLastReplyMarker(cleaned);
  if (afterReply != null) {
    return {
      action: "reply",
      content: sanitizeAutoReplyContent(afterReply),
      goal: "",
      ack: "",
    };
  }

  // Why: junk / mixed tool XML — last-resort recover instead of dumping raw protocol text.
  if (
    /<\/?tool_call>|<\/?function_call>|"name"\s*:\s*"(reply|queue_goal)"/i.test(cleaned) ||
    /QUEUE_GOAL|REPLY\b/i.test(cleaned)
  ) {
    return recoverMalformedAutoOutput(cleaned, userText);
  }

  return {
    action: "reply",
    content: sanitizeAutoReplyContent(cleaned),
    goal: "",
    ack: "",
  };
}

/**
 * Soft gate only — always defer to the LLM for chat vs computer vs Composio.
 * Why: Jev + URL heuristics mis-routed app asks (Sheets/Gmail) and past-work questions.
 * Kept as "model" so empty-reply recovery never force-queues either.
 * @param {string} _text
 * @returns {"queue_goal"|"model"}
 */
export function autoTurnHeuristicGate(_text) {
  return "model";
}

/**
 * Soft classifier note injected into the Auto user message so the LLM sees context signals.
 * Why: no hard route — the model must pick REPLY (chat), QUEUE_GOAL (live computer), or composio_* tools.
 * @param {string} text
 * @param {{ jev?: { action?: string, choice?: string, confidence?: number, reason?: string }|null }} [_opts]
 * @returns {string}
 */
export function formatAutoClassifierHint(text, _opts = {}) {
  const c = classifyMessageIntent(text, {});
  const reason = String(c.reason || "unknown");
  const intent = String(c.intent || "unknown");
  /** @type {string[]} */
  const lines = [
    "[AUTO DECISION HINT — not user text]",
    `classifier_intent=${intent}; classifier_reason=${reason}`,
    "YOU decide one of three modes:",
    "1) REPLY — normal chat (questions, memory, planning, past status). No Chromium.",
    "2) QUEUE_GOAL — live cloud computer / peers NOW (open/click/fill a site, fan-out).",
    "3) Composio tools (composio_search → composio_execute) — Gmail/Sheets/Slack/Drive and other connected apps. Never invent browser goals for those.",
  ];
  if (reason === "day_history_or_status" || reason === "vague_chat_followup") {
    lines.push(
      "Signal: looks like past-work / status — prefer REPLY from day history. Do NOT start a live computer."
    );
  } else if (reason === "memory_store_request") {
    lines.push(
      "Signal: teaching preferences/facts — prefer REPLY (URLs in the list are bookmarks, not a browse job)."
    );
  } else if (looksLikeComposioAppRequest(text)) {
    lines.push(
      "Signal: may be a connected-app ask — prefer composio_* tools over QUEUE_GOAL."
    );
  } else if (reason === "has_url_or_domain" || reason === "explicit_task") {
    lines.push(
      "Signal: URL/domain or task verb seen. QUEUE_GOAL only for a live browse/run RIGHT NOW;",
      "prefer REPLY if they ask about the past, capability, or planning."
    );
  } else if (reason === "capability_question") {
    lines.push("Signal: capability/policy — prefer REPLY until they name a concrete live job.");
  } else {
    lines.push("Prefer REPLY when unsure. A domain/URL alone ≠ start computer.");
  }
  lines.push("[END AUTO DECISION HINT]");
  return lines.join("\n");
}


export function buildAutoUserContent(text, opts = {}) {
  const body = String(text || "").trim().slice(0, 4000);
  const hint = formatAutoClassifierHint(body, opts);
  return `${hint}\n\nUSER MESSAGE:\n${body}`;
}

/**
 * Visible reply text to stream from a partial buffer (strips REPLY header once seen).
 * @param {string} buf
 * @returns {{ visible: string, mode: "reply"|"queue_goal"|"pending" }}
 */
function streamVisibleFromBuffer(buf) {
  const afterReply = extractAfterLastReplyMarker(buf);
  if (afterReply != null) {
    if (looksLikeSubstantiveUserReply(afterReply)) return { visible: afterReply, mode: "reply" };
    if (looksLikeAutoDeliberation(afterReply)) return { visible: "", mode: "pending" };
    return { visible: afterReply, mode: "reply" };
  }
  const nl = buf.indexOf("\n");
  if (nl === -1) {
    const head = buf.trim().toUpperCase().replace(/[^A-Z_]/g, "");
    if (head === "QUEUE_GOAL" || head === "GOAL" || head === "RUN") {
      return { visible: "", mode: "queue_goal" };
    }
    if (head === "REPLY" || head === "ANSWER") {
      return { visible: "", mode: "pending" };
    }
    // Why: never stream freeform — models dump planning notes before QUEUE_GOAL/REPLY.
    return { visible: "", mode: "pending" };
  }
  const first = buf.slice(0, nl).trim().toUpperCase().replace(/[^A-Z_]/g, "");
  const rest = buf.slice(nl + 1);
  if (first === "QUEUE_GOAL" || first === "GOAL" || first === "RUN") {
    return { visible: "", mode: "queue_goal" };
  }
  if (first === "REPLY" || first === "ANSWER") {
    // Why: stream real drafts immediately; only hold clear planning dumps.
    if (looksLikeSubstantiveUserReply(rest)) return { visible: rest, mode: "reply" };
    if (looksLikeAutoDeliberation(rest)) return { visible: "", mode: "pending" };
    return { visible: rest, mode: "reply" };
  }
  // No protocol header yet — hold the bubble empty until finalize sanitizes.
  return { visible: "", mode: "pending" };
}

/**
 * @param {object} snapshot
 * @param {string} agentName
 * @param {string} thread
 * @param {"tools"|"text"} mode
 * @returns {string}
 */
function buildAutoSystemPrompt(snapshot, agentName, thread, mode) {
  const context = formatAgentPrompt(snapshot);
  const shared = [
    `You are “${agentName}”, an AI employee on YamBot. Never call yourself “YamBot”.`,
    "Do not introduce yourself or repeat your name in every reply — the UI already shows who is speaking. Only say your name when the human asks who you are.",
    "Do not address the human by name every turn unless it fits naturally.",
    "Never append lines like “AGENT NAME: …” to your replies.",
    "",
    "You are NOT controlling the browser in this turn. Queuing starts a cloud computer / A2A workers.",
    "",
    "=== DECISION: three modes (you own this choice) ===",
    "Read the [AUTO DECISION HINT] on the user message, then pick exactly one mode:",
    "",
    "1) REPLY / reply — normal chat (no Chromium, no Composio unless you already finished tools):",
    "- Questions, memory, capability, planning, greetings, drafts",
    "- Past work: “did we open X today?”, day history, status",
    "- Schedule manage: “check email every 5 minutes”, “list schedules”, “stop the schedule” — REPLY after saving (runtime handles it); do not QUEUE_GOAL for the manage message itself",
    "- Multi-step with missing details (e.g. send to an email without an address): ask first — runtime TaskPlan handles this",
    "- Prefer REPLY when unsure",
    "",
    "2) QUEUE_GOAL / queue_goal — LIVE cloud computer / peers NOW:",
    "- Imperative browse: open/go to/navigate/visit a site, click, fill, submit, log in (now)",
    "- Create/register accounts in CRM / Vughy / agency admin (even if they also want credentials emailed after)",
    "- Open/check a site (Vughy/CRM) AND then update Notion / Slack / email — QUEUE_GOAL the browser step only; connected apps run after the computer finishes",
    "- When they ask create/register AND send credentials to an email: QUEUE_GOAL the browser create step — the runtime emails credentials via Composio after the computer finishes",
    "- Live research that needs browsing this turn",
    "- Peer message / fan-out / handoff",
    "- Worker send_email / download / change something in the browser",
    "- NEVER turn an email address into a https:// URL",
    "- NEVER use QUEUE_GOAL for Gmail/Sheets/Slack/Drive via connected apps — that is mode 3 (unless a live site step comes first in a combo)",
    "- NEVER reply with only “On it / Starting…” for a live job — you MUST call queue_goal so a Task is created",
    "",
    "3) Composio tools — connected apps (Gmail, Google Sheets, Slack, Drive, Notion, …):",
    "- Use composio_search → composio_connect (if needed) → composio_wait → composio_execute",
    "- Multi-step asks (list a Sheet then email it; unread then Slack) — finish each step before the next",
    "- Always paste the full https connect URL when composio_connect returns redirectUrl",
    "- Never write fake ACTION: lines — call real composio_* tools, then reply in plain prose",
    "",
    "Auto: YOU decide among the three. A domain/URL alone ≠ start computer. Prefer REPLY when unsure.",
    "",
    "SEND MAIL RULES:",
    "- Draft = REPLY. Send via worker SMTP = QUEUE_GOAL. Send via connected Gmail = Composio tools.",
    "- When EMAIL IDENTITY / SMTP is configured, the worker must use send_email actions (to/subject/text) — not Gmail compose and not navigate.",
    "- Copy recipient addresses from RECENT MESSAGES. Do not invent URLs from local-parts (e.g. never open https://alex.parker.demo/).",
    "",
    "Do not invent credentials. Prefer reply when unsure unless they clearly need browsing, peers, or connected apps.",
    "USER PROFILE (Settings → Memory) is authoritative for tone/identity. If that block is empty or says none, ignore old tone prefs from chat history.",
    "CONTEXT PRECEDENCE (highest wins): current user message > standing instructions / task state > USER PROFILE > MEMORY (retrieved) > day history / chat summary > assumptions. Retrieved MEMORY is background only — never override an explicit instruction this turn.",
  ];

  if (mode === "tools") {
    return [
      ...shared,
      "",
      "You may call tools. Prefer:",
      "- check_run_status / list_peer_agents when you need live facts before answering",
      "- then reply OR queue_goal to finish the turn",
      "Do not invent other tool names. Lookups never start the browser.",
      `At most ${AUTO_CHAT_MAX_TOOL_ROUNDS} tool rounds — then you must reply or queue_goal.`,
      "",
      context || "(no extra agent context)",
      thread ? `\n\n${thread}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    ...shared,
    "",
    "Output format (strict) — text fallback when tools are unavailable:",
    "Option A — direct answer:",
    "REPLY",
    "Your plain sentence(s) to the user — no tool JSON, no angle brackets.",
    "",
    "Option B — need the computer / peers:",
    "QUEUE_GOAL",
    "goal: concrete worker instructions. If the user stated an if/then condition, copy THAT condition verbatim — never reuse an older condition from chat history.",
    "ack: On it — checking the list now.",
    "Example:",
    "QUEUE_GOAL",
    "goal: Log into Vughy admin, open Trial expiring list for India, then if more than 1 accounts exist message general agent hi; otherwise do not message.",
    "ack: On it — checking the list now.",
    "",
    "CRITICAL: Output ONLY the protocol lines above. Never write planning notes, tone debates, prompt restatements, capability-question reasoning, or “we can say …” — those must not appear in chat. First characters must be REPLY or QUEUE_GOAL.",
    "",
    context || "(no extra agent context)",
    thread ? `\n\n${thread}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Text-protocol Auto turn (streaming-friendly). Used when tools unsupported or empty.
 * @param {object} opts
 * @param {ReturnType<typeof createAutoTimingTracker>} [timing]
 * @returns {Promise<{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string, timing: object }>}
 */
async function runChatAutoTurnTextFallback(opts, timing) {
  const track = timing || createAutoTimingTracker();
  // Why: caller may already set text_fast — do not clobber that path label.
  if (!timing) track.setPath("text_fallback");
  const { question, snapshot, creds, chatContext = "", stream = false, onDelta, jev = null, signal = null } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const messages = [
    {
      role: "system",
      content: buildAutoSystemPrompt(snapshot, agentName, thread, "text"),
    },
    { role: "user", content: buildAutoUserContent(text, { jev }) },
  ];

  const llmOpts = {
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0.3,
    maxTokens: 900,
    timeoutMs: 60_000,
    messages,
    signal: signal || null,
  };

  const delta = track.wrapOnDelta(onDelta);
  let raw;
  let usedStream = false;
  /** Visible chars already pushed to the client (REPLY protocol may hold this at 0). */
  let emitted = 0;
  if (stream && typeof delta === "function") {
    usedStream = true;
    let buf = "";
    raw = await llmChatCompletionStream(llmOpts, (chunk) => {
      // Why: TTFT = first model token, even while REPLY/QUEUE protocol still hides the bubble.
      if (String(chunk || "").length) track.markFirstToken();
      buf += chunk;
      const { visible, mode } = streamVisibleFromBuffer(buf);
      if (mode === "queue_goal") return;
      if (visible.length > emitted) {
        delta(visible.slice(emitted));
        emitted = visible.length;
      }
    });
    // Why: some providers accept stream:true but return empty SSE — retry one-shot.
    if (!String(raw || "").trim()) {
      track.setPath("text_fallback_stream_empty");
      raw = await llmChatCompletion(llmOpts);
      usedStream = false;
    }
  } else {
    raw = await llmChatCompletion(llmOpts);
  }

  let parsed = parseAutoTurnOutput(raw, text);
  if (!parsed.content && !parsed.goal) {
    parsed = recoverMalformedAutoOutput(raw, text);
  }
  track.markDecision(parsed.action);
  const normalized = ensureAutoTurnResult(
    { ...parsed, reason: "model_auto_turn_text" },
    {
      userText: text,
      agentName,
      chatContext: thread,
      emailConfigured: Boolean(snapshot?.email?.configured),
      fromAddress: String(snapshot?.email?.fromAddress || ""),
    }
  );
  if (normalized.action === "reply" && normalized.content && typeof delta === "function") {
    if (!usedStream) {
      delta(normalized.content);
    } else if (emitted === 0) {
      // Why: protocol held the bubble empty for the whole SSE — still paint + seal TTFT.
      await emitReplyDelta(normalized.content, delta, { chunk: Boolean(stream) });
    }
  }
  // Why: never leave Auto replies without firstTokenMs (chip showed total only).
  if (normalized.action === "reply" && normalized.content) {
    track.markFirstToken();
  }
  return { ...normalized, timing: track.finish() };
}

/**
 * Auto turn: native tools with a short lookup loop, then text fallback.
 * @param {{
 *   question: string,
 *   snapshot: object,
 *   creds: { apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string },
 *   chatContext?: string,
 *   stream?: boolean,
 *   onDelta?: (chunk: string) => void,
 *   onProgress?: (step: { id: string, label: string, pct: number }) => void,
 *   runtime?: {
 *     checkRunStatus?: () => Promise<object|string>,
 *     listPeerAgents?: () => Promise<object|string>,
 *   },
 * }} opts
 * @returns {Promise<{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string, timing?: object }>}
 */
export async function runChatAutoTurn(opts) {
  const {
    question,
    snapshot,
    creds,
    chatContext = "",
    stream = false,
    onDelta,
    onProgress,
    runtime = {},
    jevMode = "auto",
    signal = null,
    timing = null,
  } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  // Why: chats.js may start the tracker before prepare so prepMs lands in the chip.
  const track = timing || createAutoTimingTracker({ onProgress });
  const delta = track.wrapOnDelta(onDelta);
  /** @param {string} content */
  const pushReply = async (content) => {
    await emitReplyDelta(content, delta, { chunk: Boolean(stream) });
  };
  const threadEarly = String(chatContext || snapshot?.chatContext || "").trim();
  const ensureCtx = {
    userText: text,
    agentName,
    chatContext: threadEarly,
    emailConfigured: Boolean(snapshot?.email?.configured),
    fromAddress: String(snapshot?.email?.fromAddress || ""),
  };
  const finalize = (partial) => {
    const out = ensureAutoTurnResult(
      { ...partial, timing: partial.timing || track.finish() },
      ensureCtx
    );
    // Why: Hermes TaskPlan ids must survive ensureAutoTurnResult normalization.
    if (partial?.taskPlanId) out.taskPlanId = String(partial.taskPlanId);
    if (partial?.taskPlanStepId) out.taskPlanStepId = String(partial.taskPlanStepId);
    // Why: lab A/B needs the raw Jev decision alongside the normalized turn.
    if (partial?.jev) out.jev = partial.jev;
    out.jevMode = String(jevMode || "auto");
    return out;
  };

  // Why: “check email every 5 minutes” saves a schedule — do not run or queue now.
  if (looksLikeScheduleManageRequest(text) && runtime?.agent) {
    const parsed = parseScheduleFromChat(text);
    if (parsed) {
      track.setPath("schedule_manage");
      track.markDecision("reply");
      try {
        const applied = await applyScheduleFromChat({
          agent: runtime.agent,
          parsed,
          chatId: runtime.chatId || null,
        });
        const content = String(applied.content || "Schedule updated.").trim();
        if (content) await pushReply(content);
        return finalize({
          action: "reply",
          content,
          goal: "",
          ack: "",
          reason: `schedule_${parsed.action}`,
          timing: track.finish(),
        });
      } catch (err) {
        const content = `Could not update schedule: ${String(err?.message || err)}`;
        await pushReply(content);
        return finalize({
          action: "reply",
          content,
          goal: "",
          ack: "",
          reason: "schedule_manage_error",
          timing: track.finish(),
        });
      }
    }
  }

  // Why: send-mail follow-ups skip the model and build a hardened send_email goal from chat.
  // Never steal “send … using composio” into the SMTP path.
  // Why: SMTP checkbox Off + Composio available → fall through so Gmail API can send.
  const smtpConfigured = Boolean(snapshot?.email?.configured);
  const composioReady =
    Boolean(runtime?.composioEnabled) && Boolean(String(runtime?.composioApiKey || "").trim());
  if (
    looksLikeSendEmailRequest(text) &&
    !looksLikeComposioAppRequest(text) &&
    (smtpConfigured || !composioReady)
  ) {
    track.setPath("send_email_harden");
    track.markDecision("queue_goal");
    return finalize({
      action: "queue_goal",
      content: "",
      goal: text,
      ack: "",
      reason: "send_email_request",
      timing: track.finish(),
    });
  }

  // Why: Hermes-depth multi-step (site → email) with clarify + stateful plan.
  if (runtime?.agent && runtime?.chatId) {
    try {
      const tp = await startOrResumeTaskPlan({
        userId: String(runtime.userId || ""),
        chatId: String(runtime.chatId),
        agent: runtime.agent,
        userText: text,
        creds,
      });
      if (tp.handled) {
        track.setPath("taskplan");
        track.markDecision(tp.action === "queue_goal" ? "queue_goal" : "reply");
        if (tp.action === "reply" && tp.content) {
          await pushReply(tp.content);
        }
        return finalize({
          action: tp.action === "queue_goal" ? "queue_goal" : "reply",
          content: tp.content || "",
          goal: tp.goal || "",
          ack: tp.ack || "",
          reason: tp.reason || "taskplan",
          taskPlanId: tp.taskPlanId || "",
          taskPlanStepId: tp.taskPlanStepId || "",
          timing: track.finish(),
        });
      }
    } catch (err) {
      console.warn("[auto] taskplan failed:", err?.message || err);
    }
  }

  // Why: hybrid browser→Notion/Slack/email must queue computer first (apps resume after complete).
  if (looksLikeHybridCombo(text)) {
    const plan = planComboFromText(text);
    track.setPath("combo_hybrid_queue");
    track.markDecision("queue_goal");
    return finalize({
      action: "queue_goal",
      content: "",
      goal: plan.computerGoal || text,
      ack: "",
      reason: `combo_hybrid:${plan.recipe || "browse_then_composio_tail"}`,
      timing: track.finish(),
    });
  }

  // Why: day-history / vague "what" must never reach QUEUE_GOAL — models invent login goals from thread.
  if (looksLikeDayHistoryOrStatusRequest(text) || looksLikeVagueChatFollowup(text)) {
    track.setPath("day_history_forced_qa");
    track.markDecision("reply");
    let content = "";
    if (looksLikeVagueChatFollowup(text)) {
      content = "Could you clarify what you mean?";
    } else {
      // Why: build from dayLogs directly — LLM was echoing Mem0 prefs (“long scratchpads”) instead.
      content = formatDayHistoryChatAnswer(snapshot, text);
      if (stream && content) {
        await pushReply(content);
      }
    }
    return finalize({
      action: "reply",
      content: content || "No day-history summary available yet.",
      goal: "",
      ack: "",
      reason: looksLikeVagueChatFollowup(text)
        ? "vague_chat_followup_forced_qa"
        : "day_history_forced_qa",
      timing: track.finish(),
    });
  }

  // Why: Hermes-style fast path — skip tool schema + non-SSE loop for chitchat; stream tokens now.
  if (looksLikeLightweightChat(text)) {
    track.setPath("text_fast");
    return finalize(
      await runChatAutoTurnTextFallback(
        {
          question: text,
          snapshot,
          creds,
          chatContext: threadEarly,
          stream: true,
          onDelta,
          signal,
        },
        track
      )
    );
  }

  // Why: Jev + URL heuristics + deterministic Composio intents removed —
  // the chat LLM owns normal reply vs live computer vs connected-app tools.
  const jevDecision = null;

  const thread = String(chatContext || snapshot?.chatContext || "").trim();

  /** @type {object[]} */
  const messages = [
    {
      role: "system",
      content: buildAutoSystemPrompt(snapshot, agentName, thread, "tools"),
    },
    { role: "user", content: buildAutoUserContent(text) },
  ];

  try {
    track.setPath("tools");
    const composioIntent = looksLikeComposioAppRequest(text);
    if (composioIntent) {
      track.emitProgress("Using connected apps…", 10);
    }
    for (let round = 0; round < AUTO_CHAT_MAX_TOOL_ROUNDS; round++) {
      track.setToolRounds(round + 1);
      const msg = await llmChatCompletionMessage({
        apiKey: creds.apiKey,
        baseUrl: creds.llmBaseUrl || "",
        model: creds.llmModel || "",
        openAiAccountId: creds.openAiAccountId,
        temperature: 0.3,
        maxTokens: 900,
        timeoutMs: 60_000,
        messages,
        tools: AUTO_CHAT_TOOLS,
        // Why: never force a named tool_choice — some providers return “Provider returned error” for that.
        toolChoice: "auto",
        signal: signal || null,
      });
      // Why: tools path is non-SSE — stamp TTFT when the first model message returns.
      track.markFirstToken();

      /**
       * Execute fake ACTION: composio_*() text as real lookups and keep the loop going.
       * @param {string} actionText
       * @returns {Promise<boolean>} true if any fake actions ran
       */
      async function runFakeComposioActionsFromText(actionText) {
        const fakes = parseFakeComposioActionText(actionText);
        if (!fakes.length) return false;
        messages.push({
          role: "assistant",
          content: String(actionText || "").slice(0, 2000),
        });
        for (const fake of fakes) {
          track.addLookup(fake.kind);
          const args =
            fake.kind === "composio_search" && !fake.args.query
              ? { ...fake.args, query: text }
              : fake.args;
          const resultText = await executeAutoLookupTool(fake.kind, runtime, args);
          messages.push({
            role: "user",
            content:
              `[COMPOSIO TOOL RESULT for ${fake.kind}]\n${resultText.slice(0, 3500)}\n\n` +
              "Continue with native composio_* tools if needed (e.g. composio_search then composio_execute), " +
              "then reply to the user in plain prose with the summary. Never print ACTION: lines. Never say hold on — finish the task.",
          });
        }
        return true;
      }

      /**
       * If the model tries to end with a stall / ACTION: / filler, run search/execute or nudge.
       * @param {string} replyText
       * @returns {Promise<boolean>} true if the loop should continue
       */
      async function rejectPrematureComposioReply(replyText) {
        if (!composioIntent) return false;
        const steps = summarizeComposioLookups(track.getLookups());
        const stall = looksLikeComposioStallReply(replyText);
        const fakeAction = looksLikeFakeComposioActionText(replyText);
        const cleaned = fakeAction
          ? sanitizeFakeComposioActionReply(replyText, "")
          : String(replyText || "").trim();
        const emptyOrActionOnly = !cleaned || cleaned.length < 8;

        // Real prose summary after execute — allow through.
        if (steps.executed && !stall && !fakeAction && cleaned.length >= 8) return false;

        if (fakeAction) {
          const ran = await runFakeComposioActionsFromText(replyText);
          if (ran) return true;
        }

        if (!steps.executed) {
          if (!steps.searched) {
            track.addLookup("composio_search");
            const resultText = await executeAutoLookupTool("composio_search", runtime, {
              query: text,
            });
            messages.push({
              role: "user",
              content:
                `[COMPOSIO TOOL RESULT for composio_search]\n${resultText.slice(0, 3500)}\n\n` +
                "Now call composio_execute with the best GMAIL_* (or matching) tool slug and arguments, " +
                "then reply with a real summary of unread emails. Do not say hold on. Never print ACTION: lines.",
            });
            return true;
          }
          // Why: searched but model still stalls / ACTION-only — run mapped intent ourselves.
          const mappedStall = matchComposioIntent(text);
          if (mappedStall) {
            track.addLookup("composio_search");
            track.addLookup("composio_execute");
            const auto = await runComposioIntentExecute({
              runtime,
              userText: text,
              spec: mappedStall,
              executeLookup: executeAutoLookupTool,
            });
            if (auto.needsConnect) track.addLookup("composio_connect");
            messages.push({
              role: "user",
              content:
                `[COMPOSIO TOOL RESULT for composio_execute${auto.tool ? ` (${auto.tool})` : ""}]\n` +
                `${String(auto.resultText || "").slice(0, 3500)}\n\n` +
                "Using ONLY this JSON, reply in plain prose for the user. " +
                "If not connected, include the Connect URL. Never say hold on. Never print ACTION: lines.",
            });
            return true;
          }
          messages.push({
            role: "user",
            content:
              "[SYSTEM] Do not stall or print ACTION: lines. Call composio_execute now using a tool slug from the search results, then summarize in plain prose.",
          });
          return true;
        }

        if (stall || emptyOrActionOnly || fakeAction) {
          messages.push({
            role: "user",
            content:
              "[SYSTEM] You already ran composio_execute. Reply now with the actual summary (senders/subjects) — no filler, no ACTION: lines.",
          });
          return true;
        }
        return false;
      }

      const terminal = parseAutoToolCalls(msg.toolCalls);
      if (terminal) {
        // Why: model still proposes queue_goal for Gmail — reject and keep the composio tool loop.
        if (terminal.action === "queue_goal" && composioIntent) {
          messages.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.rawMessage?.tool_calls || undefined,
          });
          if (msg.rawMessage?.tool_calls?.length) {
            for (const tc of msg.rawMessage.tool_calls) {
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({
                  ok: false,
                  detail:
                    "Do not queue_goal for Composio apps. Use composio_search then composio_execute (or composio_connect if not connected).",
                }),
              });
            }
          } else {
            messages.push({
              role: "user",
              content:
                "[SYSTEM] Rejected queue_goal. Use composio_search → composio_execute for this Gmail/Slack/app request. Do not start the computer.",
            });
          }
          continue;
        }
        // Why: models reply with ACTION: composio_*() or ACTION: check_email() instead of native tools.
        if (terminal.action === "reply" && looksLikeFakeInboxActionText(terminal.content)) {
          const mappedFake = matchComposioIntent(text) || matchComposioIntent("unread emails gmail");
          if (mappedFake && runtime?.composioApiKey) {
            return finalize(
              await runDeterministicComposioIntentTurn({
                runtime,
                userText: text,
                creds,
                onDelta: typeof delta === "function" ? delta : undefined,
                track,
                spec: mappedFake,
              })
            );
          }
        }
        if (
          terminal.action === "reply" &&
          looksLikeFakeComposioActionText(terminal.content)
        ) {
          const ran = await runFakeComposioActionsFromText(terminal.content);
          if (ran) continue;
        }
        if (terminal.action === "reply" && (await rejectPrematureComposioReply(terminal.content))) {
          continue;
        }
        const finalContent = sanitizeFakeComposioActionReply(terminal.content || "", "");
        // Why: never surface empty / ACTION-stripped dead-end to the user.
        if (
          terminal.action === "reply" &&
          (!finalContent || finalContent.length < 8) &&
          (composioIntent || looksLikeFakeInboxActionText(terminal.content || ""))
        ) {
          const mappedEmpty = matchComposioIntent(text);
          if (mappedEmpty && runtime?.composioApiKey) {
            return finalize(
              await runDeterministicComposioIntentTurn({
                runtime,
                userText: text,
                creds,
                onDelta: typeof delta === "function" ? delta : undefined,
                track,
                spec: mappedEmpty,
              })
            );
          }
          if (await rejectPrematureComposioReply(terminal.content || "")) continue;
        }
        track.markDecision(terminal.action);
        const out = finalize({
          ...terminal,
          content: finalContent || terminal.content || "",
          reason: round === 0 ? "model_auto_tool_call" : "model_auto_tool_loop",
          timing: track.finish(),
        });
        if (out.action === "reply" && out.content) {
          await pushReply(out.content);
        }
        return out;
      }

      const lookups = (msg.toolCalls || []).filter((tc) => {
        const kind = classifyAutoToolName(tc);
        return (
          kind === "check_run_status" ||
          kind === "list_peer_agents" ||
          kind === "composio_list" ||
          kind === "composio_search" ||
          kind === "composio_connect" ||
          kind === "composio_wait" ||
          kind === "composio_execute"
        );
      });

      if (lookups.length) {
        const assistantToolMessage = msg.rawMessage?.tool_calls
          ? {
              role: "assistant",
              content: msg.content || null,
              tool_calls: msg.rawMessage.tool_calls,
            }
          : {
              role: "assistant",
              content: msg.content || null,
              tool_calls: lookups.map((tc, i) => ({
                id: tc.id || `call_${round}_${i}`,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: tc.arguments || "{}",
                },
              })),
            };
        messages.push(assistantToolMessage);

        for (let i = 0; i < lookups.length; i++) {
          const tc = lookups[i];
          const kind = classifyAutoToolName(tc);
          track.addLookup(kind);
          const toolCallId =
            tc.id ||
            assistantToolMessage.tool_calls?.[i]?.id ||
            `call_${round}_${i}`;
          let toolArgs = parseToolArgs(tc?.arguments);
          if (kind === "composio_search" && !toolArgs.query) {
            toolArgs = { ...toolArgs, query: text };
          }
          // Why: empty tool slug on composio_execute — finish mapped intent ourselves.
          const mappedExec = matchComposioIntent(text);
          if (
            kind === "composio_execute" &&
            !(toolArgs.tool || toolArgs.slug || toolArgs.action) &&
            mappedExec
          ) {
            const auto = await runComposioIntentExecute({
              runtime,
              userText: text,
              spec: mappedExec,
              executeLookup: executeAutoLookupTool,
            });
            track.addLookup("composio_search");
            if (auto.needsConnect) track.addLookup("composio_connect");
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: String(auto.resultText || "").slice(0, 8000),
            });
            continue;
          }
          if (kind === "composio_execute" && !(toolArgs.tool || toolArgs.slug || toolArgs.action)) {
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: false,
                detail:
                  "composio_execute requires a tool slug from composio_search (e.g. GMAIL_FETCH_EMAILS). Call composio_search first, then retry with tool + arguments.",
              }),
            });
            continue;
          }
          const resultText = await executeAutoLookupTool(kind, runtime, toolArgs);
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: resultText.slice(0, 4000),
          });
        }
        continue;
      }

      // Why: free-text "ACTION: composio_*()" / "ACTION: check_email()" with no tool_calls.
      if (msg.content && looksLikeFakeInboxActionText(msg.content)) {
        const mappedFake = matchComposioIntent(text) || matchComposioIntent("unread emails gmail");
        if (mappedFake && runtime?.composioApiKey) {
          return finalize(
            await runDeterministicComposioIntentTurn({
              runtime,
              userText: text,
              creds,
              onDelta: typeof delta === "function" ? delta : undefined,
              track,
              spec: mappedFake,
            })
          );
        }
      }
      if (msg.content && looksLikeFakeComposioActionText(msg.content)) {
        const ran = await runFakeComposioActionsFromText(msg.content);
        if (ran) continue;
      }

      if (msg.content) {
        if (await rejectPrematureComposioReply(msg.content)) {
          continue;
        }
        let parsed = parseAutoTurnOutput(msg.content, text);
        if (!parsed.content && !parsed.goal) {
          parsed = recoverMalformedAutoOutput(msg.content, text);
        }
        const finalContent = sanitizeFakeComposioActionReply(parsed.content || "", "");
        if (composioIntent && (!finalContent || finalContent.length < 8)) {
          if (await rejectPrematureComposioReply(msg.content)) continue;
        }
        track.markDecision(parsed.action);
        const out = finalize({
          ...parsed,
          content: finalContent || parsed.content || "",
          reason: "model_auto_turn_after_tools",
          timing: track.finish(),
        });
        if (out.action === "reply" && out.content) {
          await pushReply(out.content);
        }
        return out;
      }

      // Why: empty tool round on a Composio ask — kick off search ourselves.
      if (composioIntent && !(await rejectPrematureComposioReply(""))) {
        break;
      }
      if (composioIntent) continue;

      break;
    }

    const forced = await llmChatCompletionMessage({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.3,
      maxTokens: 600,
      timeoutMs: 45_000,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Tool round limit reached. Reply to the user now with the reply tool or plain prose — do not call more lookup tools.",
        },
      ],
      tools: AUTO_CHAT_TOOLS.filter((t) =>
        ["reply", "queue_goal"].includes(t.function?.name)
      ),
      toolChoice: "auto",
      signal: signal || null,
    });
    const term = parseAutoToolCalls(forced.toolCalls);
    if (term) {
      track.markDecision(term.action);
      const out = finalize({
        ...term,
        reason: "model_auto_tool_loop_cap",
        timing: track.finish(),
      });
      if (out.action === "reply" && out.content) {
        await pushReply(out.content);
      }
      return out;
    }
    if (forced.content) {
      let parsed = parseAutoTurnOutput(forced.content, text);
      if (!parsed.content && !parsed.goal) {
        parsed = recoverMalformedAutoOutput(forced.content, text);
      }
      track.markDecision(parsed.action);
      const out = finalize({
        ...parsed,
        reason: "model_auto_tool_loop_cap_text",
        timing: track.finish(),
      });
      if (out.action === "reply" && out.content) {
        await pushReply(out.content);
      }
      return out;
    }
  } catch (err) {
    const status = Number(err?.status) || 0;
    const detail = String(err?.message || err || "");
    console.warn("[auto] tools path failed:", status, detail.slice(0, 240));
    const toolsUnsupported =
      status === 400 ||
      status === 404 ||
      status === 500 ||
      /tool/i.test(detail) ||
      /function/i.test(detail) ||
      /not support/i.test(detail) ||
      /provider returned error/i.test(detail);
    // Why: Gmail unread can still succeed via Composio without LLM tools.
    const mappedAfterFail = matchComposioIntent(text);
    if (mappedAfterFail && runtime?.composioApiKey) {
      try {
        return finalize(
          await runDeterministicComposioIntentTurn({
            runtime,
            userText: text,
            creds,
            onDelta: stream ? delta : undefined,
            track,
            spec: mappedAfterFail,
          })
        );
      } catch (err2) {
        console.warn("[auto] composio intent fallback after tools fail:", err2?.message || err2);
      }
    }
    if (!toolsUnsupported && status >= 500) throw err;
  }

  const fallback = await runChatAutoTurnTextFallback(
    {
      question,
      snapshot,
      creds,
      chatContext,
      stream,
      onDelta,
      jev: jevDecision,
      signal,
    },
    track
  );
  return finalize(fallback);
}

/**
 * Deterministic chat answer from agent dayLogs (no LLM).
 * Why: day-history Q&A was returning Mem0 pref fragments like “long scratchpads” instead of the log.
 * @param {object|null|undefined} snapshot
 * @param {string} [question]
 * @returns {string}
 */
export function formatDayHistoryChatAnswer(snapshot, question = "") {
  const today = new Date().toISOString().slice(0, 10);
  const q = String(question || "");
  const domainMatch = q.match(/\b([a-z0-9-]+(?:\.[a-z]{2,})(?:\.[a-z]{2,})?)\b/i);
  const needle = domainMatch ? domainMatch[1].toLowerCase() : "";

  const recent = Array.isArray(snapshot?.dayHistoryRecent) ? snapshot.dayHistoryRecent : [];
  const relevant = Array.isArray(snapshot?.dayHistoryRelevant)
    ? snapshot.dayHistoryRelevant
    : [];
  /** @type {object[]} */
  const pool = [];
  const seen = new Set();
  for (const d of [...relevant, ...recent]) {
    const key = `${d?.day || ""}|${String(d?.summary || "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(d);
  }
  const todayLogs = pool.filter((d) => String(d?.day || "") === today);
  const logs = todayLogs.length ? todayLogs : pool.slice(0, 2);
  if (!logs.length) {
    return needle
      ? `No — I don’t see ${needle} in day history yet (no notes recorded).`
      : "I don’t have day-history notes recorded yet. After a computer run finishes, a dated summary will show up here.";
  }

  /** @param {string} raw */
  function splitWorkItems(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    const bySep = text
      .split(/\n\s*---\s*\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (bySep.length > 1) return bySep;
    const bullets = text
      .split(/\n\s*•\s+/)
      .map((c) => c.replace(/^•\s*/, "").trim())
      .filter((c) => c.length > 8);
    if (bullets.length > 1) return bullets;
    return [text];
  }

  /** @param {string} item */
  function oneLine(item) {
    return String(item || "")
      .replace(/\s+/g, " ")
      .replace(/\s*—\s*goal:\s*.*$/i, "")
      .trim()
      .slice(0, 420);
  }

  /** @type {{ when: string, line: string, hay: string }[]} */
  const items = [];
  for (const d of logs) {
    const when = d?.at
      ? new Date(d.at).toISOString().replace("T", " ").slice(0, 19) + " UTC"
      : String(d?.day || "");
    for (const item of splitWorkItems(d?.detail || d?.summary || "")) {
      const line = oneLine(item);
      if (!line) continue;
      items.push({ when, line, hay: `${d?.day || ""} ${line}`.toLowerCase() });
    }
  }

  if (needle) {
    const hits = items.filter((it) => it.hay.includes(needle));
    if (!hits.length) {
      return `No — day history for ${todayLogs.length ? today : logs[0]?.day || "recent days"} does not mention ${needle}. (Answered from dayLogs — no computer run.)`;
    }
    const lines = [
      `Yes — day history mentions ${needle}:`,
      "",
      ...hits.slice(0, 8).map((it, i) => `${i + 1}. [${it.when}] ${it.line}`),
      "",
      "(From agent dayLogs — not a live browser run.)",
    ];
    return lines.join("\n");
  }

  const dayLabel = String(logs[0]?.day || today);
  /** @type {string[]} */
  const out = [`Here’s what day history shows for ${dayLabel}:`, ""];
  let n = 0;
  for (const it of items) {
    n += 1;
    out.push(`${n}. [${it.when}] ${it.line}`);
    if (n >= 12) break;
  }
  if (n === 0) {
    return `Day history for ${dayLabel} exists but has no readable summary yet.`;
  }
  out.push("");
  out.push("(From agent dayLogs — not a live browser run.)");
  return out.join("\n");
}

/**
 * Short social / chitchat that should stream text immediately (Hermes fast path).
 * Why: full tools schema + Mem0 makes “how are you” feel ~10s vs Hermes’ near-instant tokens.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeLightweightChat(text) {
  const q = String(text || "").trim();
  if (!q || q.length > 160) return false;
  if (looksLikeComposioAppRequest(q)) return false;
  if (looksLikeSendEmailRequest(q)) return false;
  if (looksLikeScheduleManageRequest(q)) return false;
  if (looksLikeLiveComputerJobRequest(q)) return false;
  if (looksLikeHybridCombo(q)) return false;
  if (looksLikeDayHistoryOrStatusRequest(q)) return false;
  if (looksLikeVagueChatFollowup(q)) return false;
  if (
    /^(how are you|how're you|how r you|how's it going|hows it going|how are things|how's everything|whats? up|sup|are you (there|ok|okay|well)|you (ok|okay|good)|feeling (ok|okay|good))\b/i.test(
      q
    )
  ) {
    return true;
  }
  // Short conversational turns without action / app verbs.
  if (
    q.length <= 72 &&
    !/\b(open|browse|click|fill|send|email|gmail|slack|notion|sheet|github|search|check my|run|queue|go to|navigate|composio|remember|forget|schedule|every \d|peer|@)\b/i.test(
      q
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Instant replies for greetings / thanks — skip LLM so “hi” is not a long Sending….
 * Why: never cheap-ack yes/ok/sure — those often confirm “Want me to open …?” and must reach Auto.
 * @param {string} question
 * @returns {string|null}
 */
export function cheapChatReplyIfAny(question) {
  const q = String(question || "").trim();
  if (!q || q.length > 64) return null;
  if (
    /^(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening))([!?.\s]*)$/i.test(q)
  ) {
    return "Hi — I'm here. Ask a question or send a computer goal.";
  }
  if (/^(thanks|thank you|thx|ty)([!?.\s]*)$/i.test(q)) {
    return "You're welcome.";
  }
  if (/^(what|huh|hmm+)([!?.\s]*)$/i.test(q)) {
    return "Could you clarify what you mean?";
  }
  return null;
}

/**
 * Short affirmation that often means “yes, run that” after an offer.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeAffirmativeConfirm(text) {
  const q = String(text || "").trim();
  if (!q || q.length > 48) return false;
  return /^(yes|yep|yeah|yup|sure|ok|okay|k|do it|go ahead|please|please do|go|proceed|do that|yes please|yes do it)([!?.\s]*)$/i.test(
    q
  );
}

/**
 * If the last assistant message offered to run a computer job, recover the prior user goal.
 * @param {{ role?: string, content?: string, _id?: unknown }[]} messages
 * @param {{ excludeIds?: string[] }} [opts]
 * @returns {string|null}
 */
export function resolveConfirmComputerGoalFromMessages(messages, opts = {}) {
  const exclude = new Set((opts.excludeIds || []).map((id) => String(id)));
  const rows = (Array.isArray(messages) ? messages : []).filter(
    (m) => m && !exclude.has(String(m._id || ""))
  );
  if (rows.length < 2) return null;

  // Newest first (by _id when present).
  const newestFirst = [...rows].sort((a, b) => {
    const aid = String(a._id || "");
    const bid = String(b._id || "");
    if (aid && bid) return bid.localeCompare(aid);
    return 0;
  });

  let lastAssistant = "";
  let priorUser = "";
  for (const m of newestFirst) {
    const role = String(m?.role || "");
    const content = String(m?.content || "").trim();
    if (!content) continue;
    if (!lastAssistant && (role === "assistant" || role === "agent")) {
      lastAssistant = content;
      continue;
    }
    if (lastAssistant && role === "user") {
      priorUser = content;
      break;
    }
  }
  if (!lastAssistant || !priorUser) return null;

  const offered =
    /\b(want me to|shall i|should i|do you want me to|ready for me to|i can open|i can (do|run|start)|open .+ for you)\b/i.test(
      lastAssistant
    ) ||
    /\b(do that now|start (it|now|the (computer|browser|run))|queue (it|that|a goal))\b/i.test(
      lastAssistant
    );
  if (!offered) return null;

  // Prefer the prior concrete browse ask; strip leading can-you politeness.
  const goal = String(priorUser)
    .replace(/^(please\s+)?(can|could|would|will)\s+you\s+/i, "")
    .replace(/^(please\s+)/i, "")
    .trim();
  if (!goal || goal.length < 4) return null;
  // Must look like a live job, not pure chitchat.
  const c = classifyMessageIntent(goal, {});
  if (
    c.intent === "goal" ||
    c.reason === "question_shaped_but_actionable" ||
    /\b(open|go to|navigate|visit|browse|check|log ?in)\b/i.test(goal)
  ) {
    return goal.slice(0, 2000);
  }
  return null;
}

/**
 * Stream a forced Answer-mode (memory Q&A) reply.
 * @param {{
 *   question: string,
 *   snapshot: object,
 *   creds: object,
 *   chatContext?: string,
 *   onDelta?: (chunk: string) => void,
 * }} opts
 * @returns {Promise<string>}
 */
export async function streamChatQuestion(opts) {
  const { question, snapshot, creds, chatContext = "", onDelta, signal = null } = opts;
  const context = formatAgentPrompt(snapshot);
  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  const messages = [
    {
      role: "system",
      content: [
        `You are “${agentName}”, an AI employee on YamBot. Never call yourself “YamBot”.`,
        "Do not introduce yourself or repeat your name in every reply — the UI already shows who is speaking. Only say your name when the human asks who you are.",
        "Do not address the human by name every turn unless it fits naturally.",
        "Never append lines like “AGENT NAME: …” to your replies.",
        "This is Q&A mode — you are NOT controlling the computer right now.",
        "Use the agent profile, USER PROFILE, MEMORY, day history, saved logins, and chat session context.",
        "USER PROFILE (Settings → Memory) is authoritative for tone/identity. If it is empty or says none, ignore old rude/tone prefs from chat history.",
        "If the user needs browsing, peers, or fan-out, tell them briefly that Auto/Computer mode will run it — but still answer what you can from memory.",
        "Be concise. Plain prose only — no tool JSON, no finish, no <think> tags.",
        "",
        context || "(no extra agent context)",
        thread ? `\n\n${thread}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user", content: String(question || "").slice(0, 4000) },
  ];

  const raw = await llmChatCompletionStream(
    {
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 60_000,
      messages,
      signal: signal || null,
    },
    onDelta
  );
  return stripModelThinking(raw) || "I could not draft an answer.";
}
