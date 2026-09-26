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
  publicJevSummary,
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

  it("isJevEnabled is true for per-agent enabled + key", () => {
    assert.equal(isJevEnabled({ enabled: true, apiKey: "sk-test" }), true);
    assert.equal(isJevEnabled({ enabled: true, apiKey: "sk-test", jevMode: "off" }), false);
  });

  it("publicJevSummary redacts key", () => {
    const summary = publicJevSummary({
      jev: { enabled: true, apiKeyEnc: "enc-blob" },
    });
    assert.equal(summary.enabled, true);
    assert.equal(summary.hasApiKey, true);
    assert.equal(summary.configured, true);
    assert.equal(summary.apiKeyMasked, "••••••••");
  });
});
