/**
 * @fileoverview Hermes-style Auto chat turn — model picks from YamBot chat tools.
 * Purpose: reply / queue_goal (+ optional status/peer lookups); harden malformed output,
 * default queue acks, and stream→non-stream recovery. Downstream: chats.js Auto mode only.
 * When AI_GATEWAY_API_KEY is set, Jev (Vercel AI Gateway) decides reply vs queue_goal first;
 * confident choices short-circuit; uncertain falls through to the LLM with a Jev hint.
 */

import { llmChatCompletion, llmChatCompletionMessage, llmChatCompletionStream } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";
import {
  classifyMessageIntent,
  looksLikeMemoryStoreRequest,
  looksLikeDayHistoryOrStatusRequest,
  looksLikeVagueChatFollowup,
} from "./messageIntent.js";
import { classifyAutoActionWithJev, isJevEnabled } from "./jevEvaluate.js";

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
        "Answer in chat from memory, day history, profile, or knowledge. Use for questions (including past browse: did we open X today?), memory-store, and capability asks. Do NOT use when the user wants a live browse/run right now.",
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
        "Start the cloud computer / peer workers for a LIVE job NOW (open a site, click/fill, send mail, message peers). Do NOT use for past-work questions (did we open X today?), memory-store, or capability questions — use reply instead.",
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
];

/** Max model↔tool rounds in one Auto message (lookups + final reply/queue). */
export const AUTO_CHAT_MAX_TOOL_ROUNDS = 3;

/**
 * @returns {{
 *   markFirstToken: () => void,
 *   markDecision: (action: string) => void,
 *   addLookup: (name: string) => void,
 *   setPath: (path: string) => void,
 *   setToolRounds: (n: number) => void,
 *   wrapOnDelta: (onDelta?: (chunk: string) => void) => ((chunk: string) => void)|undefined,
 *   finish: (extra?: object) => object,
 * }}
 */
