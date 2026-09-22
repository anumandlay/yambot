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
 * True when the user wants a chat summary of today's work / day history — never a browser run.
 * Why: models invent QUEUE_GOAL like "Log in... verify" from chat context for "what we did today".
 * Also: "did we open nseindia.com today?" must not hit has_url_or_domain.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeDayHistoryOrStatusRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  // Past / recall about opening a site (may include a domain) — dayLogs, not Chromium.
  const pastBrowseAsk =
    /\b(did|have|has|was|were)\b[\s\S]{0,48}\b(we|you|i|us)\b[\s\S]{0,48}\b(open|opened|visit|visited|go|went|browse|browsed|check|checked|run|ran|load|loaded)\b/i.test(
      lower
    ) ||
    /\b(did|have)\b[\s\S]{0,24}\b(open|opened|visit|visited)\b[\s\S]{0,48}\b(today|earlier|already|before|this (morning|afternoon|evening|day))\b/i.test(
      lower
    ) ||
    /\b(already|earlier today)\b[\s\S]{0,40}\b(open|opened|visit|visited|went to)\b/i.test(lower);

  if (pastBrowseAsk) return true;

  // Imperative browse NOW — not history (exclude those from the rest of the matcher).
  const imperativeBrowse =
    /^(please\s+)?(go to|navigate to|open|visit|browse|log ?in to|sign in to)\b/i.test(raw) ||
    /\b(go to|navigate to)\s+https?:\/\//i.test(lower) ||
    /\b(open|visit)\s+https?:\/\//i.test(lower);
  if (imperativeBrowse) return false;

  if (
    /\b(what (did|have) (we|you|i) (do|done)|what we did|what you did|what happened)\b[\s\S]{0,40}\b(today|this (morning|afternoon|evening|day)|so far)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b(tell me|show me|summarize|recap|list)\b[\s\S]{0,60}\b(what we did|what you did|today('s)? (work|runs?|activity|activities|history)|day history)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/\b(day history|today'?s (work|runs?|activity)|with timestamps?)\b/i.test(lower) && raw.length < 220) {
    return true;
  }
  if (/^(status|what('?s| is) (going on|happening)|how('?s| is) (it|today) going)\b[!?.\s]*$/i.test(raw)) {
    return true;
  }
  return false;
}

