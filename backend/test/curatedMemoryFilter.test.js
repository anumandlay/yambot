/**
 * @fileoverview Unit tests for ephemeral curated MEMORY filtering.
 * Purpose: Prove one-off Auto goals / if-rules never count as durable facts.
 * Run: node --test test/curatedMemoryFilter.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterDurableCuratedFacts,
  isEphemeralCuratedFact,
} from "../src/utils/curatedMemoryFilter.js";

describe("isEphemeralCuratedFact", () => {
  it("flags ACTIVE USER MESSAGE / if-rule dumps", () => {
    const bad =
      "That means count the India trial-expiring accounts; if the count is more than 1, send a message to 'general agent' saying 'hi'; otherwise do not message. Report the total count and whether the message was sent. ACTIVE USER MESSAGE (authoritative conditions): check the trial expiring list again. if there are more than 1";
    assert.equal(isEphemeralCuratedFact(bad), true);
  });

  it("flags QUEUE_GOAL / GOAL prefixes", () => {
    assert.equal(isEphemeralCuratedFact("GOAL: open vughy and count accounts"), true);
    assert.equal(isEphemeralCuratedFact("QUEUE_GOAL do the thing"), true);
  });

  it("keeps durable site facts", () => {
    assert.equal(
      isEphemeralCuratedFact(
        "When registering a CRM (Vughy) account without details, use dummy data to complete the form."
      ),
      false
    );
    assert.equal(
      isEphemeralCuratedFact("CRM means https://vughy.com for this workspace."),
      false
    );
  });
});

describe("filterDurableCuratedFacts", () => {
  it("drops ephemeral rows and keeps durable ones", () => {
    const out = filterDurableCuratedFacts([
      "That means count the India trial-expiring accounts; if more than 1 message general agent",
      "Vughy signup: country dropdown then state",
      "short",
      "",
    ]);
    assert.deepEqual(out, ["Vughy signup: country dropdown then state"]);
  });
});
