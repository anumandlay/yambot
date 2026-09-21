/**
 * @fileoverview Per-chat conversation context — remember until the chat is deleted.
 * Purpose: Pack summary + recent turns into LLM prompts; compress older turns when the
 * thread grows. Budgets scale to the agent’s LLM context window (settings / profile).
 * Downstream: chats routes (Q&A + Task.agentSnapshot); worker formatAgentSnapshot.
 */

import { Chat, Message } from "../models/Chat.js";
import { llmChatCompletion } from "./llmChat.js";
import {
  chatContextBudgetFromTokens,
  DEFAULT_CONTEXT_TOKENS,
} from "./llmContextWindow.js";

/** Fallback constants when no creds are passed (legacy / tests). */
export const CHAT_CONTEXT_RECENT = 16;
export const CHAT_CONTEXT_SUMMARIZE_MIN = 24;
export const CHAT_CONTEXT_SUMMARIZE_CHARS = 14_000;
export const CHAT_CONTEXT_SUMMARY_MAX = 3_500;

/**
 * @param {{ contextTokens?: number, llmModel?: string, model?: string }|null|undefined} creds
 */
function budgetFor(creds) {
  if (!creds) {
    return chatContextBudgetFromTokens(DEFAULT_CONTEXT_TOKENS);
  }
  return chatContextBudgetFromTokens(creds);
}

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
 * @param {number} [lineMax]
 * @returns {string}
 */
export function formatContextMessageLine(m, lineMax = 1200) {
  const role = String(m.role || "unknown").toUpperCase();
  const text = String(m.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(200, lineMax));
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
 * Why: take from the end until count OR char budget is hit so large windows stay usable.
 * @param {object} chat — Chat doc (needs contextSummary)
 * @param {object[]} eligible — oldest → newest
 * @param {{ recent?: number, lineMax?: number, chatChars?: number, summaryMax?: number }|null} [budget]
 * @returns {string}
 */
export function formatChatContextBlock(chat, eligible, budget = null) {
  const recentN = budget?.recent || CHAT_CONTEXT_RECENT;
  const lineMax = budget?.lineMax || 1200;
  const chatChars = budget?.chatChars || CHAT_CONTEXT_SUMMARIZE_CHARS;
  const summaryMax = budget?.summaryMax || CHAT_CONTEXT_SUMMARY_MAX;

  const summary = String(chat?.contextSummary || "").trim().slice(0, summaryMax);
  const summaryRoom = summary ? summary.length + 120 : 0;
  const recentBudget = Math.max(2_000, chatChars - summaryRoom);

  /** @type {object[]} */
  const picked = [];
  let used = 0;
  for (let i = eligible.length - 1; i >= 0 && picked.length < recentN; i--) {
    const line = formatContextMessageLine(eligible[i], lineMax);
    if (picked.length && used + line.length + 1 > recentBudget) break;
    picked.push(eligible[i]);
    used += line.length + 1;
  }
  picked.reverse();

  const parts = [];
  if (summary) {
    parts.push(
      "EARLIER IN THIS CHAT (running summary — remember for this chat until it is deleted):\n" +
        summary
    );
  }
  if (picked.length) {
    parts.push(
      "RECENT MESSAGES IN THIS CHAT:\n" +
        picked.map((m) => formatContextMessageLine(m, lineMax)).join("\n")
    );
  }
  if (!parts.length) return "";
  return (
    "THIS CHAT SESSION CONTEXT (use for continuity; do not invent turns that are not listed):\n" +
      "AUTHORITY: Account USER prefs / tone / identity come only from the USER PROFILE block " +
      "(Settings → Memory). If that block is absent or empty, do not keep old tone/identity " +
      "instructions from this summary or from prior assistant replies.\n\n" +
      parts.join("\n\n")
  );
}

/**
 * Drop every chat's running summary for an account after Settings USER memory changes.
 * Why: summaries often absorb tone/identity from USER.md; after delete they keep zombie prefs.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{ matched: number, modified: number }>}
 */
export async function invalidateChatContextSummariesForUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return { matched: 0, modified: 0 };
  const result = await Chat.updateMany(
    { user: uid },
    { $set: { contextSummary: "", contextSummarizedThrough: null } }
  );
  return {
    matched: Number(result.matchedCount || 0),
    modified: Number(result.modifiedCount || 0),
  };
}

/**
 * Loads messages and formats the context block for prompts.
 * @param {object} chat
 * @param {{ excludeIds?: string[], creds?: object|null }} [opts]
 * @returns {Promise<{ block: string, eligible: object[], recent: object[], budget: object }>}
 */
export async function buildChatContextPrompt(chat, opts = {}) {
  const budget = budgetFor(opts.creds);
  const eligible = await loadEligibleChatMessages(chat._id, opts);
  const recent = eligible.slice(-budget.recent);
  return {
    block: formatChatContextBlock(chat, eligible, budget),
    eligible,
    recent,
    budget,
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
 * Budgets come from the agent’s LLM contextTokens / model.
 * @param {object} chat — mongoose Chat document
 * @param {{ apiKey: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string, contextTokens?: number }|null} creds
 * @returns {Promise<object>} updated chat
 */
export async function refreshChatContextIfNeeded(chat, creds) {
  if (!chat?._id) return chat;
  const budget = budgetFor(creds);
  const eligible = await loadEligibleChatMessages(chat._id);
  const chars = totalChars(eligible);
  const needs =
    eligible.length >= budget.summarizeMin || chars >= budget.summarizeChars;
  if (!needs) return chat;

  const recent = eligible.slice(-budget.recent);
  const older = eligible.slice(0, Math.max(0, eligible.length - budget.recent));
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
      .map((m) => formatContextMessageLine(m, budget.lineMax))
      .join("\n")
      .slice(-budget.summaryMax);
    chat.contextSummary = crude;
    chat.contextSummarizedThrough = older[older.length - 1]._id;
    await chat.save();
    return chat;
  }

  const prior = String(chat.contextSummary || "").trim();
  const olderCap = Math.min(48_000, Math.max(12_000, budget.chatChars * 2));
  const olderText = older
    .map((m) => formatContextMessageLine(m, budget.lineMax))
    .join("\n")
    .slice(0, olderCap);
  const summaryMaxTokens = clamp(Math.floor(budget.summaryMax / 4), 400, 4_000);
  try {
    const reply = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.2,
      maxTokens: summaryMaxTokens,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content: [
            "You maintain a running summary of a YamBot agent chat thread.",
            "Write a concise third-person summary of goals, decisions, sites visited, outcomes, and open follow-ups.",
            "Keep facts the agent must remember later. Omit UI chrome and repeated fluff.",
            "Do NOT copy account identity, location, or tone/personality prefs into the summary — those live in Settings → Memory (USER PROFILE) and change independently.",
            `Max ~${budget.summaryMax} characters. Plain text only.`,
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
      .slice(0, budget.summaryMax);
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
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
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
