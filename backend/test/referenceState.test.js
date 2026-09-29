/**
 * Saved list and pending question resolve short replies before the model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  listFromMcpCatalogText,
  presentedListFromLookup,
  resolveStoredReference,
} from "../src/utils/referenceState.js";

const catalog = [
  "Server: mockmcp",
  "1. mcp_mockmcp_greetme — Greet the user",
  "2. mcp_mockmcp_mockmcpstatus — Get the server status",
].join("\n");

test("stores the MCP catalog as a numbered record", () => {
  const list = listFromMcpCatalogText(catalog);
  assert.equal(list.items[0].target.name, "mcp_mockmcp_greetme");
  assert.equal(list.items[1].index, 2);
});

test("a copied name selects the stored item, and a row word does not", () => {
  const state = { pending: null, lastPresentedList: listFromMcpCatalogText(catalog) };
  assert.equal(resolveStoredReference("1", state), null);
  assert.equal(resolveStoredReference("the second one", state), null);
  assert.equal(
    resolveStoredReference("mcp_mockmcp_greetme", state)?.target.name,
    "mcp_mockmcp_greetme"
  );
  const waiting = {
    pending: {
      expects: "name",
      target: { type: "mcp_tool", name: "mcp_mockmcp_greetme" },
    },
    lastPresentedList: state.lastPresentedList,
  };
  assert.equal(resolveStoredReference("Ayamu", waiting)?.args.name, "Ayamu");
  assert.equal(resolveStoredReference("1", waiting), null);
});

test("yes confirms the saved tool and no cancels it", () => {
  const state = {
    pending: {
      expects: "yes_no",
      target: { type: "mcp_tool", name: "mcp_mockmcp_greetme" },
      offeredName: "Ayamu",
    },
    lastPresentedList: listFromMcpCatalogText(catalog),
  };
  assert.equal(resolveStoredReference("yes", state), null);
  assert.equal(resolveStoredReference("no", state), null);
});

test("skill and agent lookups become stored lists", () => {
  const skills = presentedListFromLookup(
    "skills_list",
    JSON.stringify({ skills: [{ id: "abc", name: "Trial list", slug: "trial-list" }] })
  );
  assert.equal(skills.items[0].target.type, "skill");
  assert.equal(resolveStoredReference("1", { lastPresentedList: skills }), null);
  assert.equal(resolveStoredReference("trial-list", { lastPresentedList: skills })?.target.name, "trial-list");
  assert.equal(resolveStoredReference("Trial list", { lastPresentedList: skills })?.target.name, "trial-list");
  const agents = presentedListFromLookup(
    "list_peer_agents",
    JSON.stringify({ peers: ["General"] })
  );
  assert.equal(resolveStoredReference("1", { lastPresentedList: agents }), null);
  assert.equal(resolveStoredReference("General", { lastPresentedList: agents })?.target.type, "agent");
});
