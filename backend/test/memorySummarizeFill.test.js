/**
 * @fileoverview Memory summarizer runs only past half the model context window.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentMemoryExceedsHalfWindow,
  estimateAgentMemoryFillTokens,
} from "../src/utils/memorySummarizeCron.js";
import { chatContextBudgetFromTokens } from "../src/utils/llmContextWindow.js";

describe("agent memory summarize at 50% context", () => {
  it("counts day logs, notes, and curated entries as tokens", () => {
    const tokens = estimateAgentMemoryFillTokens({
      dayLogs: [{ summary: "a".repeat(40), detail: "b".repeat(40) }],
      memory: [{ content: "c".repeat(40) }],
      curatedMemory: { entries: [{ content: "d".repeat(40) }] },
    });
    assert.equal(tokens, 40);
  });

  it("stays under the half-window gate for a short memory", () => {
    const creds = { contextTokens: 100_000 };
    const half = chatContextBudgetFromTokens(creds).summarizeAtTokens;
    assert.equal(half, 50_000);
    assert.equal(
      agentMemoryExceedsHalfWindow(
        { dayLogs: [{ summary: "short note", detail: "" }], memory: [], curatedMemory: { entries: [] } },
        creds
      ),
      false
    );
  });

  it("crosses the gate when stored memory is half the window", () => {
    const creds = { contextTokens: 8_000 };
    const half = chatContextBudgetFromTokens(creds).summarizeAtTokens;
    const agent = {
      dayLogs: [{ summary: "x".repeat(half * 4), detail: "" }],
      memory: [],
      curatedMemory: { entries: [] },
    };
    assert.equal(agentMemoryExceedsHalfWindow(agent, creds), true);
  });
});
