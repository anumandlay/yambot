/**
 * @fileoverview Chat context fill / 50% summarize threshold helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chatContextBudgetFromTokens,
  CHAT_SUMMARIZE_FILL_RATIO,
} from "../src/utils/llmContextWindow.js";
import {
  estimateChatFillTokens,
  isContextEligibleMessage,
} from "../src/utils/chatContext.js";

describe("chat summarize at 50% context", () => {
  it("budget exposes half-window summarizeAtTokens", () => {
    const b = chatContextBudgetFromTokens(100_000);
    assert.equal(CHAT_SUMMARIZE_FILL_RATIO, 0.5);
    assert.equal(b.summarizeAtTokens, 50_000);
    assert.equal(b.summarizeFillRatio, 0.5);
  });

  it("estimateChatFillTokens uses ~4 chars per token", () => {
    const tokens = estimateChatFillTokens(
      { contextSummary: "abcd" },
      [{ content: "x".repeat(396) }]
    );
    assert.equal(tokens, 100);
  });

  it("excludes context_summary bubbles from eligible packing", () => {
    assert.equal(
      isContextEligibleMessage({
        role: "assistant",
        content: "Chat summarized…",
        meta: { kind: "context_summary" },
      }),
      false
    );
  });
});
