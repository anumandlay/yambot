/**
 * @fileoverview Unit tests: Jev retired; Auto hint exposes three LLM-owned modes.
 * Run: node --test test/jevAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAutoClassifierHint, buildAutoUserContent } from "../src/utils/chatAutoTurn.js";
import { JEV_CONFIDENT_MIN, isJevEnabled } from "../src/utils/jevEvaluate.js";

describe("Auto classifier hint (Jev removed)", () => {
  it("describes three modes without Jev lines", () => {
    const hint = formatAutoClassifierHint("hi", {
      jev: { action: "reply", choice: "reply", confidence: 0.91, reason: "jev_confident" },
    });
    assert.match(hint, /three modes/i);
    assert.match(hint, /Composio tools/i);
    assert.doesNotMatch(hint, /jev_action=/);
    assert.doesNotMatch(hint, /Jev prefers/i);
  });

  it("packs USER MESSAGE without Jev meta", () => {
    const packed = buildAutoUserContent("hello", {
      jev: { action: "uncertain", reason: "jev_error", confidence: 0 },
    });
    assert.match(packed, /USER MESSAGE:\nhello/);
    assert.doesNotMatch(packed, /jev_reason=/);
  });

  it("keeps JEV_CONFIDENT_MIN for legacy probes", () => {
    assert.ok(JEV_CONFIDENT_MIN >= 0.5 && JEV_CONFIDENT_MIN < 1);
  });

  it("isJevEnabled is always false (retired)", () => {
    assert.equal(isJevEnabled("off"), false);
    assert.equal(isJevEnabled("auto"), false);
    assert.equal(isJevEnabled("on"), false);
  });
});
