/**
 * @fileoverview Hermes-style Auto: capability questions stay in chat; model decides queue.
 * Also: strip scratchpad before glued REPLY markers so users never see planning notes.
 * Run: node --test test/hermesAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMessageIntent } from "../src/utils/messageIntent.js";
import {
  autoTurnHeuristicGate,
  buildAutoUserContent,
  extractAfterLastReplyMarker,
  formatAutoClassifierHint,
  parseAutoTurnOutput,
  sanitizeAutoReplyContent,
} from "../src/utils/chatAutoTurn.js";

describe("capability questions vs concrete goals", () => {
  it("treats 'can you open websites' as chat, not forced computer", () => {
    const c = classifyMessageIntent("can you also open webistes for me");
    assert.equal(c.intent, "question");
    assert.equal(c.reason, "capability_question");
    assert.equal(autoTurnHeuristicGate("can you also open webistes for me"), "model");
  });

  it("concrete URL browse jobs defer to the LLM (no heuristic force-queue)", () => {
    assert.equal(autoTurnHeuristicGate("open https://vughy.com and register"), "model");
    const c = classifyMessageIntent("can you open gmail.com and check inbox");
    assert.equal(c.intent, "goal");
    assert.ok(
      c.reason === "question_shaped_but_actionable" || c.reason === "has_url_or_domain",
      c.reason
    );
    assert.equal(autoTurnHeuristicGate("can you open gmail.com and check inbox"), "model");
    assert.equal(autoTurnHeuristicGate("can you open example.com"), "model");
  });

  it("classifier hint steers past-domain vs live open", () => {
    const past = formatAutoClassifierHint("did we opened nseindia.com today ?");
    assert.match(past, /Prefer REPLY|day_history|past-work|Signal: looks like past-work/i);
    const live = formatAutoClassifierHint("open https://nseindia.com and tell me the title");
    assert.match(live, /QUEUE_GOAL|live browse|three modes/i);
    const packed = buildAutoUserContent("open https://vughy.com");
    assert.match(packed, /USER MESSAGE:/);
    assert.match(packed, /AUTO DECISION HINT/);
  });

  it("lets the model decide action_verbs without a URL (Hermes-style)", () => {
    assert.equal(autoTurnHeuristicGate("log into the admin panel and extract the list"), "model");
  });

  it("peer fan-out also defers to the LLM (no heuristic force-queue)", () => {
    assert.equal(
      autoTurnHeuristicGate("ask both researcher and inspector to check the CRM"),
      "model"
    );
  });

  it("memory-store preference dumps with URLs stay chat (no heuristic queue)", () => {
    const msg = [
      "Remember these permanent preferences for this agent — do not start a computer task, just acknowledge and store them:",
      "1) CRM admin login is https://vughy.com/admin",
      "2) Demo CRM username is ops-india@vughy.com",
      "3) Agent timezone is Asia/Kolkata",
    ].join("\n");
    const c = classifyMessageIntent(msg);
    assert.equal(c.intent, "question");
    assert.equal(c.reason, "memory_store_request");
    assert.equal(autoTurnHeuristicGate(msg), "model");
  });

  it("open URL + do work defers to the LLM", () => {
    const c = classifyMessageIntent("Open https://vughy.com/admin and tell me the page title");
    assert.equal(c.intent, "goal");
    assert.equal(c.reason, "has_url_or_domain");
    assert.equal(
      autoTurnHeuristicGate("Open https://vughy.com/admin and tell me the page title"),
      "model"
    );
  });

  it("day-history asks stay chat (never heuristic queue)", () => {
    const msg = "tell me clearly what we did today with timestamp";
    const c = classifyMessageIntent(msg);
    assert.equal(c.intent, "question");
    assert.equal(c.reason, "day_history_or_status");
    assert.equal(autoTurnHeuristicGate(msg), "model");
  });

  it("did we open <domain> today stays chat (not URL heuristic queue)", () => {
    const msg = "did we opened nseindia.com today ?";
    const c = classifyMessageIntent(msg);
    assert.equal(c.intent, "question");
    assert.equal(c.reason, "day_history_or_status");
    assert.equal(autoTurnHeuristicGate(msg), "model");
    assert.equal(autoTurnHeuristicGate("open https://nseindia.com and tell me the title"), "model");
  });

  it("vague 'what' is chat follow-up, not a computer goal", () => {
    const c = classifyMessageIntent("what");
    assert.equal(c.intent, "question");
    // greeting_or_chitchat or vague_chat_followup — both stay chat.
    assert.ok(
      c.reason === "vague_chat_followup" || c.reason === "greeting_or_chitchat",
      c.reason
    );
    assert.equal(autoTurnHeuristicGate("what"), "model");
  });
});

describe("memory store mis-queue is forced back to reply", () => {
  it("ensureAutoTurnResult converts promise-only ack → queue for CRM create", async () => {
    const {
      ensureAutoTurnResult,
      looksLikePromiseOnlyComputerAck,
      looksLikeLiveComputerJobRequest,
      looksLikeSendEmailRequest,
    } = await import("../src/utils/chatAutoTurn.js");
    const { looksLikeComposioAppRequest } = await import("../src/utils/messageIntent.js");
    const msg =
      "Create a new account in crm and send credentials to fastagconsultant@gmail.com";
    assert.equal(looksLikeComposioAppRequest(msg), false);
    assert.equal(looksLikeLiveComputerJobRequest(msg), true);
    assert.equal(
      looksLikePromiseOnlyComputerAck("On it — creating the new Vughy account now."),
      true
    );
    const out = ensureAutoTurnResult(
      {
        action: "reply",
        content: "On it — creating the new Vughy account now.",
        reason: "model_auto_turn_text",
      },
      { userText: msg, agentName: "Trial Expiry Checker vughy India" }
    );
    assert.equal(out.action, "queue_goal");
    assert.match(out.reason, /promise_ack_to_queue/);
    assert.equal(out.goal, msg);
  });

  it("SMTP harden does not steal Composio send or status questions", async () => {
    const { looksLikeSendEmailRequest, ensureAutoTurnResult } = await import(
      "../src/utils/chatAutoTurn.js"
    );
    assert.equal(looksLikeSendEmailRequest("Did you send the email"), false);
    assert.equal(looksLikeSendEmailRequest("Send email using composio"), false);
    assert.equal(looksLikeSendEmailRequest("send them the emails"), true);
    const blocked = ensureAutoTurnResult(
      { action: "queue_goal", goal: "send them the emails", reason: "x" },
      { userText: "Send email using composio", emailConfigured: false }
    );
    assert.notEqual(blocked.reason, "x_send_email_smtp_missing");
    assert.notMatch(String(blocked.content || ""), /SMTP settings/i);
  });

  it("ensureAutoTurnResult converts queue_goal → reply for remember prefs", async () => {
    const { ensureAutoTurnResult } = await import("../src/utils/chatAutoTurn.js");
    const msg =
      "Remember these permanent preferences for this agent — do not start a computer task, just acknowledge and store them:\n1) CRM admin login is https://vughy.com/admin";
    const out = ensureAutoTurnResult(
      {
        action: "queue_goal",
        goal: msg,
        ack: "Starting computer…",
        reason: "model_queue",
      },
      { userText: msg, agentName: "Trial" }
    );
    assert.equal(out.action, "reply");
    assert.match(out.reason, /memory_store_forced_reply/);
    assert.equal(out.goal, "");
  });

  it("ensureAutoTurnResult converts queue_goal → reply for day history", async () => {
    const { ensureAutoTurnResult } = await import("../src/utils/chatAutoTurn.js");
    const msg = "tell me clearly what we did today with timestamp";
    const out = ensureAutoTurnResult(
      {
        action: "queue_goal",
        goal: msg,
        ack: "Starting computer…",
        reason: "model_queue",
      },
      { userText: msg, agentName: "Trial" }
    );
    assert.equal(out.action, "reply");
    assert.match(out.reason, /day_history_forced_reply/);
  });

  it("formatDayHistoryChatAnswer uses dayLogs not Mem0 prefs", async () => {
    const { formatDayHistoryChatAnswer } = await import("../src/utils/chatAutoTurn.js");
    const out = formatDayHistoryChatAnswer({
      dayHistoryRecent: [
        {
          day: new Date().toISOString().slice(0, 10),
          at: new Date().toISOString(),
          summary: "• Checked India trial list — 5 accounts verified",
          detail:
            "• Checked India trial list — 5 accounts verified\n---\n• Opened https://vughy.com/admin — page title Admin Login",
        },
      ],
      dayHistoryRelevant: [],
    });
    assert.match(out, /day history/i);
    assert.match(out, /India trial|Admin Login/i);
    assert.equal(/long scratchpads/i.test(out), false);
  });

  it("formatDayHistoryChatAnswer answers domain yes/no from logs", async () => {
    const { formatDayHistoryChatAnswer } = await import("../src/utils/chatAutoTurn.js");
    const snap = {
      dayHistoryRecent: [
        {
          day: new Date().toISOString().slice(0, 10),
          at: new Date().toISOString(),
          summary: "Opened yahoo.com",
          detail: "• Opened yahoo.com — page title Yahoo",
        },
      ],
      dayHistoryRelevant: [],
    };
    const yes = formatDayHistoryChatAnswer(snap, "did we open yahoo.com today?");
    assert.match(yes, /^Yes/i);
    assert.match(yes, /yahoo\.com/i);
    const no = formatDayHistoryChatAnswer(snap, "did we opened nseindia.com today ?");
    assert.match(no, /^No/i);
    assert.match(no, /nseindia\.com/i);
  });
});

describe("Auto reply scratchpad must not leak", () => {
  const leaked = [
    'We need answer. User asks "can you also open webistes for me" — capability question, no specific site.',
    "Per instructions, reply directly, don't queue. We already answered earlier. Output REPLY with plain sentence.REPLY",
    "Yes, I can open websites for you. Just tell me the website or URL you want opened.",
  ].join("\n");

  it("extracts body after glued …REPLY marker", () => {
    const body = extractAfterLastReplyMarker(leaked);
    assert.ok(body);
    assert.match(body, /^Yes, I can open websites/i);
    assert.equal(/capability question|Per instructions/i.test(body), false);
  });

  it("parseAutoTurnOutput returns only the user sentence", () => {
    const parsed = parseAutoTurnOutput(leaked, "can you also open webistes for me");
    assert.equal(parsed.action, "reply");
    assert.match(parsed.content, /^Yes, I can open websites/i);
    assert.equal(/capability question|We need answer|Output REPLY/i.test(parsed.content), false);
  });

  it("sanitize drops deliberation without a REPLY marker", () => {
    const dump =
      "We need answer. Capability question, no specific site. Per instructions, reply directly, don't queue. We can say yes.";
    const out = sanitizeAutoReplyContent(dump);
    assert.equal(/capability question|We need answer|Per instructions/i.test(out), false);
  });
});

describe("confirm yes after computer offer", () => {
  it("does not cheap-ack yes/sure", async () => {
    const { cheapChatReplyIfAny, looksLikeAffirmativeConfirm, resolveConfirmComputerGoalFromMessages } =
      await import("../src/utils/chatAutoTurn.js");
    assert.equal(cheapChatReplyIfAny("yes"), null);
    assert.equal(cheapChatReplyIfAny("sure"), null);
    assert.equal(cheapChatReplyIfAny("hi"), "Hi — I'm here. Ask a question or send a computer goal.");
    assert.equal(looksLikeAffirmativeConfirm("yes"), true);
    const goal = resolveConfirmComputerGoalFromMessages([
      { _id: "a1", role: "user", content: "can you open example.com" },
      {
        _id: "a2",
        role: "assistant",
        content: "Yes, I can open example.com for you. Want me to do that now?",
      },
      { _id: "a3", role: "user", content: "yes" },
    ], { excludeIds: ["a3"] });
    assert.match(String(goal || ""), /open example\.com/i);
  });
});
