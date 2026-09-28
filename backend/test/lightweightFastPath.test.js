/**
 * Unit tests — Hermes-style tool decision (answer-direct by default).
 */
import assert from "node:assert/strict";
import {
  autoTurnNeedsTools,
  looksLikeLightweightChat,
  createAutoTimingTracker,
  mcpFollowupDirective,
  parseFakeMcpGadgetText,
} from "../src/utils/chatAutoTurn.js";

// Answer-direct (no tools) — Hermes under-2s path
assert.equal(autoTurnNeedsTools("how are you"), false);
assert.equal(autoTurnNeedsTools("what is a TTL cache?"), false);
assert.equal(autoTurnNeedsTools("explain your reply flow briefly"), false);
assert.equal(autoTurnNeedsTools("nice weather today"), false);

// Tools needed
assert.equal(autoTurnNeedsTools("check my gmail inbox"), true);
assert.equal(autoTurnNeedsTools("check email"), true);
assert.equal(autoTurnNeedsTools("open google.com and search cats"), true);
assert.equal(autoTurnNeedsTools("are you still running a task?"), true);
assert.equal(autoTurnNeedsTools("list my peer agents"), true);
assert.equal(
  autoTurnNeedsTools("list my connected apps", { composioEnabled: true }),
  true
);
assert.equal(
  autoTurnNeedsTools("list my connected apps", { composioEnabled: false }),
  false
);
assert.equal(
  autoTurnNeedsTools("Use mockmcp. Greet me. My name is Ayamu.", {
    mcpEnabled: true,
    mcpServerNames: ["mockmcp"],
  }),
  true
);
assert.equal(
  autoTurnNeedsTools("Use mockmcp. Greet me. My name is Ayamu.", {
    mcpEnabled: false,
    mcpServerNames: ["mockmcp"],
  }),
  false
);
assert.equal(autoTurnNeedsTools("Use the mcp server status.", { mcpEnabled: true }), true);
assert.equal(autoTurnNeedsTools("list of mcps", { mcpEnabled: true }), true);

const mcpList = [
  {
    role: "assistant",
    content:
      "1. mcp_mockmcp_greetme\n2. mcp_mockmcp_mockmcpstatus\n3. mcp_mockmcp_generatecar",
  },
];
assert.match(mcpFollowupDirective("1", mcpList), /mcp_mockmcp_greetme/);
assert.match(mcpFollowupDirective("call no.1", mcpList), /mcp_mockmcp_greetme/);
assert.equal(mcpFollowupDirective("yes", mcpList), "");
assert.match(
  mcpFollowupDirective("Ayamu", [
    ...mcpList,
    { role: "assistant", content: "You mean tool #1. Whose name should I use?" },
  ]),
  /name "Ayamu"/
);
const gadgets = parseFakeMcpGadgetText(
  '<tool_req><gadget name="mcp_mockmcp_greetme"><arg name="name">Ayamu</arg></gadget></tool_req>'
);
assert.equal(gadgets[0].name, "mcp_mockmcp_greetme");
assert.equal(gadgets[0].args.name, "Ayamu");

assert.equal(looksLikeLightweightChat("how are you"), true);
assert.equal(looksLikeLightweightChat("check my gmail"), false);

const track = createAutoTimingTracker();
track.setPath("text_fast");
track.markDecision("reply");
const fin = track.finish();
assert.equal(fin.path, "text_fast");
assert.equal(fin.decisionAction, "reply");

console.log("hermes tool decision ok");
