/**
 * Unit tests for Composio toolkit tool cache + prompt injection.
 */
import assert from "node:assert/strict";
import {
  normalizeToolkitSlug,
  setAgentComposioToolkitToolCache,
  getAgentComposioCachedTools,
  clearAgentComposioToolkitToolCache,
  isComposioToolkitCacheFresh,
  matchToolkitsForUserText,
  formatComposioToolkitCatalogForPrompt,
} from "../src/utils/composioService.js";

assert.equal(normalizeToolkitSlug("gmail"), "gmail");

const agent = {
  composio: {
    enabled: true,
    toolkitSlugs: ["gmail", "notion", "slack"],
    toolkitToolCache: {},
  },
};

setAgentComposioToolkitToolCache(agent, "gmail", [
  {
    slug: "GMAIL_FETCH_EMAILS",
    name: "Fetch emails",
    description: "Fetch a list of emails from Gmail inbox",
  },
  {
    slug: "GMAIL_SEND_EMAIL",
    name: "Send email",
    description: "Send an email via Gmail",
  },
]);

const cached = getAgentComposioCachedTools(agent, "gmail");
assert.equal(cached.length, 2);
assert.equal(cached[0].slug, "GMAIL_FETCH_EMAILS");
assert.ok(isComposioToolkitCacheFresh(agent.composio.toolkitToolCache.gmail));

assert.deepEqual(matchToolkitsForUserText("check my unread gmail", ["gmail", "notion"]), [
  "gmail",
]);
assert.deepEqual(matchToolkitsForUserText("post hi on slack", ["gmail", "slack"]), ["slack"]);
assert.deepEqual(matchToolkitsForUserText("open google.com", ["gmail", "slack"]), []);

const prompt = formatComposioToolkitCatalogForPrompt(agent, {
  userText: "list my unread emails in gmail",
  maxChars: 2000,
});
assert.match(prompt, /CONNECTED APP TOOLS/);
assert.match(prompt, /GMAIL_FETCH_EMAILS/);
assert.doesNotMatch(prompt, /notion/i);

const emptyPrompt = formatComposioToolkitCatalogForPrompt(agent, {
  userText: "open vughy.com and click login",
});
assert.equal(emptyPrompt, "");

clearAgentComposioToolkitToolCache(agent, "gmail");
assert.equal(getAgentComposioCachedTools(agent, "gmail").length, 0);

console.log("composioToolkitToolCache ok");
