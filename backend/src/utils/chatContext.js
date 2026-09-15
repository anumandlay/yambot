/**
 * @fileoverview Per-chat conversation context — remember until the chat is deleted.
 * Purpose: Pack summary + recent turns into LLM prompts; compress older turns when the
 * thread grows so each API call stays bounded without losing session memory.
 * Downstream: chats routes (Q&A + Task.agentSnapshot); worker formatAgentSnapshot.
 */

import { Message } from "../models/Chat.js";
import { llmChatCompletion } from "./llmChat.js";

/** Raw turns kept verbatim at the end of the thread. */
export const CHAT_CONTEXT_RECENT = 16;
/** Summarize older turns once the thread exceeds this many eligible messages. */
export const CHAT_CONTEXT_SUMMARIZE_MIN = 24;
/** Also summarize when eligible raw text exceeds this size (chars). */
export const CHAT_CONTEXT_SUMMARIZE_CHARS = 14_000;
/** Cap stored summary length. */
export const CHAT_CONTEXT_SUMMARY_MAX = 3_500;

/**
 * Whether a message belongs in chat memory (skip LLM traces / noise).
 * @param {object} m
 * @returns {boolean}
 */
export function isContextEligibleMessage(m) {
  if (!m?.content || !String(m.content).trim()) return false;
  const type = m.meta?.type;
  if (type === "llm_request" || type === "llm_response") return false;
  const kind = m.meta?.kind;
  if (kind === "intent_question" || kind === "superseded") return false;
  if (m.role === "user" || m.role === "assistant" || m.role === "agent") return true;
  if (m.role === "system") {
    // Why: keep short operational notes; drop long dumps.
    return String(m.content).length <= 600;
  }
  return false;
}

/**
 * @param {object} m
 * @returns {string}
 */
export function formatContextMessageLine(m) {
  const role = String(m.role || "unknown").toUpperCase();
  const text = String(m.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return `${role}: ${text}`;
}

/**
 * Loads eligible messages oldest → newest.
 * @param {string|import("mongoose").Types.ObjectId} chatId
 * @param {{ excludeIds?: string[] }} [opts]
 * @returns {Promise<object[]>}
 */
export async function loadEligibleChatMessages(chatId, opts = {}) {
  const exclude = new Set((opts.excludeIds || []).map(String));
  const rows = await Message.find({ chat: chatId }).sort({ _id: 1 }).lean();
  return rows.filter((m) => isContextEligibleMessage(m) && !exclude.has(String(m._id)));
}

/**
 * Builds the prompt block: optional summary + recent raw turns.
 * @param {object} chat — Chat doc (needs contextSummary)
 * @param {object[]} eligible — oldest → newest
 * @returns {string}
 */
export function formatChatContextBlock(chat, eligible) {
  const recent = eligible.slice(-CHAT_CONTEXT_RECENT);
  const parts = [];
  const summary = String(chat?.contextSummary || "").trim();
  if (summary) {
    parts.push(
      "EARLIER IN THIS CHAT (running summary — remember for this chat until it is deleted):\n" +
        summary
    );
  }
  if (recent.length) {
    parts.push(
      "RECENT MESSAGES IN THIS CHAT:\n" + recent.map(formatContextMessageLine).join("\n")
    );
  }
  if (!parts.length) return "";
  return (
    "THIS CHAT SESSION CONTEXT (use for continuity; do not invent turns that are not listed):\n\n" +
    parts.join("\n\n")
  );
}

/**
 * Loads messages and formats the context block for prompts.
 * @param {object} chat
 * @param {{ excludeIds?: string[] }} [opts]
 * @returns {Promise<{ block: string, eligible: object[], recent: object[] }>}
 */
export async function buildChatContextPrompt(chat, opts = {}) {
  const eligible = await loadEligibleChatMessages(chat._id, opts);
  const recent = eligible.slice(-CHAT_CONTEXT_RECENT);
  return {
    block: formatChatContextBlock(chat, eligible),
    eligible,
    recent,
  };
}

/**
 * @param {object[]} messages
 * @returns {number}
 */
function totalChars(messages) {
  return (messages || []).reduce((n, m) => n + String(m.content || "").length, 0);
}

/**
 * When the thread is large, compress older turns into chat.contextSummary.
 * Why: full transcript would blow the LLM context; summary + recent tail keeps memory.
 * @param {object} chat — mongoose Chat document
 * @param {{ apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} creds
 * @returns {Promise<object>} updated chat
 */
export async function refreshChatContextIfNeeded(chat, creds) {
  if (!chat?._id) return chat;
  const eligible = await loadEligibleChatMessages(chat._id);
  const chars = totalChars(eligible);
  const needs =
    eligible.length >= CHAT_CONTEXT_SUMMARIZE_MIN || chars >= CHAT_CONTEXT_SUMMARIZE_CHARS;
  if (!needs) return chat;

  const recent = eligible.slice(-CHAT_CONTEXT_RECENT);
  const older = eligible.slice(0, Math.max(0, eligible.length - CHAT_CONTEXT_RECENT));
  if (!older.length) return chat;

  const lastOlderId = String(older[older.length - 1]._id);
  if (
    String(chat.contextSummarizedThrough || "") === lastOlderId &&
    String(chat.contextSummary || "").trim()
  ) {
    return chat;
  }

  if (!creds?.apiKey) {
    // Why: no LLM — keep a crude truncation so something still lands in prompts.
    const crude = older
      .map(formatContextMessageLine)
      .join("\n")
      .slice(-CHAT_CONTEXT_SUMMARY_MAX);
    chat.contextSummary = crude;
    chat.contextSummarizedThrough = older[older.length - 1]._id;
    await chat.save();
    return chat;
  }

  const prior = String(chat.contextSummary || "").trim();
  const olderText = older.map(formatContextMessageLine).join("\n").slice(0, 24_000);
  try {
    const reply = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.2,
      maxTokens: 900,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: [
            "You maintain a running summary of a YamBot agent chat thread.",
            "Write a concise third-person summary of goals, decisions, sites visited, outcomes, and open follow-ups.",
            "Keep facts the agent must remember later. Omit UI chrome and repeated fluff.",
            `Max ~${CHAT_CONTEXT_SUMMARY_MAX} characters. Plain text only.`,
          ].join(" "),
        },
        {
          role: "user",
          content: [
            prior ? `PREVIOUS SUMMARY:\n${prior}\n` : "",
            `OLDER MESSAGES TO FOLD IN:\n${olderText}`,
            recent.length
              ? `\n(There are ${recent.length} newer messages kept verbatim separately — do not duplicate them.)`
              : "",
            "\nReturn the updated summary only.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    const next = String(reply || "")
      .trim()
      .slice(0, CHAT_CONTEXT_SUMMARY_MAX);
    if (next) {
      chat.contextSummary = next;
      chat.contextSummarizedThrough = older[older.length - 1]._id;
      await chat.save();
    }
  } catch (err) {
    console.warn("[chatContext] summarize failed:", err?.message || err);
  }
  return chat;
}

/**
 * Attaches chat session context onto an agent snapshot for workers / Q&A.
 * @param {object} snapshot
 * @param {string} block
 * @returns {object}
 */
export function withChatContext(snapshot, block) {
  if (!snapshot) return snapshot;
  const text = String(block || "").trim();
  if (!text) return snapshot;
  return { ...snapshot, chatContext: text };
}
