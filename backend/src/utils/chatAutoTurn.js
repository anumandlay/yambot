/**
 * @fileoverview Hermes-style Auto chat turn — model picks from YamBot chat tools.
 * Purpose: reply / queue_goal (+ optional status/peer lookups in a short loop); text fallback.
 * Downstream: chats.js POST /messages (Auto mode only — does not change worker/A2A).
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
            description: "Optional one short sentence shown to the user while the goal queues.",
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
  const s = String(rawArgs || "").trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    // Why: some providers wrap args or emit trailing commas — try a loose object extract.
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
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
 * @returns {{ action: "reply"|"queue_goal", content: string, goal: string, ack: string }}
 */
export function parseAutoTurnOutput(raw) {
  const cleaned = stripModelThinking(String(raw || "")).trim();
  if (!cleaned) {
    return { action: "reply", content: "", goal: "", ack: "" };
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
      return { action: "reply", content: content || cleaned, goal: "", ack: "" };
    } catch {
      /* fall through */
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
    return { action: "reply", content: body || cleaned, goal: "", ack: "" };
  }

  return { action: "reply", content: cleaned, goal: "", ack: "" };
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
    `You are “${agentName}”, an AI employee on YamBot. Always introduce and refer to yourself as ${agentName} — never call yourself “YamBot”.`,
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
    "<plain prose for the user — no tool JSON>",
    "",
    "Option B — need the computer / peers:",
    "QUEUE_GOAL",
    "goal: <exact instructions for the worker>",
    "ack: <optional one short sentence to the user>",
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
  if (stream && typeof delta === "function") {
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
  } else {
    raw = await llmChatCompletion(llmOpts);
  }

  const parsed = parseAutoTurnOutput(raw);
  track.markDecision(parsed.action);
  if (parsed.action === "reply" && parsed.content && typeof delta === "function" && !stream) {
    delta(parsed.content);
  }
  return { ...parsed, reason: "model_auto_turn_text", timing: track.finish() };
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

  if (autoTurnHeuristicGate(text) === "queue_goal") {
    track.setPath("heuristic");
    track.markDecision("queue_goal");
    return {
      action: "queue_goal",
      content: "",
      goal: text,
      ack: "",
      reason: "heuristic_queue_goal",
      timing: track.finish(),
    };
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
        if (terminal.action === "reply" && terminal.content && typeof delta === "function") {
          delta(terminal.content);
        }
        return {
          ...terminal,
          reason: round === 0 ? "model_auto_tool_call" : "model_auto_tool_loop",
          timing: track.finish(),
        };
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
        const parsed = parseAutoTurnOutput(msg.content);
        track.markDecision(parsed.action);
        if (parsed.action === "reply" && parsed.content && typeof delta === "function") {
          delta(parsed.content);
        }
        return { ...parsed, reason: "model_auto_turn_after_tools", timing: track.finish() };
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
      if (term.action === "reply" && term.content && typeof delta === "function") {
        delta(term.content);
      }
      return { ...term, reason: "model_auto_tool_loop_cap", timing: track.finish() };
    }
    if (forced.content) {
      const parsed = parseAutoTurnOutput(forced.content);
      track.markDecision(parsed.action);
      if (parsed.action === "reply" && parsed.content && typeof delta === "function") {
        delta(parsed.content);
      }
      return { ...parsed, reason: "model_auto_tool_loop_cap_text", timing: track.finish() };
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

  return runChatAutoTurnTextFallback(
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
        `You are “${agentName}”, an AI employee on YamBot. Always introduce and refer to yourself as ${agentName} — never call yourself “YamBot”.`,
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
