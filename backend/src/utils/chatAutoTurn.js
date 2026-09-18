/**
 * @fileoverview Hermes-style Auto chat turn — one model call decides reply vs queue_goal.
 * Purpose: Skip the separate intent-classifier LLM; expose YamBot chat tools (reply / queue_goal)
 * like Hermes tool selection, with REPLY/QUEUE_GOAL text fallback for providers without tools.
 * Downstream: chats.js POST /messages (Auto mode only — does not change worker/A2A).
 */

import { llmChatCompletion, llmChatCompletionMessage, llmChatCompletionStream } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";
import { classifyMessageIntent } from "./messageIntent.js";

/**
 * OpenAI-compatible tool schemas for Auto chat (YamBot-only surface).
 * Why: model proposes; runtime validates and either posts chat text or enqueues a computer goal.
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
];

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
 * Map native tool_calls into Auto turn result.
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
      "Call exactly one tool: reply OR queue_goal. Do not invent other tool names.",
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
 * @returns {Promise<{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string }>}
 */
async function runChatAutoTurnTextFallback(opts) {
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

  let raw;
  if (stream && typeof onDelta === "function") {
    let buf = "";
    let emitted = 0;
    raw = await llmChatCompletionStream(llmOpts, (chunk) => {
      buf += chunk;
      const { visible, mode } = streamVisibleFromBuffer(buf);
      if (mode === "queue_goal") return;
      if (visible.length > emitted) {
        onDelta(visible.slice(emitted));
        emitted = visible.length;
      }
    });
  } else {
    raw = await llmChatCompletion(llmOpts);
  }

  const parsed = parseAutoTurnOutput(raw);
  return { ...parsed, reason: "model_auto_turn_text" };
}

/**
 * One Auto turn: native tools first, then REPLY/QUEUE_GOAL text fallback.
 * @param {{
 *   question: string,
 *   snapshot: object,
 *   creds: { apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string },
 *   chatContext?: string,
 *   stream?: boolean,
 *   onDelta?: (chunk: string) => void,
 * }} opts
 * @returns {Promise<{ action: "reply"|"queue_goal", content: string, goal: string, ack: string, reason: string }>}
 */
export async function runChatAutoTurn(opts) {
  const { question, snapshot, creds, chatContext = "", stream = false, onDelta } = opts;
  const text = String(question || "").trim();
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";

  if (autoTurnHeuristicGate(text) === "queue_goal") {
    return {
      action: "queue_goal",
      content: "",
      goal: text,
      ack: "",
      reason: "heuristic_queue_goal",
    };
  }

  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const toolMessages = [
    {
      role: "system",
      content: buildAutoSystemPrompt(snapshot, agentName, thread, "tools"),
    },
    { role: "user", content: text.slice(0, 4000) },
  ];

  try {
    const msg = await llmChatCompletionMessage({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 60_000,
      messages: toolMessages,
      tools: AUTO_CHAT_TOOLS,
      toolChoice: "auto",
    });

    const fromTools = parseAutoToolCalls(msg.toolCalls);
    if (fromTools) {
      if (fromTools.action === "reply" && fromTools.content && typeof onDelta === "function") {
        onDelta(fromTools.content);
      }
      return { ...fromTools, reason: "model_auto_tool_call" };
    }

    // Provider accepted tools but returned prose — parse text protocol from content.
    if (msg.content) {
      const parsed = parseAutoTurnOutput(msg.content);
      if (parsed.action === "reply" && parsed.content && typeof onDelta === "function") {
        onDelta(parsed.content);
      }
      return { ...parsed, reason: "model_auto_turn_after_tools" };
    }
  } catch (err) {
    // Why: many YamBot LLM providers reject tools — fall back without failing the chat.
    const status = Number(err?.status) || 0;
    const detail = String(err?.message || err || "");
    const toolsUnsupported =
      status === 400 ||
      status === 404 ||
      /tool/i.test(detail) ||
      /function/i.test(detail) ||
      /not support/i.test(detail);
    if (!toolsUnsupported && status >= 500) throw err;
    // continue to text fallback
  }

  return runChatAutoTurnTextFallback({
    question,
    snapshot,
    creds,
    chatContext,
    stream,
    onDelta,
  });
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
