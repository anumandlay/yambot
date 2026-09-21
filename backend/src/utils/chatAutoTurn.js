/**
 * @fileoverview Hermes-style Auto chat turn — model picks from YamBot chat tools.
 * Purpose: reply / queue_goal (+ optional status/peer lookups); harden malformed output,
 * default queue acks, and stream→non-stream recovery. Downstream: chats.js Auto mode only.
 */

import { llmChatCompletion, llmChatCompletionMessage, llmChatCompletionStream } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";
import { classifyMessageIntent } from "./messageIntent.js";

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
        "Answer the user in chat from memory, profile, or stable knowledge. Do NOT use for browsing, opening sites, or messaging peer agents.",
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
        "Queue a cloud computer / peer-agent goal (Playwright or message_agent). Use when the user needs browsing, live web work, fan-out, soft-wait, or handoff.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "Exact instructions for the worker / peer run.",
          },
          ack: {
            type: "string",
            description:
              "Optional real short status sentence shown to the user while the goal queues. Never use angle-bracket placeholders.",
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
 * Strip protocol headers / tool-call junk / leaked placeholders from user-visible reply text.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeAutoReplyContent(text) {
  let s = stripModelThinking(String(text || "")).trim();
  if (!s) return "";
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
  return s;
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
  if (!preview) return `Starting ${who}’s computer now.`;
  return `Starting ${who}’s computer: ${preview}`;
}

/**
 * Runtime validation after model proposes reply/queue_goal.
 * Why: never trust empty goals, leaked headers, or unknown actions.
 * @param {{ action?: string, content?: string, goal?: string, ack?: string, reason?: string, timing?: object }} result
 * @param {{ userText?: string, agentName?: string }} [ctx]
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string, timing?: object }}
 */
export function ensureAutoTurnResult(result, ctx = {}) {
  const userText = String(ctx.userText || "").trim();
  const agentName = String(ctx.agentName || "Agent").trim() || "Agent";
  const reason = String(result?.reason || "normalized").trim() || "normalized";
  let action =
    result?.action === "queue_goal" || result?.action === "goal" || result?.action === "run"
      ? "queue_goal"
      : "reply";

  let content = sanitizeAutoReplyContent(result?.content || "");
  let goal = String(result?.goal || "").replace(/\s+/g, " ").trim();
  let ack = sanitizeAutoReplyContent(result?.ack || "");
  // Why: never queue literal template text like "<exact instructions for the worker>".
  if (isPromptPlaceholder(goal)) goal = "";

  if (action === "queue_goal") {
    if (!goal) goal = userText;
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
    content =
      "I am here. Ask a question, or send a computer goal (open a site, ask peers, etc.).";
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

  if (/"name"\s*:\s*"reply"|REPLY\b/i.test(cleaned)) {
    const contentMatch =
      cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/i) ||
      cleaned.match(/^REPLY\s*\n+([\s\S]+)/i);
    let content = contentMatch ? contentMatch[1] : cleaned;
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
 * Cheap pre-gate: strong browser/peer signals queue immediately.
 * @param {string} text
 * @returns {"queue_goal"|"model"}
 */
export function autoTurnHeuristicGate(text) {
  const c = classifyMessageIntent(text, {});
  if (
    c.reason === "peer_a2a_or_fanout" ||
    c.reason === "peer_a2a_overrides_ask" ||
    c.reason === "has_url_or_domain" ||
    c.reason === "action_verbs" ||
    c.reason === "explicit_task" ||
    c.reason === "question_shaped_but_actionable"
  ) {
    return "queue_goal";
  }
  if (c.intent === "goal" && c.confidence >= 0.9) return "queue_goal";
  return "model";
}

/**
 * Visible reply text to stream from a partial buffer (strips REPLY header once seen).
 * @param {string} buf
 * @returns {{ visible: string, mode: "reply"|"queue_goal"|"pending" }}
 */
function streamVisibleFromBuffer(buf) {
  const nl = buf.indexOf("\n");
  if (nl === -1) {
    const head = buf.trim().toUpperCase().replace(/[^A-Z_]/g, "");
    if (head === "QUEUE_GOAL" || head === "GOAL" || head === "RUN") {
      return { visible: "", mode: "queue_goal" };
    }
    if (head === "REPLY" || head === "ANSWER") {
      return { visible: "", mode: "pending" };
    }
    if (buf.length >= 12) return { visible: buf, mode: "reply" };
    return { visible: "", mode: "pending" };
  }
  const first = buf.slice(0, nl).trim().toUpperCase().replace(/[^A-Z_]/g, "");
  const rest = buf.slice(nl + 1);
  if (first === "QUEUE_GOAL" || first === "GOAL" || first === "RUN") {
    return { visible: "", mode: "queue_goal" };
  }
  if (first === "REPLY" || first === "ANSWER") {
    return { visible: rest, mode: "reply" };
  }
  return { visible: buf, mode: "reply" };
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
    "Use queue_goal / QUEUE_GOAL when the user wants:",
    "- open/navigate/click/fill a website or use the live computer",
    "- message/ask peers, fan-out, soft-wait, handoff (message_agent)",
    "- live research that needs browsing right now",
    "- change something external (send mail, download, submit forms)",
    "",
    "Use reply / REPLY when you can answer from conversation, profile, memory, or stable knowledge:",
    "- greetings, thanks, status from memory",
    "- explanations, code examples, planning advice",
    "- questions that do not require opening a site or peers",
    "- hypothetical / policy questions (what if…, what would you do if…, if I don’t give details…) — answer from memory; do NOT queue the computer",
    "",
    "Do not invent credentials. Prefer reply when unsure unless they clearly need browsing or peers.",
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
    "goal: concrete worker instructions (never copy this label's example text)",
    "ack: optional short status for the user (real words only; omit ack if unsure)",
    "Example:",
    "QUEUE_GOAL",
    "goal: Log into Vughy admin and open Trial expiring list for India",
    "ack: On it — starting the computer now.",
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
  const { question, snapshot, creds, chatContext = "", stream = false, onDelta } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const messages = [
    {
      role: "system",
      content: buildAutoSystemPrompt(snapshot, agentName, thread, "text"),
    },
    { role: "user", content: text.slice(0, 4000) },
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
    { userText: text, agentName }
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
  } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
  const track = createAutoTimingTracker();
  const delta = track.wrapOnDelta(onDelta);
  const finalize = (partial) =>
    ensureAutoTurnResult(
      { ...partial, timing: partial.timing || track.finish() },
      { userText: text, agentName }
    );

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
    { role: "user", content: text.slice(0, 4000) },
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
    },
    track
  );
  return finalize(fallback);
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
