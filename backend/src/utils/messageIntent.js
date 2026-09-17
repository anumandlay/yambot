/**
 * @fileoverview Classify chat messages as browser goals vs Q&A questions.
 * Purpose: Skip spinning the agent computer when the user only asked a question.
 * Downstream: backend/src/routes/chats.js POST /messages.
 */

import { llmChatCompletion } from "./llmChat.js";
import { stripModelThinking } from "./llmSanitize.js";
import { formatAgentPrompt } from "../models/Agent.js";

/** Heuristic confidence at or above this skips the LLM refine. */
export const HEURISTIC_CONFIDENCE_SKIP_LLM = 0.9;

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

  // Greetings / chit-chat — never boot the computer.
  if (
    /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|howdy|thanks|thank you|thx|ok|okay|k|cool|nice|lol|haha)\b[!?.]*$/i.test(
      cleaned
    )
  ) {
    return { intent: "question", confidence: 0.95, reason: "greeting_or_chitchat", text: cleaned };
  }

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

  // Memory / profile introspect — answer from curated memory, not browser.
  if (
    /\b(what do you know about me|from (user )?memory|user profile|what('s| is) (in )?my (memory|profile)|remember about me)\b/i.test(
      lower
    )
  ) {
    return { intent: "question", confidence: 0.93, reason: "memory_introspect", text: cleaned };
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
 * Whether heuristics alone are trusted enough to skip the LLM classifier.
 * @param {{ intent: string, confidence: number, reason: string }} classification
 * @returns {boolean}
 */
export function shouldRefineIntentWithLlm(classification) {
  if (!classification) return true;
  if (classification.intent === "ambiguous") return true;
  if (
    ["force_goal", "force_ask", "override_run", "override_ask", "skill_slash", "empty"].includes(
      classification.reason
    )
  ) {
    return false;
  }
  return Number(classification.confidence) < HEURISTIC_CONFIDENCE_SKIP_LLM;
}

/**
 * Cheap LLM refine when heuristics are uncertain. Defaults to goal on failure.
 * @param {string} text
 * @param {{ apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }} creds
 * @param {{ agentName?: string, recentTurns?: string }} [ctx]
 * @returns {Promise<{ intent: "goal"|"question", confidence: number, reason: string, text: string }>}
 */
export async function refineMessageIntentWithLlm(text, creds, ctx = {}) {
  const cleaned = stripIntentOverrides(text);
  const agentName = String(ctx.agentName || "Agent").trim() || "Agent";
  const recent = String(ctx.recentTurns || "").trim().slice(0, 1200);
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
        content: [
          `You route messages for AI employee "${agentName}" on YamBot.`,
          'Reply with ONLY JSON: {"intent":"goal"|"question","confidence":0-1}',
          "",
          "intent=question — answer in chat from memory/profile/day history. NO browser.",
          "Examples: hi/hello, thanks, what do you know about me, what happened last run, what password is saved, explain X, status check, chit-chat.",
          "",
          "intent=goal — needs the live computer/browser (open sites, click, fill, buy, research on the web, email outreach via tools that need a run).",
          "Examples: open gmail, go to amazon and buy…, log into CRM, scrape this page, check my inbox on the site.",
          "",
          "If both apply, prefer goal. Greetings and memory questions are always question.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          recent ? `Recent chat (oldest→newest):\n${recent}\n` : "",
          `Message to classify:\n${cleaned.slice(0, 1500)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
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
  const agentName = String(snapshot?.name || "Agent").trim() || "Agent";
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
          `You are “${agentName}”, an AI employee on YamBot. Always introduce and refer to yourself as ${agentName} — never call yourself “YamBot”.`,
          "This is Q&A mode — you are NOT controlling the computer right now.",
          "Use the agent profile, USER PROFILE block, MEMORY (personal notes) block, day history, saved logins, and THIS CHAT SESSION CONTEXT below.",
          "If a section titled “USER PROFILE (who the user is)” appears below, that IS what you know about the user — quote those facts when asked.",
          "If a section titled “MEMORY (your personal notes)” appears below, that is your durable notes — use it when relevant.",
          "Treat the chat session context as conversation memory for this thread until the chat is deleted.",
          "You may be answering while a browser run is also in progress — answer from memory only; do not claim to control the computer right now.",
          "If the user needs you to browse or click, tell them to choose “Computer” mode (or send a clear browser goal).",
          "Be concise and direct. Do not invent credentials that are not in SAVED LOGINS.",
          "Reply in plain prose only — no tool JSON, no “finish”, no <think> tags, no chain-of-thought.",
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
  const cleaned = stripModelThinking(reply);
  return cleaned || "I could not draft an answer. Try rephrasing, or switch to Computer mode to use the browser.";
}
