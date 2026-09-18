/**
 * @fileoverview Hermes-style Auto chat turn — one model call decides reply vs queue_goal.
 * Purpose: Skip the separate intent-classifier LLM; the conversational model either answers
 * or asks the runtime to enqueue a computer/A2A goal (like Hermes tool selection).
 * Downstream: chats.js POST /messages (Auto mode).
 */

import { llmChatCompletion, llmChatCompletionStream } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";
import { classifyMessageIntent } from "./messageIntent.js";

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
    // Freeform prose — stream as-is once we have enough that it is not a short header.
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
 * One Auto turn: model (or heuristic) chooses reply vs queue_goal.
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

  const context = formatAgentPrompt(snapshot);
  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const system = [
    `You are “${agentName}”, an AI employee on YamBot. Always introduce and refer to yourself as ${agentName} — never call yourself “YamBot”.`,
    "",
    "Hermes-style turn: you either ANSWER in chat OR ask the runtime to QUEUE a computer/peer goal.",
    "You are NOT controlling the browser in this turn. Queuing starts a cloud computer / A2A workers.",
    "",
    "Choose QUEUE_GOAL when the user wants you to:",
    "- open/navigate/click/fill a website or use the live computer",
    "- message/ask peers, fan-out, soft-wait, handoff (message_agent)",
    "- do live research that needs browsing right now",
    "- change something external (send mail, download, submit forms)",
    "",
    "Choose REPLY when you can answer from conversation, profile, memory, or stable knowledge:",
    "- greetings, thanks, status from memory",
    "- explanations, code examples, planning advice",
    "- questions that do not require opening a site or peers",
    "",
    "Output format (strict):",
    "Option A — direct answer:",
    "REPLY",
    "<plain prose for the user — no tool JSON>",
    "",
    "Option B — need the computer / peers:",
    "QUEUE_GOAL",
    "goal: <exact instructions for the worker>",
    "ack: <optional one short sentence to the user>",
    "",
    "Do not invent credentials. Prefer REPLY when unsure unless they clearly need browsing or peers.",
    "",
    context || "(no extra agent context)",
    thread ? `\n\n${thread}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: system },
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
  return { ...parsed, reason: "model_auto_turn" };
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