/**
 * Ultra-short follow-ups that must stay chat (models invent browser goals from thread context).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeVagueChatFollowup(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 24) return false;
  if (/https?:\/\//i.test(raw) || /\b[\w-]+\.(com|io|net|org)\b/i.test(raw)) return false;
  return /^(what|huh|hmm+|and\??|so\??|ok what|then what|now what)\b[!?.\s]*$/i.test(raw);
}

/**
 * True when the user is teaching durable prefs/facts (often with URLs) and does not want a browser run.
 * Why: "Remember … https://vughy.com/admin … do not start a computer" used to match has_url_or_domain
 * and force-queue Chromium. Memory store stays chat/Mem0 ingest.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeMemoryStoreRequest(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 24) return false;
  const lower = raw.toLowerCase();

  const storeCue =
    /\b(remember these|store these|save these|permanent preferences|preferences for this agent)\b/i.test(
      lower
    ) ||
    /\b(remember|store|save|memorize)\b[\s\S]{0,80}\b(preference|preferences|facts?|notes?|settings?|for future|into (your )?memory)\b/i.test(
      lower
    ) ||
    /\b(acknowledge and store|just acknowledge( and store)?)\b/i.test(lower);

  const noComputer =
    /\b(do not|don't|never)\b[\s\S]{0,40}\b(start|open|launch|spin up|use)\b[\s\S]{0,40}\b(computer|browser|chromium|playwright)\b/i.test(
      lower
    ) ||
    /\b(without|no need to)\b[\s\S]{0,40}\b(computer|browser|chromium)\b/i.test(lower) ||
    /\bjust acknowledge\b/i.test(lower) ||
    /\bdo not start a computer task\b/i.test(lower);

  // Explicit browse job — still a goal even if they also say "remember".
  const browseJob =
    /\b(go to|navigate to|open (the )?(site|page|url)|click|fill (out|in)|type into|sign in to|log ?in to)\b/i.test(
      lower
    ) || /\b(open|visit)\s+https?:\/\//i.test(lower);

  if (browseJob) return false;
  if (storeCue && noComputer) return true;
  // Numbered preference dump with store cue and no browse verb.
  if (storeCue && /\b\d+[).:]\s*\S/.test(raw) && raw.length >= 120) return true;
  return false;
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

  const cleanedEarly = stripIntentOverrides(raw);
  const lowerEarly = cleanedEarly.toLowerCase();
  // Why: Answer mode cannot call message_agent — escalate peer/fan-out goals even if forceAsk.
  if (
    cleanedEarly &&
    (/\bmessage_agent\b/i.test(cleanedEarly) ||
      /\b(fan-?out|fanout)\b/i.test(lowerEarly) ||
      /\b(at the same time|in parallel|both)\b.+\b(ask|message|tell|send)\b.+\b(and)\b/i.test(
        lowerEarly
      ) ||
      /\b(ask|message|tell|send)\b.+\b(both|each of)\b.+\b(and)\b/i.test(lowerEarly) ||
      /\b(ask|message|tell)\b.+\b(agent|researcher|inspector|manager|peer)\b/i.test(lowerEarly) ||
      /\b(soft.?wait|wait:?\s*soft|wait for both)\b/i.test(lowerEarly) ||
      /\b(peer (agent|result|message)|handoff|delegat)/i.test(lowerEarly))
  ) {
    return {
      intent: "goal",
      confidence: 0.95,
      reason: opts.forceAsk ? "peer_a2a_overrides_ask" : "peer_a2a_or_fanout",
      text: cleanedEarly,
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
    // Same override: /ask + peer fan-out still needs a worker.
    if (
      /\bmessage_agent\b/i.test(cleanedEarly) ||
      /\b(fan-?out|fanout)\b/i.test(lowerEarly) ||
      /\b(at the same time|in parallel|both)\b.+\b(ask|message|tell|send)\b.+\b(and)\b/i.test(
        lowerEarly
      ) ||
      /\b(ask|message|tell)\b.+\b(agent|researcher|inspector|manager|peer)\b/i.test(lowerEarly)
    ) {
      return { intent: "goal", confidence: 0.95, reason: "peer_a2a_overrides_ask", text: cleanedEarly };
    }
    return {
      intent: "question",
      confidence: 1,
      reason: "override_ask",
      text: stripIntentOverrides(raw),
    };
  }

  const cleaned = cleanedEarly;
  const lower = lowerEarly;

  // Greetings / chit-chat — never boot the computer.
  if (
    /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|howdy|thanks|thank you|thx|ok|okay|k|cool|nice|lol|haha|yes|no|yep|nope|sure|now|later|wait|hmm+|huh|what|welcom)\b[!?.]*$/i.test(
      cleaned
    )
  ) {
    return { intent: "question", confidence: 0.95, reason: "greeting_or_chitchat", text: cleaned };
  }

  // Ultra-short single-token pings — chat, don't spin Chromium.
  // Why: "now" was enqueueing a full cloud run with no actionable goal.
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  if (
    wordCount === 1 &&
    cleaned.length <= 24 &&
    !/\b(http|www\.|\.\w{2,})\b/i.test(lower)
  ) {
    return { intent: "question", confidence: 0.9, reason: "short_vague", text: cleaned };
  }

  // Hypothetical / policy questions — answer from memory (e.g. dummy-data prefs), don't start the computer.
  // Why: "what if I tell you to register…" used to match action_verbs and boot Chromium.
  if (
    /\b(what if|what would( you)?( do)?( if)?|suppose (that )?i|assuming (that )?i|how would you( handle|respond| react)?|what happens if|what do you do (if|when)|if i (don'?t|do not|told|tell|ask|said|say)\b)/i.test(
      lower
    )
  ) {
    return {
      intent: "question",
      confidence: 0.93,
      reason: "hypothetical_or_policy",
      text: cleaned,
    };
  }

  // Draft / write from chat context — reply in-thread; do not queue the computer to "send" unless explicit.
  // Why: "draft an email for above emails" must stay Q&A even when "email" / "them" appear.
  if (
    /\b(draft|write|compose|prepare)\b.+\b(email|mail|message|letter|note|reminder)\b/i.test(lower) ||
    /\b(draft|write)\b.+\b(for (them|these|those|above|the emails?))\b/i.test(lower) ||
    /\b(email draft|draft email)\b/i.test(lower)
  ) {
    if (
      !/\bsend\b/i.test(lower) &&
      !/\b(email them|mail them|deliver)\b/i.test(lower)
    ) {
      return {
        intent: "question",
        confidence: 0.94,
        reason: "draft_from_context",
        text: cleaned,
      };
    }
  }

  // Explicit send/deliver of emails from chat — computer goal (send_email / SMTP).
  if (
    /\bsend\b.+\b(them|these|those|the|above)?\s*(the\s+)?(emails?|mails?|reminders?)\b/i.test(lower) ||
    /\b(email|mail)\s+(them|these|those|everyone|all)\b/i.test(lower) ||
    /^send\s+(them|it|the\s+emails?)\b/i.test(lower)
  ) {
    return {
      intent: "goal",
      confidence: 0.95,
      reason: "send_email_from_context",
      text: cleaned,
    };
  }

  // Memory store / teach prefs — chat only (Mem0 ingest), even when URLs appear in the list.
  // Must run BEFORE has_url_or_domain / action_verbs ("admin login", "https://…").
  if (looksLikeMemoryStoreRequest(cleaned)) {
    return {
      intent: "question",
      confidence: 0.96,
      reason: "memory_store_request",
      text: cleaned,
    };
  }

  // Day history / "what we did today" — chat from dayLogs, never Chromium.
  if (looksLikeDayHistoryOrStatusRequest(cleaned) || looksLikeVagueChatFollowup(cleaned)) {
    return {
      intent: "question",
      confidence: 0.96,
      reason: looksLikeVagueChatFollowup(cleaned) ? "vague_chat_followup" : "day_history_or_status",
      text: cleaned,
    };
  }

  // Strong goal signals — always use the computer.
  // Why: strip addresses first so "user@gmail.com" does not trip the bare-domain matcher.
  const withoutEmails = cleaned.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");
  if (
    /https?:\/\//i.test(withoutEmails) ||
    /\b[\w-]+\.(com|io|net|org|co|ai|app)\b/i.test(withoutEmails)
  ) {
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
    // "Can you open gmail.com and …?" / "open vughy and register" → still a goal.
    // "Can you also open websites for me?" → capability Q — answer in chat (Hermes-style).
    if (
      /\b(open|go to|navigate|log ?in|click|fill|book|buy|scrape|download|upload|sign (in|up))\b/i.test(
        lower
      )
    ) {
      const hasConcreteTarget =
        /https?:\/\//i.test(withoutEmails) ||
        /\b[\w-]+\.(com|io|net|org|co|ai|app)\b/i.test(withoutEmails) ||
        /\b(gmail|outlook|youtube|amazon|linkedin|facebook|twitter|x\.com|vughy|nse|nyse)\b/i.test(
          lower
        ) ||
        /\band\b[\s\S]{0,80}\b(click|fill|log ?in|sign|register|download|submit|extract|filter)\b/i.test(
          lower
        );
      if (hasConcreteTarget) {
        return {
          intent: "goal",
          confidence: 0.85,
          reason: "question_shaped_but_actionable",
          text: cleaned,
        };
      }
      return {
        intent: "question",
        confidence: 0.92,
        reason: "capability_question",
        text: cleaned,
      };
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
          "intent=question — answer in chat from memory/profile/day history. NO browser, NO peer messaging.",
          "Examples: hi/hello, thanks, now, ok, yes, what do you know about me, what happened last run, explain X, status check, chit-chat, any vague 1–3 word message without a website.",
          "Also question: remember/store permanent preferences or facts (lists may include https:// URLs) when they say do not start the computer / just acknowledge.",
          "",
          "intent=goal — needs a live worker run: browser/computer OR messaging other agents (message_agent / fan-out / ask both peers / soft wait / handoff).",
          "Examples: open gmail, go to amazon and buy…, log into CRM, scrape this page, ask both Market researcher and Content Inspector…, fan-out to peers, soft-wait for a peer reply.",
          "",
          "If both apply, prefer goal — EXCEPT memory-store/acknowledge-only messages with URLs listed as facts (those stay question). Peer collaboration is always goal. Greetings, one-word pings (now/ok), and memory questions are always question.",
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
          `You are “${agentName}”, an AI employee on YamBot. Never call yourself “YamBot”.`,
          "Do not introduce yourself or repeat your name in every reply — the UI already shows who is speaking. Only say your name when the human asks who you are.",
          "Do not address the human by name every turn unless it fits naturally.",
          "Never append lines like “AGENT NAME: …” to your replies.",
          "This is Q&A mode — you are NOT controlling the computer right now.",
          "Use the agent profile, USER PROFILE block, MEMORY (personal notes) block, day history, saved logins, and THIS CHAT SESSION CONTEXT below.",
          "If a section titled “USER PROFILE (who the user is)” appears below, that IS what you know about the user — quote those facts when asked.",
          "If a section titled “MEMORY (your personal notes)” appears below, that is your durable notes — use it when relevant.",
          "Treat the chat session context as conversation memory for this thread until the chat is deleted.",
          "You may be answering while a browser run is also in progress — answer from memory only; do not claim to control the computer right now.",
          "If the user needs you to browse, click, or message other agents (fan-out / ask peers), tell them to choose “Computer” mode (or Auto) — Q&A cannot call message_agent.",
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
