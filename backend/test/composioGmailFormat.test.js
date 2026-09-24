/**
 * @fileoverview Gmail unread formatting + send-clause guards for check-email.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGmailUnreadSummaryFromToolResult,
  looksLikeSendEmailClause,
  filterSpuriousComposioSendSteps,
  planComposioMultiSteps,
  extractGmailMessageFields,
} from "../src/utils/composioAutoRuntime.js";
import { looksLikeFakeComposioActionText } from "../src/utils/chatAutoTurn.js";

test("formatGmailUnreadSummary reads payload.headers From/Subject", () => {
  const payload = {
    ok: true,
    data: {
      messages: [
        {
          id: "m1",
          payload: {
            headers: [
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "Subject", value: "Trial ends tomorrow" },
            ],
          },
          snippet: "Your trial expires soon",
        },
      ],
    },
  };
  const text = formatGmailUnreadSummaryFromToolResult(JSON.stringify(payload), "GMAIL_FETCH_EMAILS");
  assert.match(text, /Alice <alice@example.com>/);
  assert.match(text, /Trial ends tomorrow/);
  assert.match(text, /Your trial expires soon/);
  assert.doesNotMatch(text, /Unknown sender/);
});

test("extractGmailMessageFields handles object from", () => {
  const f = extractGmailMessageFields({
    from: { name: "Bob", email: "bob@x.com" },
    subject: "Hi",
  });
  assert.equal(f.sender, "Bob <bob@x.com>");
  assert.equal(f.subject, "Hi");
});

test("check email is not a send clause even with an address nearby", () => {
  assert.equal(looksLikeSendEmailClause("check email"), false);
  assert.equal(looksLikeSendEmailClause("check email for bob@x.com"), false);
  assert.equal(looksLikeSendEmailClause("send summary to bob@x.com"), true);
  assert.equal(looksLikeSendEmailClause("email the list to bob@x.com"), true);
});

test("filterSpuriousComposioSendSteps drops invented email on check email", () => {
  const plan = [
    { kind: "intent", specId: "gmail_unread", label: "Gmail unread", toolkit: "gmail" },
    {
      kind: "send_email",
      label: "Email me",
      toolkit: "gmail",
      to: "fastagconsultant@gmail.com",
      usePriorContent: true,
    },
  ];
  const filtered = filterSpuriousComposioSendSteps(plan, "check email");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].kind, "intent");
});

test("planComposioMultiSteps check email is single unread step", () => {
  const plan = planComposioMultiSteps("check email");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].specId, "gmail_unread");
});

test("bare composio_search is fake action text", () => {
  assert.equal(looksLikeFakeComposioActionText('composio_search(query="gmail")'), true);
  assert.equal(looksLikeFakeComposioActionText("Top unread from Gmail today"), false);
});
