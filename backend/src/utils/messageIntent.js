/**
 * @fileoverview Classify chat messages as browser goals vs Q&A questions.
 * Purpose: Skip spinning the agent computer when the user only asked a question.
 * Downstream: backend/src/routes/chats.js POST /messages.
 */

import { llmChatCompletion } from "./llmChat.js";
import { formatAgentPrompt } from "../models/Agent.js";

/**
 * @param {string} text
 * @returns {string}
 */
export function stripIntentOverrides(text) {
  return String(text || "")
    .replace(/^\/run\b\s*/i, "")
    .replace(/^\/ask\b\s*/i, "")
    .replace(/^goal:\s*/i, "")
    .replace(/^question:\s*/i, "")
    .trim();
}

/**
 * Heuristic + override classification (no LLM).
 * @param {string} text
 * @param {{
 *   forceGoal?: boolean,
 *   forceAsk?: boolean,
 *   hasSkillSlash?: boolean,
 * }} [opts]
 * @returns {{ intent: "goal"|"question"|"ambiguous", confidence: number, reason: string, text: string }}
 */
export function classifyMessageIntent(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { intent: "goal", confidence: 1, reason: "empty", text: "" };
  }

  if (opts.forceGoal) {
    return {
      intent: "goal",
      confidence: 1,
      reason: "force_goal",
      text: stripIntentOverrides(raw),
    };
  }
  if (opts.forceAsk) {
    return {
      intent: "question",
      confidence: 1,
      reason: "force_ask",
      text: stripIntentOverrides(raw),
    };
  }
  if (opts.hasSkillSlash) {
    return {
      intent: "goal",
      confidence: 1,
      reason: "skill_slash",
      text: stripIntentOverrides(raw),
    };
  }

  if (/^\/run\b/i.test(raw) || /^goal:\s*/i.test(raw)) {
    return {
      intent: "goal",
      confidence: 1,
      reason: "override_run",
      text: stripIntentOverrides(raw),
    };
  }
  if (/^\/ask\b/i.test(raw) || /^question:\s*/i.test(raw)) {
    return {
      intent: "question",
      confidence: 1,
      reason: "override_ask",
      text: stripIntentOverrides(raw),
    };
  }

  const cleaned = stripIntentOverrides(raw);
  const lower = cleaned.toLowerCase();

  // Strong goal signals — always use the computer.
  if (/https?:\/\//i.test(cleaned) || /\b[\w-]+\.(com|io|net|org|co|ai|app)\b/i.test(cleaned)) {
    return { intent: "goal", confidence: 0.92, reason: "has_url_or_domain", text: cleaned };
  }
  if (
    /\b(go to|navigate|open (the )?site|log ?in|sign (in|up)|click|fill|type into|book|buy|purchase|scrape|download|upload|submit|register|create account|check my|on the (site|page|website))\b/i.test(
      lower
    )
  ) {
    return { intent: "goal", confidence: 0.9, reason: "action_verbs", text: cleaned };
  }
  if (
    /\b(please )?(do|run|start|execute|perform|complete|finish)\b.+\b(task|goal|workflow|job)\b/i.test(
      lower
    )
  ) {
    return { intent: "goal", confidence: 0.88, reason: "explicit_task", text: cleaned };
  }

  // Strong question signals — answer without the computer.
  const endsWithQuestion = /\?\s*$/.test(cleaned);
  const interrogativeStart =
    /^(what|why|how|when|where|who|which|whose|whom|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)\b/i.test(
      cleaned
    );
  const askPhrase =
    /^(tell me|explain|remind me|what('s| is| was)|do you (know|remember)|can you (tell|explain|remind)|what password|what email|what('s| is) my)\b/i.test(
      lower
    );

  if ((endsWithQuestion || interrogativeStart || askPhrase) && cleaned.length < 400) {
    // "Can you open gmail and …?" is still a goal.
    if (
      /\b(open|go to|navigate|log ?in|click|fill|book|buy|scrape|download|upload|sign (in|up))\b/i.test(
        lower
      )
    ) {
      return { intent: "goal", confidence: 0.85, reason: "question_shaped_but_actionable", text: cleaned };
    }
    return {
      intent: "question",
      confidence: endsWithQuestion || askPhrase ? 0.9 : 0.75,
      reason: endsWithQuestion ? "ends_with_?" : askPhrase ? "ask_phrase" : "interrogative",
      text: cleaned,
    };
  }

  if (cleaned.length <= 80 && interrogativeStart) {
    return { intent: "question", confidence: 0.7, reason: "short_interrogative", text: cleaned };
  }

  return { intent: "ambiguous", confidence: 0.4, reason: "needs_llm", text: cleaned };
}

/**
 * Cheap LLM refine when heuristics are ambiguous. Defaults to goal on failure.
 * @param {string} text
 * @param {{ apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }} creds
 * @returns {Promise<{ intent: "goal"|"question", confidence: number, reason: string, text: string }>}
 */
export async function refineMessageIntentWithLlm(text, creds) {
  const cleaned = stripIntentOverrides(text);
  const raw = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "gpt-4o-mini",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0,
    maxTokens: 80,
    timeoutMs: 12_000,
    messages: [
      {
        role: "system",
        content:
          'Classify the user message for a browser agent product. Reply with ONLY JSON: {"intent":"goal"|"question","confidence":0-1}. "goal" = needs the computer/browser (open sites, click, fill, buy, research on the web). "question" = can be answered from chat/memory without browsing (what/why/how about past work, passwords in vault, explain, status). Prefer "goal" if both apply.',
      },
      { role: "user", content: cleaned.slice(0, 1500) },
    ],
  });

  const match = String(raw || "").match(/\{[\s\S]*\}/);
  if (!match) {
    return { intent: "goal", confidence: 0.5, reason: "llm_unparsed_default_goal", text: cleaned };
  }
  try {
    const parsed = JSON.parse(match[0]);
    const intent = parsed.intent === "question" ? "question" : "goal";
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6));
    return { intent, confidence, reason: "llm_classify", text: cleaned };
  } catch {
    return { intent: "goal", confidence: 0.5, reason: "llm_json_failed_default_goal", text: cleaned };
  }
}

/**
 * Answers a question using the agent's profile/memory + this chat's session context.
 * @param {{
 *   question: string,
 *   snapshot: object,
 *   creds: { apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string },
 *   chatContext?: string,
 * }} opts
 * @returns {Promise<string>}
 */
export async function answerChatQuestion(opts) {
  const { question, snapshot, creds, chatContext = "" } = opts;
  const context = formatAgentPrompt(snapshot);
  const thread = String(chatContext || snapshot?.chatContext || "").trim();
  const reply = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0.3,
    maxTokens: 900,
    timeoutMs: 45_000,
    messages: [
      {
        role: "system",
        content: [
          `You are YamBot agent “${snapshot?.name || "Agent"}” answering in chat.`,
          "This is Q&A mode — you are NOT controlling the computer right now.",
          "Use the agent profile, memory, day history, saved logins, and THIS CHAT SESSION CONTEXT below.",
          "Treat the chat session context as conversation memory for this thread until the chat is deleted.",
          "If the user needs you to browse or click, tell them to send a goal (or prefix with /run).",
          "Be concise and direct. Do not invent credentials that are not in SAVED LOGINS.",
          "",
          context || "(no extra agent context)",
          thread ? `\n\n${thread}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      { role: "user", content: String(question || "").slice(0, 4000) },
    ],
  });
  return String(reply || "").trim() || "I could not draft an answer. Try rephrasing, or send /run … to use the computer.";
}
