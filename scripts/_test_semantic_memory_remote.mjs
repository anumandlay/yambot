/**
 * Live semantic-memory test on VPS api container.
 * 1) Synthetic store (NYSE vs travel/Gmail) + real LLM embeddings when available
 * 2) Agent 6aab1936… real curated MEMORY ranked for an NYSE goal
 */
import mongoose from "mongoose";
import { Agent } from "./src/models/Agent.js";
import { User } from "./src/models/User.js";
import { resolveLlmCredentialsForAgent } from "./src/utils/llmCredentials.js";
import {
  selectCuratedSubset,
  resolveCuratedMemoryForPrompt,
} from "./src/utils/semanticMemory.js";

const AGENT_ID = "6aab1936c3494ba65ded7680";
const GOAL = "tell @Content Inspector to open https://www.nyse.com/index";

const SYNTHETIC = [
  "NYSE tasks: open index page, screenshot headlines",
  "Peer CI handles content QA, not navigation",
  "Stock index pages often have delayed quotes",
  "Content Inspector reviews text quality only",
  "Travel CRM: signup uses country dropdown then state",
  "Gmail OTP: check inbox after submit",
  "Hotel booking: passport number goes in guest form",
  "Vughy travel agency registration flow notes",
  "Avoid clicking Download app banners",
  "Prefers visible browser not headless",
  "Always confirm before submit on banking sites",
  "Salesforce lead status must be set to Working",
];

const uri = process.env.MONGODB_URI || "mongodb://mongo:27017/yambot";
await mongoose.connect(uri);

const agent = await Agent.findById(AGENT_ID);
if (!agent) {
  console.log("AGENT_MISSING", AGENT_ID);
  await mongoose.disconnect();
  process.exit(1);
}
const user = await User.findById(agent.user);
const creds = user ? await resolveLlmCredentialsForAgent(user, agent) : null;

console.log(
  JSON.stringify(
    {
      agent: { id: String(agent._id), name: agent.name },
      goal: GOAL,
      llm: {
        hasKey: Boolean(creds?.apiKey),
        baseUrl: creds?.llmBaseUrl || null,
        model: creds?.llmModel || null,
        source: creds?.source || null,
      },
      realCuratedCount: Array.isArray(agent.curatedMemory?.entries)
        ? agent.curatedMemory.entries.length
        : 0,
    },
    null,
    2
  )
);

console.log("\n=== SYNTHETIC STORE (12 mixed facts) ===");
const synth = await selectCuratedSubset(SYNTHETIC, GOAL, creds, 20000);
console.log(
  JSON.stringify(
    {
      mode: synth.mode,
      selected: synth.selected,
      total: synth.total,
      contents: synth.contents,
    },
    null,
    2
  )
);

const relevantRe = /NYSE|Stock index|Content Inspector|Peer CI|nyse/i;
const noiseRe = /Travel CRM|Hotel booking|Gmail OTP|Salesforce|Vughy travel/i;
const top = synth.contents.slice(0, 5);
const relevantTop = top.filter((c) => relevantRe.test(c)).length;
const noiseTop = top.filter((c) => noiseRe.test(c)).length;
const synthPass =
  relevantTop >= 3 &&
  relevantTop > noiseTop &&
  relevantRe.test(synth.contents[0] || "");
console.log(
  JSON.stringify({
    check: "synthetic_top_prefers_nyse",
    mode: synth.mode,
    selected: synth.selected,
    top5: top,
    relevantTop,
    noiseTop,
    pass: synthPass,
  })
);

console.log("\n=== REAL AGENT CURATED MEMORY ===");
const real = await resolveCuratedMemoryForPrompt({
  userEntries: user?.curatedMemory?.entries || [],
  agentEntries: agent.curatedMemory?.entries || [],
  goal: GOAL,
  creds,
});
console.log(
  JSON.stringify(
    {
      meta: real.meta,
      agentSelected: real.agentCuratedEntries,
      userSelected: real.userCuratedEntries,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify({
    overallPass: synthPass,
    note: synthPass
      ? "Synthetic ranking OK — LLM will see NYSE-related facts first for this goal."
      : "Synthetic ranking weak — check embeddings support on this LLM base URL.",
  })
);

await mongoose.disconnect();
process.exit(synthPass ? 0 : 2);
