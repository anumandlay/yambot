/**
 * @fileoverview Hermes Phase 2 — Composio approval gate + Auto wall/abort helpers.
 * Run: node --test test/hermesPhase2.test.js (from backend/)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isComposioReadOnlyTool,
  composioToolRequiresApproval,
  composioSpecRequiresApproval,
  composioPlanRequiresApproval,
  looksLikeComposioRiskyConfirm,
  looksLikeComposioRiskyDeny,
  formatPendingComposioApprovalReply,
  isAutoWallBudgetExceeded,
  formatAutoBudgetStopReply,
  resolvePendingComposioApprovalFromMessages,
  AUTO_CHAT_MAX_WALL_MS,
} from "../src/utils/composioApprovalGate.js";
import { AUTO_CHAT_MAX_TOOL_ROUNDS, AUTO_CHAT_MAX_WALL_MS as WALL_FROM_AUTO } from "../src/utils/chatAutoTurn.js";

describe("composio read-only vs send approval", () => {
  it("skips approval for read/search/list tools", () => {
    for (const slug of [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_LIST_MESSAGES",
      "GMAIL_SEARCH_MESSAGES",
      "GOOGLESHEETS_SEARCH_SPREADSHEETS",
      "GOOGLESHEETS_BATCH_GET",
      "NOTION_SEARCH",
      "GOOGLEDRIVE_FIND_FILE",
    ]) {
      assert.equal(isComposioReadOnlyTool(slug), true, slug);
      assert.equal(composioToolRequiresApproval(slug), false, slug);
    }
  });

  it("requires approval for send/write tools", () => {
    for (const slug of [
      "GMAIL_SEND_EMAIL",
      "SLACK_SEND_MESSAGE",
      "SLACK_POST_MESSAGE",
      "NOTION_CREATE_PAGE",
      "NOTION_UPDATE_PAGE",
      "GMAIL_ADD_LABEL_TO_EMAIL",
    ]) {
      assert.equal(composioToolRequiresApproval(slug), true, slug);
      assert.equal(isComposioReadOnlyTool(slug), false, slug);
    }
  });

  it("gates risky deterministic specs and multi-step send kinds", () => {
    assert.equal(composioSpecRequiresApproval("gmail_unread"), false);
    assert.equal(composioSpecRequiresApproval("sheets_list"), false);
    assert.equal(composioSpecRequiresApproval("slack_send"), true);
    assert.equal(composioSpecRequiresApproval("notion_write"), true);
    assert.equal(composioSpecRequiresApproval("gmail_label"), true);
    assert.equal(
      composioPlanRequiresApproval([
        { kind: "intent", specId: "gmail_unread" },
        { kind: "send_email", label: "Email list" },
      ]),
      true
    );
    assert.equal(
      composioPlanRequiresApproval([{ kind: "intent", specId: "sheets_list" }]),
      false
    );
  });

  it("recognizes confirm send / yes and cancel", () => {
    assert.equal(looksLikeComposioRiskyConfirm("yes"), true);
    assert.equal(looksLikeComposioRiskyConfirm("confirm send"), true);
    assert.equal(looksLikeComposioRiskyConfirm("approve"), true);
    assert.equal(looksLikeComposioRiskyConfirm("check my email please"), false);
    assert.equal(looksLikeComposioRiskyDeny("cancel"), true);
    assert.equal(looksLikeComposioRiskyDeny("no"), true);
    assert.equal(looksLikeComposioRiskyDeny("send the weekly report"), false);
  });

  it("formats a clear pending reply", () => {
    const text = formatPendingComposioApprovalReply({
      label: "GMAIL_SEND_EMAIL",
      summary: "to: a@b.com\nsubject: Hi",
    });
    assert.match(text, /confirm send/i);
    assert.match(text, /GMAIL_SEND_EMAIL/);
  });

  it("resolves pending from newest assistant meta only", () => {
    const pending = resolvePendingComposioApprovalFromMessages([
      {
        _id: "3",
        role: "assistant",
        content: "Need confirm",
        meta: { pendingComposioApproval: { mode: "execute", tool: "GMAIL_SEND_EMAIL" } },
      },
      { _id: "2", role: "user", content: "send mail" },
      {
        _id: "1",
        role: "assistant",
        content: "old",
        meta: { pendingComposioApproval: { mode: "execute", tool: "OLD" } },
      },
    ]);
    assert.equal(pending?.tool, "GMAIL_SEND_EMAIL");
    assert.equal(
      resolvePendingComposioApprovalFromMessages([
        { _id: "2", role: "assistant", content: "done", meta: { kind: "chat_qa" } },
        {
          _id: "1",
          role: "assistant",
          meta: { pendingComposioApproval: { tool: "STALE" } },
        },
      ]),
      null
    );
  });
});

describe("Auto wall budget + abort helpers", () => {
  it("exports wall budget alongside tool round cap", () => {
    assert.equal(AUTO_CHAT_MAX_TOOL_ROUNDS, 6);
    assert.equal(AUTO_CHAT_MAX_WALL_MS, 120_000);
    assert.equal(WALL_FROM_AUTO, 120_000);
  });

  it("detects wall exceeded", () => {
    assert.equal(isAutoWallBudgetExceeded(1_000, 1_000 + 119_000, 120_000), false);
    assert.equal(isAutoWallBudgetExceeded(1_000, 1_000 + 120_000, 120_000), true);
  });

  it("formats stop replies", () => {
    assert.match(formatAutoBudgetStopReply("abort"), /disconnect/i);
    assert.match(formatAutoBudgetStopReply("wall"), /time budget/i);
  });
});
