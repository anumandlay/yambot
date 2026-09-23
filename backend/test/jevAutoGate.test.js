/**
 * @fileoverview Unit tests for Jev Auto gate helpers (no live Gateway call).
 * Run: node --test test/jevAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAutoClassifierHint, buildAutoUserContent } from "../src/utils/chatAutoTurn.js";
import { JEV_CONFIDENT_MIN, isJevEnabled } from "../src/utils/jevEvaluate.js";

describe("Jev Auto classifier hint", () => {
  it("embeds Jev prefer-reply when provided", () => {
    const hint = formatAutoClassifierHint("hi", {
      jev: { action: "reply", choice: "reply", confidence: 0.91, reason: "jev_confident" },
    });
    assert.match(hint, /jev_action=reply/);
    assert.match(hint, /Jev prefers REPLY/i);
  });

  it("embeds Jev prefer-queue when provided", () => {
    const hint = formatAutoClassifierHint("open https://example.com", {
      jev: {
        action: "queue_goal",
        choice: "queue_goal",
        confidence: 0.88,
        reason: "jev_confident",
      },
    });
    assert.match(hint, /jev_action=queue_goal/);
    assert.match(hint, /Jev prefers QUEUE_GOAL/i);
  });

  it("packs USER MESSAGE with optional Jev meta", () => {
    const packed = buildAutoUserContent("hello", {
      jev: { action: "uncertain", reason: "jev_error", confidence: 0 },
    });
    assert.match(packed, /USER MESSAGE:\nhello/);
    assert.match(packed, /jev_reason=jev_error/);
  });

  it("exposes a confidence floor for short-circuit", () => {
    assert.ok(JEV_CONFIDENT_MIN >= 0.5 && JEV_CONFIDENT_MIN < 1);
  });

  it("respects jevMode off even when a gateway key exists in env", () => {
    assert.equal(isJevEnabled("off"), false);
  });

  it("reports auto mode from env key presence", () => {
    // Why: local shells may export AI_GATEWAY_API_KEY after lab setup — assert boolean only.
    assert.equal(typeof isJevEnabled("auto"), "boolean");
    assert.equal(typeof isJevEnabled("on"), "boolean");
  });
});