export function createAutoTimingTracker() {
  const t0 = Date.now();
  /** @type {number|null} */
  let firstTokenMs = null;
  /** @type {number|null} */
  let decisionMs = null;
  /** @type {string|null} */
  let decisionAction = null;
  /** @type {string[]} */
  const lookups = [];
  let toolRounds = 0;
  let path = "unknown";

  return {
    markFirstToken() {
      if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
    },
    markDecision(action) {
      if (decisionMs == null) {
        decisionMs = Date.now() - t0;
        decisionAction = String(action || "");
      }
    },
    addLookup(name) {
      lookups.push(String(name || "lookup"));
    },
    setPath(p) {
      path = String(p || path);
    },
    setToolRounds(n) {
      toolRounds = Math.max(0, Number(n) || 0);
    },
    wrapOnDelta(onDelta) {
      if (typeof onDelta !== "function") return undefined;
      return (chunk) => {
        if (String(chunk || "").length) this.markFirstToken();
        onDelta(chunk);
      };
    },
    finish(extra = {}) {
      const totalMs = Date.now() - t0;
      return {
        totalMs,
        firstTokenMs,
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
 * User asked to actually send mail (not just draft).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSendEmailRequest(text) {
  const s = String(text || "").trim();
  if (!s) return false;
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
  if (looksLikeSendEmailRequest(userText)) {
    if (!emailConfigured) {
      return {
        action: "reply",
        content:
          "I can’t send mail until this agent’s Email / SMTP settings are filled in (from address, SMTP host, user, password). Add them on the agent page, then ask me to send again.",
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

  // Why: teach-prefs with URLs must never become a Chromium goal — even if the model mis-queues.
  if (action === "queue_goal" && looksLikeMemoryStoreRequest(userText)) {
    return {
      action: "reply",
      content:
        content ||
        "Got it — I’ll remember those preferences for this agent. No computer run started.",
      goal: "",
      ack: "",
      reason: `${reason}_memory_store_forced_reply`,
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
 * Classify the first tool call in a batch.
 * @param {{ id: string, name: string, arguments: string }} tc
 * @returns {"reply"|"queue_goal"|"check_run_status"|"list_peer_agents"|"unknown"}
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
  return "unknown";
}

/**
 * Run one non-terminal Auto tool via runtime callbacks.
 * @param {string} kind
 * @param {{
 *   checkRunStatus?: () => Promise<object|string>,
 *   listPeerAgents?: () => Promise<object|string>,
 * }} [runtime]
 * @returns {Promise<string>}
 */
export async function executeAutoLookupTool(kind, runtime = {}) {
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
 * Whether Auto should skip the model and queue the computer immediately.
 * Why (Hermes-style): the LLM normally decides reply vs queue_goal. Only force-queue
 * for send-mail / peer fan-out — URL/domain / browse verbs go to the model with a hint.
 * Hard chat vetoes (day-history, memory-store) still run earlier in runChatAutoTurn.
 * @param {string} text
 * @returns {"queue_goal"|"model"}
 */
export function autoTurnHeuristicGate(text) {
  const c = classifyMessageIntent(text, {});
  // Why: teach-prefs / day-history / vague — model path (or earlier forced chat), never skip-to-queue.
  if (c.reason === "memory_store_request") return "model";
  if (c.reason === "day_history_or_status" || c.reason === "vague_chat_followup") return "model";
  // Why: send + peer are unambiguous worker jobs — skip LLM latency.
  if (c.reason === "send_email_from_context") return "queue_goal";
  if (c.reason === "peer_a2a_or_fanout" || c.reason === "peer_a2a_overrides_ask") {
    return "queue_goal";
  }
  // Why: concrete live browse/open jobs — queue now (avoid “Want me to?” then cheap “yes”).
  // Day-history / memory-store already returned “model” above.
  if (
    c.intent === "goal" &&
    (c.reason === "question_shaped_but_actionable" ||
      c.reason === "has_url_or_domain" ||
      c.reason === "explicit_task")
  ) {
    return "queue_goal";
  }
  // Why: has_url_or_domain / explicit_task used to force-queue and mis-fired on
  // “did we open nseindia.com today?” — LLM decides with classifier hint instead.
  return "model";
}

/**
 * Soft classifier note injected into the Auto user message so the LLM sees the gate signal.
 * Why: heuristics alone mis-routed; the model needs an explicit REPLY vs QUEUE_GOAL checklist.
 * @param {string} text
 * @param {{ jev?: { action?: string, choice?: string, confidence?: number, reason?: string }|null }} [opts]
 * @returns {string}
 */
export function formatAutoClassifierHint(text, opts = {}) {
  const c = classifyMessageIntent(text, {});
  const reason = String(c.reason || "unknown");
  const intent = String(c.intent || "unknown");
  /** @type {string[]} */
  const lines = [
    "[AUTO DECISION HINT — not user text]",
    `classifier_intent=${intent}; classifier_reason=${reason}`,
  ];
  const jev = opts.jev;
  if (jev && (jev.action || jev.choice || jev.reason)) {
    lines.push(
      `jev_action=${String(jev.action || "uncertain")}; jev_choice=${String(jev.choice || "")}; jev_confidence=${Number(jev.confidence || 0).toFixed(2)}; jev_reason=${String(jev.reason || "")}`
    );
    if (jev.action === "reply") {
      lines.push("Jev prefers REPLY — answer in chat unless the user clearly demands a live computer job.");
    } else if (jev.action === "queue_goal") {
      lines.push("Jev prefers QUEUE_GOAL — start the computer / peers if the message is a live job.");
    } else if (jev.reason === "jev_error") {
      lines.push("Jev unavailable — YOU decide REPLY vs QUEUE_GOAL. Prefer REPLY when unsure.");
    }
  }
  if (reason === "day_history_or_status" || reason === "vague_chat_followup") {
    lines.push(
      "Prefer REPLY. This looks like a past-work / status question — answer from day history or chat. Do NOT start a live computer."
    );
  } else if (reason === "memory_store_request") {
    lines.push(
      "Prefer REPLY. User is teaching preferences/facts (URLs in the list are credentials/bookmarks, not a browse job)."
    );
  } else if (reason === "has_url_or_domain" || reason === "explicit_task") {
    lines.push(
      "A URL/domain or task verb was detected. QUEUE_GOAL only if they want a live browse/run RIGHT NOW (open/go to/check this site, click, fill, submit).",
      "Prefer REPLY if they ask about the past (did we open… today?), capability, planning, or memory — naming a domain is not enough to start Chromium."
    );
  } else if (reason === "capability_question") {
    lines.push("Prefer REPLY — capability/policy question; do not queue until they name a concrete live job.");
  } else {
    lines.push(
      "YOU decide: REPLY = answer in chat; QUEUE_GOAL = start cloud computer / peers. Prefer REPLY when unsure."
    );
  }
  lines.push("[END AUTO DECISION HINT]");
  return lines.join("\n");
}

/**
 * User payload for Auto LLM: classifier hint + real message.
 * @param {string} text
 * @param {{ jev?: object|null }} [opts]
 * @returns {string}
 */
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
    "=== DECISION: REPLY vs QUEUE_GOAL (you own this choice) ===",
    "Read the [AUTO DECISION HINT] on the user message, then decide.",
    "",
    "QUEUE_GOAL / queue_goal — only when they want a LIVE computer or peers NOW:",
    "- Imperative browse: open/go to/navigate/visit a site, click, fill, submit, log in (now)",
    "- Live research that needs browsing this turn",
    "- Peer message / fan-out / handoff",
    "- Send/deliver mail, download, change something external",
    "- NEVER turn an email address into a https:// URL",
    "",
    "REPLY / reply — answer in chat (no Chromium):",
    "- Questions about the past: “did we open X today?”, “what we did”, timestamps, day history, status",
    "- MEMORY STORE / remember preferences (URLs in the list are facts, not a browse job)",
    "- Capability / policy (“can you open websites?”) — do not queue until they name a concrete live job",
    "- Greetings, explanations, planning, drafts (draft=REPLY; send=QUEUE_GOAL)",
    "- Naming a domain in a question is NOT enough — only start the computer for a live action",
    "",
    "Hermes-style: YOU decide. Prefer REPLY when unsure. A domain/URL alone ≠ start computer.",
    "",
    "SEND MAIL RULES:",
    "- Draft = REPLY. Send/deliver = QUEUE_GOAL.",
    "- When EMAIL IDENTITY / SMTP is configured, the worker must use send_email actions (to/subject/text) — not Gmail compose and not navigate.",
    "- Copy recipient addresses from RECENT MESSAGES. Do not invent URLs from local-parts (e.g. never open https://alex.parker.demo/).",
    "",
    "Do not invent credentials. Prefer reply when unsure unless they clearly need browsing or peers.",
    "USER PROFILE (Settings → Memory) is authoritative for tone/identity. If that block is empty or says none, ignore old tone prefs from chat history.",
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
  track.setPath("text_fallback");
  const { question, snapshot, creds, chatContext = "", stream = false, onDelta, jev = null } = opts;
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
  };

  const delta = track.wrapOnDelta(onDelta);
  let raw;
  let usedStream = false;
  if (stream && typeof delta === "function") {
    usedStream = true;
    let buf = "";
    let emitted = 0;
    raw = await llmChatCompletionStream(llmOpts, (chunk) => {
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
  if (
    normalized.action === "reply" &&
    normalized.content &&
    typeof delta === "function" &&
    !usedStream
  ) {
    delta(normalized.content);
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
    runtime = {},
    jevMode = "auto",
  } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  const track = createAutoTimingTracker();
  const delta = track.wrapOnDelta(onDelta);
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
    // Why: lab A/B needs the raw Jev decision alongside the normalized turn.
    if (partial?.jev) out.jev = partial.jev;
    out.jevMode = String(jevMode || "auto");
    return out;
  };

  // Why: send-mail follow-ups skip the model and build a hardened send_email goal from chat.
  if (looksLikeSendEmailRequest(text)) {
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
      if (stream && typeof delta === "function" && content) {
        delta(content);
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

  if (autoTurnHeuristicGate(text) === "queue_goal") {
    track.setPath("heuristic");
    track.markDecision("queue_goal");
    return finalize({
      action: "queue_goal",
      content: "",
      goal: text,
      ack: "",
      reason: "heuristic_queue_goal",
      timing: track.finish(),
    });
  }

  const jevModeNorm = String(jevMode || "auto").trim().toLowerCase() || "auto";
  /** @type {Awaited<ReturnType<typeof classifyAutoActionWithJev>>|null} */
  let jevDecision = null;
  if (isJevEnabled(jevModeNorm)) {
    jevDecision = await classifyAutoActionWithJev(text, { jevMode: jevModeNorm });
    if (jevDecision.action === "queue_goal") {
      track.setPath("jev");
      track.markDecision("queue_goal");
      return finalize({
        action: "queue_goal",
        content: "",
        goal: text,
        ack: "",
        reason: `jev_queue_goal:${Number(jevDecision.confidence || 0).toFixed(2)}`,
        timing: track.finish(),
        jev: jevDecision,
      });
    }
    if (jevDecision.action === "reply") {
      track.setPath("jev_reply");
      track.markDecision("reply");
      const content = await streamChatQuestion({
        question: text,
        snapshot,
        creds,
        chatContext,
        onDelta: stream ? delta : undefined,
      });
      return finalize({
        action: "reply",
        content: content || "Got it.",
        goal: "",
        ack: "",
        reason: `jev_reply:${Number(jevDecision.confidence || 0).toFixed(2)}`,
        timing: track.finish(),
        jev: jevDecision,
      });
    }
    // uncertain — keep jevDecision for classifier hint on the LLM path
  } else if (jevModeNorm === "off") {
    jevDecision = {
      ok: false,
      action: "uncertain",
      choice: "",
      confidence: 0,
      probabilities: {},
      reason: "jev_disabled",
    };
  }

  // Why: when the client wants a live bubble, stream REPLY/QUEUE_GOAL text immediately.
  // Native tools are non-streaming and left “Sending…” blank for the whole LLM wait.
  // Keep tools for status/peer questions (need the lookup loop) or non-stream calls.
  const wantsLookup =
    /\b(status|running|busy|pending|peers?|managed agents?|who can you (message|ask)|list (your )?peers)\b/i.test(
      text
    );
  if (stream && !wantsLookup) {
    return finalize(
      await runChatAutoTurnTextFallback(
        {
          question,
          snapshot,
          creds,
          chatContext,
          stream: true,
          onDelta,
          jev: jevDecision,
        },
        track
      )
    );
  }

  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  /** @type {object[]} */
  const messages = [
    {
      role: "system",
      content: buildAutoSystemPrompt(snapshot, agentName, thread, "tools"),
    },
    { role: "user", content: buildAutoUserContent(text, { jev: jevDecision }) },
  ];

  try {
    track.setPath("tools");
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
        toolChoice: "auto",
      });

      const terminal = parseAutoToolCalls(msg.toolCalls);
      if (terminal) {
        track.markDecision(terminal.action);
        const out = finalize({
          ...terminal,
          reason: round === 0 ? "model_auto_tool_call" : "model_auto_tool_loop",
          timing: track.finish(),
        });
        if (out.action === "reply" && out.content && typeof delta === "function") {
          delta(out.content);
        }
        return out;
      }

      const lookups = (msg.toolCalls || []).filter((tc) => {
        const kind = classifyAutoToolName(tc);
        return kind === "check_run_status" || kind === "list_peer_agents";
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
          const resultText = await executeAutoLookupTool(kind, runtime);
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: resultText.slice(0, 4000),
          });
        }
        continue;
      }

      if (msg.content) {
        let parsed = parseAutoTurnOutput(msg.content, text);
        if (!parsed.content && !parsed.goal) {
          parsed = recoverMalformedAutoOutput(msg.content, text);
        }
        track.markDecision(parsed.action);
        const out = finalize({
          ...parsed,
          reason: "model_auto_turn_after_tools",
          timing: track.finish(),
        });
        if (out.action === "reply" && out.content && typeof delta === "function") {
          delta(out.content);
        }
        return out;
      }

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
    });
    const term = parseAutoToolCalls(forced.toolCalls);
    if (term) {
      track.markDecision(term.action);
      const out = finalize({
        ...term,
        reason: "model_auto_tool_loop_cap",
        timing: track.finish(),
      });
      if (out.action === "reply" && out.content && typeof delta === "function") {
        delta(out.content);
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
      if (out.action === "reply" && out.content && typeof delta === "function") {
        delta(out.content);
      }
      return out;
    }
  } catch (err) {
    const status = Number(err?.status) || 0;
    const detail = String(err?.message || err || "");
    const toolsUnsupported =
      status === 400 ||
      status === 404 ||
      /tool/i.test(detail) ||
      /function/i.test(detail) ||
      /not support/i.test(detail);
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
  const { question, snapshot, creds, chatContext = "", onDelta } = opts;
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
    },
    onDelta
  );
  return stripModelThinking(raw) || "I could not draft an answer.";
}
