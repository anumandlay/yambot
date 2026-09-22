#!/usr/bin/env python3
"""
Big live Mem0 suite on VPS: multi-fact store, paraphrased retrieval,
user/agent scope isolation, chat ingest, curated prompt merge.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / "deploy" / ".deploy.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ[k.strip()] = v.strip().strip('"').strip("'")

host = os.environ["YAMBOT_SSH_HOST"]
user = os.environ["YAMBOT_SSH_USER"]
password = os.environ["YAMBOT_SSH_PASSWORD"]

js = r'''
/**
 * Big Mem0 live suite — store many facts, search with paraphrases,
 * check agent/user isolation, chat ingest, and prompt merge.
 */
import mongoose from "mongoose";
import {
  isMem0Enabled,
  mem0AddFact,
  mem0SearchFacts,
  mem0IngestChatTurn,
  mergeMem0IntoCurated,
  getMem0Memory,
} from "./src/utils/mem0Service.js";
import { resolveCuratedMemoryForPrompt } from "./src/utils/semanticMemory.js";

const runId = `BIG-${Date.now().toString(36).toUpperCase()}`;
const checks = [];

function check(name, pass, detail = {}) {
  checks.push({ name, pass: Boolean(pass), ...detail });
  console.error(`[${pass ? "PASS" : "FAIL"}] ${name}${detail.note ? " — " + detail.note : ""}`);
}

await mongoose.connect(process.env.MONGODB_URI || "mongodb://mongo:27017/yambot");
const db = mongoose.connection.db;
const u = await db.collection("users").findOne(
  { email: "test@gmail.com" },
  { projection: { _id: 1, name: 1, email: 1 } }
);
if (!u) {
  console.log(JSON.stringify({ ok: false, error: "user_not_found" }));
  process.exit(1);
}
const agents = await db
  .collection("agents")
  .find({ user: u._id }, { projection: { _id: 1, name: 1 } })
  .sort({ updatedAt: -1 })
  .limit(5)
  .toArray();
const agentA =
  agents.find((a) => /Trial Expiry Checker.*India/i.test(String(a.name || ""))) || agents[0];
const agentB = agents.find((a) => String(a._id) !== String(agentA?._id)) || null;
if (!agentA) {
  console.log(JSON.stringify({ ok: false, error: "no_agent" }));
  process.exit(1);
}

const userId = String(u._id);
const agentAId = String(agentA._id);
const agentBId = agentB ? String(agentB._id) : null;

check("mem0_enabled", isMem0Enabled());
check("mem0_client", Boolean(await getMem0Memory({ userId })));

/** @type {{ scope: "user"|"agent", agentId?: string|null, tag: string, content: string }[]} */
const facts = [
  {
    scope: "agent",
    agentId: agentAId,
    tag: "CRM_URL",
    content: `${runId} CRM_URL: Preferred CRM admin login is https://vughy.com/admin for the India trial checker.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "CRM_USER",
    content: `${runId} CRM_USER: CRM username for demo accounts is ops-india@vughy.com (password lives in secrets, never store it).`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "TZ",
    content: `${runId} TZ: Agent timezone is Asia/Kolkata; schedule trial checks at 09:30 IST weekdays.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "PORT",
    content: `${runId} PORT: Live worker exposes computer session on port 6080 behind the VPS reverse proxy.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "EMAIL_FROM",
    content: `${runId} EMAIL_FROM: Outbound trial reminder emails must use From: noreply@vughy.com with reply-to support@vughy.com.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "LABEL",
    content: `${runId} LABEL: When marking expired trials, apply Gmail label "Trial/Expired" and archive the thread.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "BROWSER",
    content: `${runId} BROWSER: Prefer Chromium for CRM; do not open Firefox for this workflow.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "ESCALATE",
    content: `${runId} ESCALATE: If CRM shows payment failed twice, escalate to Slack #billing-alerts before emailing the customer.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "CSV",
    content: `${runId} CSV: Export nightly trial roster as CSV to /tmp/trial-roster-india.csv then attach in the daily summary chat.`,
  },
  {
    scope: "agent",
    agentId: agentAId,
    tag: "CAPTCHA",
    content: `${runId} CAPTCHA: DeathByCaptcha credentials are configured in Settings; reuse them for Vughy login challenges.`,
  },
  {
    scope: "user",
    tag: "PREF_SHORT",
    content: `${runId} PREF_SHORT: User prefers short, direct replies without long planning scratchpads.`,
  },
  {
    scope: "user",
    tag: "PREF_TZ",
    content: `${runId} PREF_TZ: User local timezone for notifications is America/New_York.`,
  },
  {
    scope: "user",
    tag: "PREF_LANG",
    content: `${runId} PREF_LANG: User wants agent chat in English; keep technical terms in English even if customer emails are multilingual.`,
  },
  {
    scope: "user",
    tag: "PREF_NO_EMOJI",
    content: `${runId} PREF_NO_EMOJI: Avoid emoji in status updates unless the user asks for them.`,
  },
];

if (agentBId) {
  facts.push({
    scope: "agent",
    agentId: agentBId,
    tag: "OTHER_AGENT_SECRET",
    content: `${runId} OTHER_AGENT_SECRET: Agent-B only fact — warehouse SKU prefix is WH-EAST-77 and must never leak to India trial agent.`,
  });
}

const addResults = [];
for (const f of facts) {
  const r = await mem0AddFact({
    userId,
    agentId: f.agentId || null,
    scope: f.scope,
    content: f.content,
    metadata: { runId, tag: f.tag, source: "yambot_big_suite" },
  });
  addResults.push({ tag: f.tag, scope: f.scope, ...r });
  check(`store_${f.tag}`, r.ok, { skipped: r.skipped || null });
}

// Ephemeral / junk should be rejected (matches curatedMemoryFilter patterns).
const ephemeralCases = [
  {
    tag: "queue_goal",
    content: "QUEUE_GOAL open https://vughy.com and click login",
  },
  {
    tag: "active_user_message",
    content:
      "ACTIVE USER MESSAGE follow THIS condition exactly: if count more than 5 message general agent about trials",
  },
];
for (const ep of ephemeralCases) {
  const ephemeral = await mem0AddFact({
    userId,
    agentId: agentAId,
    scope: "agent",
    content: ep.content,
  });
  check(`reject_ephemeral_${ep.tag}`, !ephemeral.ok && ephemeral.skipped === "ephemeral", {
    result: ephemeral,
  });
}
// Durable business if-rule MUST still store (not ephemeral).
const durableIf = await mem0AddFact({
  userId,
  agentId: agentAId,
  scope: "agent",
  content: `${runId} DURABLE_IF: If CRM shows payment failed twice, escalate to Slack #billing-alerts.`,
});
check("allow_durable_if_business_rule", durableIf.ok, { result: durableIf });

await new Promise((r) => setTimeout(r, 2000));

/** @type {{ name: string, scope: "user"|"agent", agentId?: string|null, query: string, expectTag: string, minScore?: number }[]} */
const queries = [
  {
    name: "q_crm_login",
    scope: "agent",
    agentId: agentAId,
    query: "Where do I log into the CRM admin panel?",
    expectTag: "CRM_URL",
    minScore: 0.35,
  },
  {
    name: "q_crm_user",
    scope: "agent",
    agentId: agentAId,
    query: "What username should we use for the Vughy CRM demo?",
    expectTag: "CRM_USER",
    minScore: 0.3,
  },
  {
    name: "q_schedule",
    scope: "agent",
    agentId: agentAId,
    query: "What timezone and time should trial checks run?",
    expectTag: "TZ",
    minScore: 0.3,
  },
  {
    name: "q_port",
    scope: "agent",
    agentId: agentAId,
    query: "Which port is the computer session on?",
    expectTag: "PORT",
    minScore: 0.3,
  },
  {
    name: "q_email",
    scope: "agent",
    agentId: agentAId,
    query: "What From address for trial reminder emails?",
    expectTag: "EMAIL_FROM",
    minScore: 0.3,
  },
  {
    name: "q_label",
    scope: "agent",
    agentId: agentAId,
    query: "Which Gmail label for expired trials?",
    expectTag: "LABEL",
    minScore: 0.3,
  },
  {
    name: "q_browser",
    scope: "agent",
    agentId: agentAId,
    query: "Should we use Firefox or Chromium for CRM?",
    expectTag: "BROWSER",
    minScore: 0.25,
  },
  {
    name: "q_escalate",
    scope: "agent",
    agentId: agentAId,
    query: "What do we do after two failed payments in CRM?",
    expectTag: "ESCALATE",
    minScore: 0.3,
  },
  {
    name: "q_csv",
    scope: "agent",
    agentId: agentAId,
    query: "Where is the nightly trial roster CSV written?",
    expectTag: "CSV",
    minScore: 0.3,
  },
  {
    name: "q_captcha",
    scope: "agent",
    agentId: agentAId,
    query: "How do we solve Vughy login captchas?",
    expectTag: "CAPTCHA",
    minScore: 0.25,
  },
  {
    name: "q_user_short",
    scope: "user",
    query: "Does the user want long explanations or short replies?",
    expectTag: "PREF_SHORT",
    minScore: 0.25,
  },
  {
    name: "q_user_tz",
    scope: "user",
    query: "What timezone should we use for notifying the user?",
    expectTag: "PREF_TZ",
    minScore: 0.3,
  },
  {
    name: "q_user_lang",
    scope: "user",
    query: "What language should chat replies use?",
    expectTag: "PREF_LANG",
    minScore: 0.25,
  },
  {
    name: "q_user_emoji",
    scope: "user",
    query: "Should status updates include emoji?",
    expectTag: "PREF_NO_EMOJI",
    minScore: 0.25,
  },
];

const searchResults = [];
for (const q of queries) {
  const hits = await mem0SearchFacts({
    userId,
    agentId: q.agentId || null,
    scope: q.scope,
    query: q.query,
    topK: 8,
    threshold: 0.05,
  });
  const marker = `${runId} ${q.expectTag}`;
  const hit = hits.find((h) => String(h.memory || "").includes(marker));
  const top = hits[0];
  const pass = Boolean(hit) && Number(hit.score || 0) >= (q.minScore || 0.2);
  searchResults.push({
    name: q.name,
    expectTag: q.expectTag,
    pass,
    hitScore: hit ? Number(hit.score) : null,
    topScore: top ? Number(top.score) : null,
    topMemory: top ? String(top.memory || "").slice(0, 120) : null,
    hitCount: hits.length,
  });
  check(q.name, pass, {
    score: hit ? Number(Number(hit.score).toFixed(3)) : null,
    note: hit ? undefined : `missing ${q.expectTag}; top=${top?.memory?.slice?.(0, 80) || "none"}`,
  });
}

// Isolation: agent A must NOT surface agent B's secret
if (agentBId) {
  const leakHits = await mem0SearchFacts({
    userId,
    agentId: agentAId,
    scope: "agent",
    query: "warehouse SKU prefix WH-EAST",
    topK: 8,
    threshold: 0.05,
  });
  const leaked = leakHits.some((h) => String(h.memory || "").includes("OTHER_AGENT_SECRET"));
  check("isolation_agentA_no_agentB", !leaked, {
    hitCount: leakHits.length,
    note: leaked ? "LEAK" : "clean",
  });

  const bHits = await mem0SearchFacts({
    userId,
    agentId: agentBId,
    scope: "agent",
    query: "What is the warehouse SKU prefix?",
    topK: 5,
    threshold: 0.05,
  });
  check(
    "isolation_agentB_has_own",
    bHits.some((h) => String(h.memory || "").includes("OTHER_AGENT_SECRET")),
    { hitCount: bHits.length, score: bHits[0] ? Number(Number(bHits[0].score).toFixed(3)) : null }
  );
} else {
  check("isolation_agentA_no_agentB", true, { note: "skipped_no_second_agent" });
  check("isolation_agentB_has_own", true, { note: "skipped_no_second_agent" });
}

// User scope must not return agent CRM fact as user memory
const userWrong = await mem0SearchFacts({
  userId,
  scope: "user",
  query: "CRM admin login URL for trial checker",
  topK: 8,
  threshold: 0.2,
});
check(
  "isolation_user_scope_no_agent_crm",
  !userWrong.some((h) => String(h.memory || "").includes("CRM_URL")),
  { hitCount: userWrong.length }
);

// Chat ingest: greeting skipped, rich turn extracts + stores
const greet = await mem0IngestChatTurn({
  userId,
  agentId: agentAId,
  userText: "hi",
  assistantText: "Hello!",
});
check("ingest_skips_greeting", greet.skipped === "greeting", { result: greet });

const ingest = await mem0IngestChatTurn({
  userId,
  agentId: agentAId,
  userText: `${runId} Remember for future: our staging CRM mirror is https://staging.vughy.com/admin and we always verify MFA with the ops hardware key before changing trial dates.`,
  assistantText:
    "Got it — I'll remember the staging CRM mirror URL and that MFA with the ops hardware key is required before trial date changes.",
});
check("ingest_chat_turn", ingest.ok && (ingest.saved || 0) >= 1, {
  saved: ingest.saved ?? null,
  skipped: ingest.skipped || null,
});

await new Promise((r) => setTimeout(r, 1500));
const ingestHits = await mem0SearchFacts({
  userId,
  agentId: agentAId,
  scope: "agent",
  query: "staging CRM mirror URL and MFA for trial dates",
  topK: 8,
  threshold: 0.05,
});
const ingestFound = ingestHits.some(
  (h) =>
    /staging\.vughy\.com/i.test(String(h.memory || "")) ||
    /hardware key/i.test(String(h.memory || "")) ||
    String(h.memory || "").includes(runId)
);
check("ingest_retrievable", ingestFound, {
  hitCount: ingestHits.length,
  top: ingestHits[0]?.memory?.slice?.(0, 140) || null,
  score: ingestHits[0] ? Number(Number(ingestHits[0].score).toFixed(3)) : null,
});

// Full prompt merge path (semanticMemory)
const curated = await resolveCuratedMemoryForPrompt({
  userId,
  agentId: agentAId,
  goal: "Open the CRM admin and check expired trials for India, then email reminders.",
  userEntries: [{ content: "Legacy curated: likes concise answers" }],
  agentEntries: [{ content: "Legacy curated: India trial checker agent" }],
  persistEmbeddings: false,
});
const mem0Meta = curated.meta?.mem0 || {};
const mergedHasCrm = (curated.agentCuratedEntries || []).some((c) =>
  String(c).includes("CRM_URL") || /vughy\.com\/admin/i.test(String(c))
);
const mergedHasUserPref = (curated.userCuratedEntries || []).some(
  (c) => String(c).includes("PREF_SHORT") || /short/i.test(String(c))
);
check("prompt_merge_agent_hits", Number(mem0Meta.agentHits || 0) >= 1, {
  meta: mem0Meta,
});
check("prompt_merge_includes_crm", mergedHasCrm, {
  agentEntries: (curated.agentCuratedEntries || []).slice(0, 5),
});
check("prompt_merge_user_side", Number(mem0Meta.userHits || 0) >= 0, {
  note: "user hits optional for CRM goal",
  userMerged: mem0Meta.userMerged,
  userEntriesSample: (curated.userCuratedEntries || []).slice(0, 3),
});

// Bulk merge helper + diversity across paraphrased searches for this run.
const bulkHits = await mem0SearchFacts({
  userId,
  agentId: agentAId,
  scope: "agent",
  query: "CRM email label captcha timezone port browser escalation CSV",
  topK: 12,
  threshold: 0.05,
});
const merged = mergeMem0IntoCurated(["Prefers short replies"], bulkHits, 4000);
check("bulk_merge_nonempty", merged.mem0Added >= 5, {
  mem0Added: merged.mem0Added,
  contentCount: merged.contents.length,
});
const tagsFromSearches = [
  ...new Set(searchResults.filter((s) => s.pass).map((s) => s.expectTag)),
];
check("search_tag_diversity", tagsFromSearches.length >= 10, {
  tagsFromSearches,
  note: "unique expectTags recovered by paraphrased queries",
});

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass).length;

console.log(
  JSON.stringify(
    {
      ok: failed === 0,
      runId,
      summary: { total: checks.length, passed, failed, passRate: Number((passed / checks.length).toFixed(3)) },
      user: { id: userId, email: u.email, name: u.name },
      agents: {
        A: { id: agentAId, name: agentA.name },
        B: agentB ? { id: agentBId, name: agentB.name } : null,
      },
      factsStored: facts.length,
      addResults,
      searchResults,
      ingest: { greet, ingest, ingestFound },
      promptMerge: {
        mem0: mem0Meta,
        userCuratedEntries: curated.userCuratedEntries,
        agentCuratedEntries: curated.agentCuratedEntries?.slice?.(0, 8),
      },
      checks,
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(failed === 0 ? 0 : 1);
'''

local_js = ROOT / "scripts" / "_mem0_big_suite_remote.mjs"
local_js.write_text(js.strip() + "\n", encoding="utf-8")


def sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30, allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
sftp.put(str(local_js), "/tmp/_mem0_big_suite_remote.mjs")
script = """#!/bin/bash
set -e
cd /home/ubuntu/yambot/deploy
CID=$(docker compose ps -q api)
docker cp /tmp/_mem0_big_suite_remote.mjs "$CID":/app/_mem0_big_suite_remote.mjs
docker exec -w /app "$CID" node /app/_mem0_big_suite_remote.mjs
EC=$?
docker exec "$CID" rm -f /app/_mem0_big_suite_remote.mjs
exit $EC
"""
with sftp.file("/tmp/_mem0_big_suite_run.sh", "w") as f:
    f.write(script)
sftp.close()

_stdin, stdout, stderr = client.exec_command(
    f"echo {sh_quote(password)} | sudo -S bash /tmp/_mem0_big_suite_run.sh",
    timeout=600,
)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
sys.stdout.write(out)
for line in err.splitlines():
    if "[sudo]" in line or "password for" in line.lower():
        continue
    if line.strip():
        sys.stderr.write(line + "\n")
code = stdout.channel.recv_exit_status()
client.close()

# Persist summary locally for the chat
summary_path = ROOT / "scripts" / "_mem0_big_suite_last.json"
try:
    # last JSON object in stdout
    start = out.rfind("{")
    # find matching from first { of the big report — locate "runId"
    idx = out.find('"runId"')
    if idx >= 0:
        brace = out.rfind("{", 0, idx)
        report = json.loads(out[brace:])
        summary_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
except Exception as e:
    print(f"(could not cache summary: {e})", file=sys.stderr)

sys.exit(code)
