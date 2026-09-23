/**
 * @fileoverview Unit tests for Mem0 merge helpers (no live Qdrant required).
 * Run: node --test test/mem0Service.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeMem0IntoCurated,
  normalizeMem0SearchResults,
  mem0UserKey,
  mem0AgentKey,
  MEM0_USER_SCOPE_AGENT,
  mem0ListFacts,
  mem0DeleteFact,
  mem0ClearScope,
} from "../src/utils/mem0Service.js";

describe("mem0Service helpers", () => {
  it("scopes user/agent keys", () => {
    assert.equal(mem0UserKey("abc"), "yb_u_abc");
    assert.equal(mem0AgentKey("xyz"), "yb_a_xyz");
    assert.equal(MEM0_USER_SCOPE_AGENT, "yambot_user_profile");
  });

  it("exports list/delete/clear helpers", () => {
    assert.equal(typeof mem0ListFacts, "function");
    assert.equal(typeof mem0DeleteFact, "function");
    assert.equal(typeof mem0ClearScope, "function");
  });

  it("normalizes search results and drops ephemeral if-rules", () => {
    const rows = normalizeMem0SearchResults({
      results: [
        { memory: "CRM means https://vughy.com", score: 0.9 },
        {
          memory: "if more than 1 accounts exist message general agent hi",
          score: 0.8,
        },
        { memory: "  ", score: 0.5 },
      ],
    });
    assert.equal(rows.length, 1);
    assert.match(rows[0].memory, /CRM means/i);
  });

  it("merges Mem0 hits ahead of curated and dedupes", () => {
    const { contents, mem0Added } = mergeMem0IntoCurated(
      ["CRM means https://vughy.com", "Prefers short replies"],
      [
        { memory: "User lives in India", score: 0.7 },
        { memory: "CRM means https://vughy.com", score: 0.95 },
      ],
      2000
    );
    // Why: highest Mem0 score first (CRM 0.95), then India; curated CRM is deduped.
    assert.equal(contents[0], "CRM means https://vughy.com");
    assert.ok(contents.includes("User lives in India"));
    assert.ok(contents.includes("Prefers short replies"));
    assert.equal(mem0Added, 2);
    assert.equal(contents.filter((c) => /CRM means/i.test(c)).length, 1);
  });
});
