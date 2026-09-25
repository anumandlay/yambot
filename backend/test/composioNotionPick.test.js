/**
 * @fileoverview Notion Composio intent / tool-pick regression checks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeNotionFetchRequest,
  looksLikeNotionWriteRequest,
  matchComposioIntent,
  pickBestComposioTool,
  composioToolScoreForSpec,
  formatNotionSummaryFromToolResult,
} from "../src/utils/composioAutoRuntime.js";
import { looksLikeComposioPayloadError } from "../src/utils/composioService.js";

test("search pages in notion → fetch, not write", () => {
  const t = "search pages in notion using composio";
  assert.equal(looksLikeNotionFetchRequest(t), true);
  assert.equal(looksLikeNotionWriteRequest(t), false);
  assert.equal(matchComposioIntent(t)?.id, "notion_fetch");
});

test("create demo page in notion → write", () => {
  const t = "create a demo page in notion using composio";
  assert.equal(looksLikeNotionWriteRequest(t), true);
  assert.equal(looksLikeNotionFetchRequest(t), false);
  assert.equal(matchComposioIntent(t)?.id, "notion_write");
});

test("notion_write pick prefers page create over comment", () => {
  const tools = [
    { slug: "NOTION_CREATE_COMMENT" },
    { slug: "NOTION_CREATE_NOTION_PAGE" },
    { slug: "NOTION_SEARCH" },
  ];
  const picked = pickBestComposioTool(
    tools,
    ["NOTION_CREATE_PAGE", "NOTION_CREATE_NOTION_PAGE"],
    composioToolScoreForSpec("notion_write")
  );
  assert.equal(picked, "NOTION_CREATE_NOTION_PAGE");
});

test("payload validation errors are detected", () => {
  assert.equal(
    looksLikeComposioPayloadError({
      message: "Invalid request data provided\n- Following fields are missing: {'comment'}",
      status_code: 400,
    }),
    true
  );
  assert.equal(
    formatNotionSummaryFromToolResult(
      JSON.stringify({
        ok: true,
        data: { message: "Invalid request", status_code: 400 },
      }),
      "NOTION_CREATE_COMMENT"
    ).includes("failed"),
    true
  );
});
