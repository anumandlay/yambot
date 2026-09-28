/**
 * @fileoverview Unit tests: per-agent Jev gate + Auto hint with optional Jev lines.
 * Run: node --test test/jevAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAutoClassifierHint, buildAutoUserContent } from "../src/utils/chatAutoTurn.js";
import {
  JEV_CONFIDENT_MIN,
  isJevEnabled,
  resolveJevModel,
  publicJevSummary,
  summarizeJevForChatMeta,
  outcomeFromAutoTurn,
  jevCaseSignature,
  collapseSimilarJevCases,
  buildJevAutoEvaluatePayload,
  parseJevCaseGroups,
  applyJevCaseGroups,
} from "../src/utils/jevEvaluate.js";

describe("Auto classifier hint (optional Jev)", () => {
  it("describes three modes without Jev lines when Jev absent", () => {
    const hint = formatAutoClassifierHint("hi", {});
    assert.match(hint, /three modes/i);
    assert.match(hint, /Composio tools/i);
    assert.doesNotMatch(hint, /jev_action=/);
  });

  it("includes Jev preference when decision present", () => {
    const hint = formatAutoClassifierHint("hi", {
      jev: { action: "composio", choice: "composio", confidence: 0.91, reason: "jev_confident" },
    });
    assert.match(hint, /jev_action=composio/);
    assert.match(hint, /Jev prefers Composio/i);
  });

  it("packs USER MESSAGE and optional jev_reason", () => {
    const packed = buildAutoUserContent("hello", {
      jev: { action: "uncertain", reason: "jev_error", confidence: 0 },
    });
    assert.match(packed, /USER MESSAGE:\nhello/);
    assert.match(packed, /jev_reason=jev_error/);
  });

  it("keeps JEV_CONFIDENT_MIN for probes", () => {
    assert.ok(JEV_CONFIDENT_MIN >= 0.5 && JEV_CONFIDENT_MIN < 1);
  });

  it("isJevEnabled is false for legacy string modes / missing key", () => {
    assert.equal(isJevEnabled("off"), false);
    assert.equal(isJevEnabled("auto"), false);
    assert.equal(isJevEnabled("on"), false);
    assert.equal(isJevEnabled({ enabled: true, apiKey: "" }), false);
    assert.equal(isJevEnabled({ enabled: false, apiKey: "sk" }), false);
  });

  it("maps the retired Vercel model id to official jev-latest", () => {
    assert.equal(resolveJevModel("typesafe-ai/jev"), "jev-latest");
    assert.equal(resolveJevModel(""), "jev-latest");
    assert.equal(resolveJevModel("jev-1.13.0"), "jev-1.13.0");
  });

  it("isJevEnabled is true for per-agent enabled + key", () => {
    assert.equal(isJevEnabled({ enabled: true, apiKey: "sk-test" }), true);
    assert.equal(isJevEnabled({ enabled: true, apiKey: "sk-test", jevMode: "off" }), false);
  });

  it("publicJevSummary exposes the key field for the editor", () => {
    const summary = publicJevSummary({
      jev: { enabled: true, apiKeyEnc: "enc-blob" },
    });
    assert.equal(summary.enabled, true);
    assert.equal(summary.hasApiKey, true);
    assert.equal(summary.configured, true);
    assert.equal(typeof summary.apiKey, "string");
  });

  it("summarizeJevForChatMeta marks used/decided for chips", () => {
    assert.equal(summarizeJevForChatMeta(null, { enabled: false }), undefined);
    const skipped = summarizeJevForChatMeta(null, { enabled: true });
    assert.equal(skipped?.used, false);
    assert.equal(skipped?.reason, "not_called");
    const decided = summarizeJevForChatMeta(
      {
        action: "reply",
        choice: "reply",
        confidence: 0.9,
        reason: "jev_confident",
        probabilities: { reply: 0.9, queue_goal: 0.05, composio: 0.05 },
        evaluate: {
          model: "jev-latest",
          state: { user_message: "hi" },
          questions: { action: { instructions: "pick", criteria: { reply: "x" } } },
          answer: { choice: "reply", probabilities: { reply: 0.9 } },
        },
      },
      { enabled: true }
    );
    assert.equal(decided?.used, true);
    assert.equal(decided?.decided, true);
    assert.equal(decided?.action, "reply");
    assert.equal(decided?.evaluate?.answer?.choice, "reply");
    assert.ok(decided?.evaluate?.questions?.action);
    const unsure = summarizeJevForChatMeta(
      { action: "uncertain", choice: "reply", confidence: 0.4, reason: "jev_low_confidence" },
      { enabled: true }
    );
    assert.equal(unsure?.used, true);
    assert.equal(unsure?.decided, false);
  });

  it("outcomeFromAutoTurn uses final path not Jev guess", () => {
    assert.equal(outcomeFromAutoTurn({ action: "queue_goal" }), "queue_goal");
    assert.equal(
      outcomeFromAutoTurn({
        action: "reply",
        reason: "composio_list_direct",
        timing: { lookups: ["composio_list"] },
      }),
      "composio"
    );
    assert.equal(outcomeFromAutoTurn({ action: "reply", reason: "jev_confident_reply" }), "reply");
  });

  it("merges reply cases that differ only by the day", () => {
    const a = "what did we do yesterday";
    const b = "what did we do day before yesterday";
    assert.equal(jevCaseSignature(a), jevCaseSignature(b));
    assert.notEqual(jevCaseSignature(a), jevCaseSignature("open vughy.com and login"));
    const cases = [
      { userMessage: a, outcome: "reply", reason: "jev_confident_reply", at: "2026-09-28T17:11:05.000Z" },
      { userMessage: b, outcome: "reply", reason: "jev_confident_reply", at: "2026-09-28T17:11:35.000Z" },
      { userMessage: "open vughy.com", outcome: "queue_goal", reason: "jev_confident_queue", at: "2026-09-28T17:00:00.000Z" },
    ];
    assert.equal(collapseSimilarJevCases(cases), 1);
    assert.equal(cases.length, 2);
    assert.equal(cases[0].userMessage, b);
    const payload = buildJevAutoEvaluatePayload("what did we do today", {
      cases: [
        { userMessage: a, outcome: "reply" },
        { userMessage: b, outcome: "reply" },
      ],
    });
    assert.equal(payload.state.learned_cases.length, 1);
  });

  it("keeps the newest wording when the model groups the same job", () => {
    const groups = parseJevCaseGroups(
      '```json\n{"groups":[["a","b"],["c","computer"]]}\n```'
    );
    assert.deepEqual(groups, [
      ["a", "b"],
      ["c", "computer"],
    ]);
    const cases = [
      { _id: "a", userMessage: "get the india trial list", outcome: "reply", at: "2026-09-28T17:00:00.000Z" },
      { _id: "b", userMessage: "show india trials expiring", outcome: "reply", at: "2026-09-28T17:05:00.000Z" },
      { _id: "c", userMessage: "open vughy.com", outcome: "queue_goal", at: "2026-09-28T17:06:00.000Z" },
      { _id: "computer", userMessage: "open nseindia.com", outcome: "queue_goal", at: "2026-09-28T17:07:00.000Z" },
    ];
    assert.equal(applyJevCaseGroups(cases, groups), 2);
    assert.deepEqual(
      cases.map((c) => c._id),
      ["b", "computer"]
    );
    const crossed = [
      { _id: "r", userMessage: "what did we do", outcome: "reply", at: "2026-09-28T17:00:00.000Z" },
      { _id: "q", userMessage: "open the site", outcome: "queue_goal", at: "2026-09-28T17:01:00.000Z" },
    ];
    assert.equal(applyJevCaseGroups(crossed, [["r", "q"]]), 0);
    assert.equal(crossed.length, 2);
  });
});
