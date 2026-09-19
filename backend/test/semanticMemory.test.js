/**
 * @fileoverview Unit tests for built-in semantic curated memory selection.
 * Purpose: Prove NYSE-like goals prefer NYSE facts over unrelated travel/Gmail notes.
 * Run: node --test test/semanticMemory.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  keywordScore,
  selectCuratedSubset,
  SEMANTIC_FULL_INJECT_BELOW,
} from "../src/utils/semanticMemory.js";

/** Build a simple orthogonal-ish vector space for fake embeddings. */
function vec(axis, noise = 0) {
  const v = [0, 0, 0, 0];
  v[axis] = 1;
  if (noise) v[(axis + 1) % 4] = noise;
  return v;
}

describe("cosineSimilarity", () => {
  it("ranks identical vectors highest", () => {
    const a = [1, 0, 0];
    assert.ok(cosineSimilarity(a, a) > 0.99);
    assert.ok(cosineSimilarity(a, [0, 1, 0]) < 0.01);
  });
});

describe("keywordScore", () => {
  it("scores nyse goal against nyse fact", () => {
    const q = "open https://www.nyse.com/index for headlines";
    assert.ok(keywordScore(q, "NYSE tasks: open index page, screenshot headlines") >= 2);
    assert.ok(keywordScore(q, "Travel CRM signup uses country then state") < 2);
  });
});

describe("selectCuratedSubset (semantic with precomputed embeddings)", () => {
  const entries = [
    {
      content: "NYSE tasks: open index page, screenshot headlines",
      at: new Date("2026-09-01"),
      embedding: vec(0),
    },
    {
      content: "Peer CI handles content QA, not navigation",
      at: new Date("2026-09-02"),
      embedding: vec(0, 0.2),
    },
    {
      content: "Travel CRM: signup uses country dropdown then state",
      at: new Date("2026-09-03"),
      embedding: vec(1),
    },
    {
      content: "Gmail OTP: check inbox after submit",
      at: new Date("2026-09-04"),
      embedding: vec(2),
    },
    {
      content: "Avoid clicking Download app banners",
      at: new Date("2026-09-05"),
      embedding: vec(3),
    },
    {
      content: "Prefers visible browser not headless",
      at: new Date("2026-09-06"),
      embedding: vec(1, 0.1),
    },
    {
      content: "Vughy travel agency registration flow notes",
      at: new Date("2026-09-07"),
      embedding: vec(1, 0.3),
    },
    {
      content: "Stock index pages often have delayed quotes",
      at: new Date("2026-09-08"),
      embedding: vec(0, 0.15),
    },
    {
      content: "Always confirm before submit on banking sites",
      at: new Date("2026-09-09"),
      embedding: vec(2, 0.2),
    },
    {
      content: "Content Inspector reviews text quality only",
      at: new Date("2026-09-10"),
      embedding: vec(0, 0.25),
    },
    {
      content: "Hotel booking: passport number goes in guest form",
      at: new Date("2026-09-11"),
      embedding: vec(1, 0.4),
    },
  ];

  it("injects all when store is small", async () => {
    const small = entries.slice(0, SEMANTIC_FULL_INJECT_BELOW - 1);
    const result = await selectCuratedSubset(
      small,
      "open nyse.com/index",
      null,
      20000
    );
    assert.equal(result.mode, "all");
    assert.equal(result.selected, small.length);
  });

  it("picks NYSE-related facts for an NYSE goal via embeddings", async () => {
    const goalEmb = vec(0, 0.05);
    const scored = entries
      .map((e) => ({
        content: e.content,
        score: cosineSimilarity(goalEmb, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.content);

    assert.ok(scored.some((c) => /NYSE/i.test(c)));
    assert.ok(scored.some((c) => /Stock index|Content Inspector|Peer CI/i.test(c)));
    // Top-5 by cosine should be axis-0 (NYSE cluster), not pure travel/gmail axes.
    const noiseInTop = scored.filter((c) =>
      /Travel CRM|Hotel booking|Gmail OTP/i.test(c)
    ).length;
    assert.ok(noiseInTop <= 1);
  });

  it("keyword fallback prefers nyse over travel when no embeddings API", async () => {
    const noEmb = entries.map(({ content, at }) => ({ content, at }));
    // Force above full-inject threshold
    assert.ok(noEmb.length > SEMANTIC_FULL_INJECT_BELOW);
    const result = await selectCuratedSubset(
      noEmb,
      "tell Content Inspector to open https://www.nyse.com/index",
      null,
      20000
    );
    assert.equal(result.mode, "keyword");
    const joined = result.contents.join("\n");
    assert.ok(/NYSE|Stock index|Content Inspector|Peer CI/i.test(joined));
    // Travel/Gmail should not dominate the selected set
    const travelHits = result.contents.filter((c) =>
      /Travel CRM|Hotel booking|Gmail OTP/i.test(c)
    ).length;
    const nyseHits = result.contents.filter((c) =>
      /NYSE|Stock index|Content Inspector|Peer CI|nyse/i.test(c)
    ).length;
    assert.ok(nyseHits >= travelHits);
  });
});
