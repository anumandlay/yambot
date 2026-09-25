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
  isEphemeralListResult,
  looksLikeListDumpBody,
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

  it("flags multi-row trial list dumps", () => {
    const dump = [
      "Trial expiry list:",
      "- a@x.com expires 2026-01-01",
      "- b@y.com expires 2026-01-02",
      "- c@z.com expires 2026-01-03",
      "- d@w.com expires 2026-01-04",
    ].join("\n");
    assert.equal(looksLikeListDumpBody(dump), true);
    assert.equal(isEphemeralCuratedFact(dump), true);
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

describe("isEphemeralListResult", () => {
  it("flags get-the-list goals with row dumps", () => {
    const summary = [
      "Found 4 trial accounts:",
      "1. a@x.com — expires tomorrow",
      "2. b@y.com — expires in 3 days",
      "3. c@z.com — expires next week",
      "4. d@w.com — expires in 10 days",
    ].join("\n");
    assert.equal(
      isEphemeralListResult({
        goal: "get the India trial expiry list",
        summary,
      }),
      true
    );
  });

  it("keeps short durable run results", () => {
    assert.equal(
      isEphemeralListResult({
        goal: "register a CRM account with dummy data",
        summary: "Created account demo@example.com on Vughy.",
      }),
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
