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

test("1 selects the stored item and a pending name wins", () => {
  const state = { pending: null, lastPresentedList: listFromMcpCatalogText(catalog) };
  assert.equal(resolveStoredReference("1", state)?.target.name, "mcp_mockmcp_greetme");
  assert.equal(resolveStoredReference("the second one", state)?.target.name, "mcp_mockmcp_mockmcpstatus");
  const waiting = {
    pending: {
      expects: "name",
      target: { type: "mcp_tool", name: "mcp_mockmcp_greetme" },
    },
    lastPresentedList: state.lastPresentedList,
  };
  assert.equal(resolveStoredReference("Ayamu", waiting)?.args.name, "Ayamu");
  assert.equal(resolveStoredReference("1", waiting)?.kind, "ask");
  assert.equal(resolveStoredReference("yes", waiting), null);
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
  const yes = resolveStoredReference("yes", state);
  assert.equal(yes?.source, "pending_confirmation");
  assert.equal(yes?.args.name, "Ayamu");
  assert.equal(resolveStoredReference("no", state)?.kind, "cancel");
});

test("skill and agent lookups become stored lists", () => {
  const skills = presentedListFromLookup(
    "skills_list",
    JSON.stringify({ skills: [{ id: "abc", name: "Trial list", slug: "trial-list" }] })
  );
  assert.equal(skills.items[0].target.type, "skill");
  assert.equal(resolveStoredReference("1", { lastPresentedList: skills })?.target.name, "trial-list");
  const agents = presentedListFromLookup(
    "list_peer_agents",
    JSON.stringify({ peers: ["General"] })
  );
  assert.equal(resolveStoredReference("1", { lastPresentedList: agents })?.target.type, "agent");
});
