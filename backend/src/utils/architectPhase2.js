/**
 * @fileoverview Phase 2+ Business Architect utilities — simulate, test, impact, change, history, export.
 * Purpose: Complete Architect loop beyond create: safety, templates, English changes.
 * Downstream: architect routes, BusinessArchitectPage hub.
 */

import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { resolveLlmCredentials, resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { normalizeArchitectBlueprint, publicArchitectBlueprint } from "./architectChat.js";
import { normalizeBusinessPlan } from "./businessPlanFromBrief.js";

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {object} user
 * @param {string} [profileId]
 */
async function resolvePlannerCreds(user, profileId) {
  const id = String(profileId || "").trim();
  if (id && id !== "settings") {
    const profile = await LlmProfile.findOne({ _id: id, user: user._id }).lean();
    if (profile) {
      const creds = await resolveLlmCredentialsForAgent(user, {
        llm: { profile: profile._id, useCustom: true },
      });
      if (creds.apiKey) return { ...creds, profileId: String(profile._id) };
    }
  }
  return resolveLlmCredentials(user);
}

/**
 * Synthetic dry-run of the blueprint plan (no side effects).
 * @param {object} blueprintDoc
 * @param {{ customerCount?: number }} [opts]
 */
export function simulateBlueprint(blueprintDoc, opts = {}) {
  const bp = normalizeArchitectBlueprint(blueprintDoc?.blueprint || blueprintDoc);
  const plan = bp?.plan || normalizeBusinessPlan({});
  const agents = plan.agents || [];
  const triggers = plan.triggers || [];
  const apis = plan.apis || [];
  const n = Math.max(1, Math.min(10_000, Number(opts.customerCount) || 100));

  const hasApiGet = apis.some((a) => String(a.method || "").toUpperCase() === "GET");
  const hasEmail = agents.some((a) => a.needsEmail || a.email?.fromAddress);
  const hasPost = apis.some((a) => /POST|PUT|PATCH/i.test(String(a.method || "")));
  const replyRate = 0.12;
  const validRate = 0.87;

  const retrieved = hasApiGet ? n : Math.round(n * 0.3);
  const validEmails = Math.round(retrieved * validRate);
  const emailsWouldSend = hasEmail ? validEmails : 0;
  const statusUpdates = hasPost ? emailsWouldSend : 0;
  const repliesExpected = Math.round(emailsWouldSend * replyRate);
  const followOnAgents = triggers.filter((t) =>
    /email\.replied|email\.received/i.test(String(t.config?.eventType || ""))
  ).length;
  const workflowsStarted = followOnAgents ? repliesExpected : 0;

  const steps = [
    {
      label: "Customer / list source",
      detail: hasApiGet ? "Would call GET API" : "Would use provided list / CRM",
    },
    { label: "Records found", detail: String(retrieved) },
    { label: "Valid emails", detail: String(validEmails) },
    {
      label: "Promotional emails",
      detail: hasEmail ? `${emailsWouldSend} would be sent` : "No email agent",
    },
    {
      label: "API status updates",
      detail: hasPost ? `${statusUpdates} POST/PUT would run` : "None",
    },
    {
      label: "Expected replies",
      detail: `~${repliesExpected} (synthetic ${Math.round(replyRate * 100)}%)`,
    },
    {
      label: "Downstream workflows",
      detail: workflowsStarted
        ? `~${workflowsStarted} would start via reply triggers`
        : "No reply triggers in plan",
    },
  ];

  const failurePlan = [
    ...(bp?.failureHandling || []),
    "API failure → retry up to 3 times → incident + notify admin",
    "Email failure → retry up to 3 times → skip record + log",
    "Duplicate email same day → skip (idempotent)",
    "Browser crash → relaunch profile and resume task",
  ];

  return {
    ok: true,
    simulated: true,
    at: new Date().toISOString(),
    inputCustomers: n,
    steps,
    totals: {
      retrieved,
      validEmails,
      emailsWouldSend,
      statusUpdates,
      repliesExpected,
      workflowsStarted,
      agents: agents.length,
      triggers: triggers.length,
      apis: apis.length,
    },
    failurePlan: [...new Set(failurePlan)].slice(0, 12),
    note: "Nothing was sent or written — simulation only.",
  };
}

/**
 * Structural + rule tests derived from the blueprint plan.
 * @param {object} blueprintDoc
 */
export function runBlueprintTests(blueprintDoc) {
  const bp = normalizeArchitectBlueprint(blueprintDoc?.blueprint || blueprintDoc);
  const plan = bp?.plan || { agents: [], triggers: [], apis: [] };
  const agents = plan.agents || [];
  const triggers = plan.triggers || [];
  const apis = plan.apis || [];

  /** @type {{ id: string, name: string, ok: boolean, detail: string }[]} */
  const tests = [];

  tests.push({
    id: "t_agents",
    name: "At least one agent defined",
    ok: agents.length > 0,
    detail: agents.length ? `${agents.length} agent(s)` : "No agents in plan",
  });

  const scheduled = agents.filter((a) => a.schedule?.enabled);
  tests.push({
    id: "t_schedule_goal",
    name: "Scheduled agents have a goal",
    ok: !scheduled.length || scheduled.every((a) => String(a.schedule?.goal || "").trim()),
    detail: scheduled.length
      ? scheduled.every((a) => a.schedule?.goal)
        ? "All scheduled agents have goals"
        : "Missing schedule.goal"
      : "No schedules (skipped)",
  });

  const emailAgents = agents.filter((a) => a.needsEmail);
  tests.push({
    id: "t_email_fields",
    name: "Email agents noted in plan",
    ok: true,
    detail: emailAgents.length
      ? `${emailAgents.length} email agent(s) — credentials on build`
      : "No email agents",
  });

  const replyTriggers = triggers.filter((t) =>
    /email\.replied|email\.received/i.test(String(t.config?.eventType || ""))
  );
  tests.push({
    id: "t_reply_trigger",
    name: "Reply handling has an event trigger when email is used",
    ok: !emailAgents.length || replyTriggers.length > 0 || triggers.length > 0,
    detail: replyTriggers.length
      ? `${replyTriggers.length} reply/event trigger(s)`
      : emailAgents.length
        ? "Email agents without reply trigger — follow-up may be schedule-only"
        : "N/A",
  });

  for (const t of triggers) {
    const match = agents.some((a) => a.key === t.agentKey);
    tests.push({
      id: `t_trig_${String(t.name).slice(0, 20)}`,
      name: `Trigger “${t.name}” targets a known agent`,
      ok: match,
      detail: match ? `agentKey=${t.agentKey}` : `Unknown agentKey ${t.agentKey}`,
    });
  }

  for (const api of apis) {
    tests.push({
      id: `t_api_${api.method}_${String(api.hostHint || "x").slice(0, 20)}`,
      name: `API ${api.method} ${api.hostHint || "(host)"} has purpose`,
      ok: Boolean(api.purpose && (api.hostHint || api.pathHint)),
      detail: api.purpose || "Missing purpose/host",
    });
  }

  tests.push({
    id: "t_skip_no_email",
    name: "Instructions mention skipping invalid emails when prospecting",
    ok:
      !emailAgents.length ||
      agents.some((a) => /skip|no email|invalid|missing email/i.test(a.instructions || "")),
    detail: "Heuristic check on standing instructions",
  });

  tests.push({
    id: "t_unsubscribe",
    name: "Branch or instructions cover unsubscribe / stop",
    ok:
      (bp?.branches || []).some((b) => /unsub|stop|opt.?out/i.test(b)) ||
      agents.some((a) => /unsub|opt.?out|do not email/i.test(a.instructions || "")) ||
      !emailAgents.length,
    detail: emailAgents.length ? "Recommended for outreach" : "N/A",
  });

  tests.push({
    id: "t_failure",
    name: "Failure handling documented",
    ok: (bp?.failureHandling || []).length > 0 || blueprintDoc?.incidentPolicy != null,
    detail: (bp?.failureHandling || []).length
      ? `${bp.failureHandling.length} rule(s)`
      : "Using default incident policy",
  });

  const passed = tests.filter((t) => t.ok).length;
  return {
    ok: true,
    at: new Date().toISOString(),
    passed,
    failed: tests.length - passed,
    total: tests.length,
    tests,
  };
}

/**
 * Diff two blueprint plans for change impact.
 * @param {object|null} beforeBp
 * @param {object|null} afterBp
 */
export function computeChangeImpact(beforeBp, afterBp) {
  const before =
    normalizeArchitectBlueprint(beforeBp) || {
      plan: { agents: [], triggers: [] },
      checklist: {},
    };
  const after =
    normalizeArchitectBlueprint(afterBp) || {
      plan: { agents: [], triggers: [] },
      checklist: {},
    };
  const bAgents = new Map((before.plan?.agents || []).map((a) => [a.key, a]));
  const aAgents = new Map((after.plan?.agents || []).map((a) => [a.key, a]));
  const bTrig = before.plan?.triggers || [];
  const aTrig = after.plan?.triggers || [];

  const addedAgents = [...aAgents.keys()].filter((k) => !bAgents.has(k));
  const removedAgents = [...bAgents.keys()].filter((k) => !aAgents.has(k));
  const modifiedAgents = [...aAgents.keys()].filter((k) => {
    if (!bAgents.has(k)) return false;
    return JSON.stringify(bAgents.get(k)) !== JSON.stringify(aAgents.get(k));
  });

  const addedTriggers = aTrig.filter(
    (t) => !bTrig.some((x) => x.name === t.name && x.agentKey === t.agentKey)
  );
  const removedTriggers = bTrig.filter(
    (t) => !aTrig.some((x) => x.name === t.name && x.agentKey === t.agentKey)
  );

  const recommendation =
    removedTriggers.length || modifiedAgents.length > 2
      ? "Prefer a separate route/trigger instead of mutating the existing production path."
      : "Safe to apply with approval — limited surface area.";

  return {
    ok: true,
    addedAgents,
    removedAgents,
    modifiedAgents,
    addedTriggers: addedTriggers.map((t) => t.name),
    removedTriggers: removedTriggers.map((t) => t.name),
    checklistBefore: before.checklist,
    checklistAfter: after.checklist,
    recommendation,
    risk: removedTriggers.length || removedAgents.length ? "high" : modifiedAgents.length ? "medium" : "low",
  };
}

/**
 * LLM proposes an English change as a new blueprint patch (not applied).
 * @param {string} userId
 * @param {object} doc
 * @param {string} request
 * @param {string} [profileId]
 */
export async function proposeBlueprintChange(userId, doc, request, profileId) {
  const text = String(request || "").trim();
  if (text.length < 4) {
    return { ok: false, title: "Request too short", detail: "Describe the change in plain English." };
  }
  const user = await User.findById(userId);
  if (!user) return { ok: false, title: "User missing", detail: "Account not found." };
  const creds = await resolvePlannerCreds(user, profileId || doc.profileId);
  if (!creds.apiKey) {
    return { ok: false, title: "LLM not configured", detail: "Pick a planning LLM profile." };
  }

  const current = publicArchitectBlueprint(normalizeArchitectBlueprint(doc.blueprint));

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.2,
      maxTokens: 5000,
      timeoutMs: 90_000,
      messages: [
        {
          role: "system",
          content: [
            "You revise a YamBot Business Architect blueprint from an English change request.",
            "Return JSON only: { summary, businessRule, proposedBlueprint, dataMaps }.",
            "proposedBlueprint must match architect blueprint shape (graph, components, checklist, branches, failureHandling, humanApprovals, reuse, uiMap, plan).",
            "Prefer minimal diffs. Do not remove unrelated agents. If risky, keep old triggers and add a new parallel route.",
            "dataMaps: [{ source, target, note }] for API↔email field mappings when relevant.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "CURRENT_BLUEPRINT:",
            JSON.stringify(current).slice(0, 50_000),
            "",
            "BUSINESS_RULES:",
            JSON.stringify(doc.businessRules || []),
            "",
            "CHANGE_REQUEST:",
            text,
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    return { ok: false, title: "Change LLM failed", detail: err?.message || "LLM error" };
  }

  const parsed = parseJsonObject(raw);
  if (!parsed?.proposedBlueprint) {
    return { ok: false, title: "Could not parse change", detail: "Try rephrasing the change." };
  }

  const proposed = normalizeArchitectBlueprint(parsed.proposedBlueprint);
  if (!proposed?.plan?.agents?.length) {
    return { ok: false, title: "Invalid proposal", detail: "Proposed plan has no agents." };
  }

  const impact = computeChangeImpact(doc.blueprint, proposed);
  return {
    ok: true,
    summary: String(parsed.summary || text).slice(0, 800),
    businessRule: String(parsed.businessRule || text).slice(0, 400),
    dataMaps: Array.isArray(parsed.dataMaps) ? parsed.dataMaps.slice(0, 40) : [],
    proposedBlueprint: publicArchitectBlueprint(proposed),
    impact,
  };
}

/**
 * Execution history from linked agents' recent tasks.
 * @param {string} userId
 * @param {object} doc
 */
export async function loadBlueprintExecutionHistory(userId, doc) {
  const agentIds = doc.createdAgentIds || [];
  if (!agentIds.length) {
    return { ok: true, events: [], note: "No linked agents yet — build first." };
  }

  const tasks = await Task.find({
    user: userId,
    agent: { $in: agentIds },
  })
    .sort({ updatedAt: -1 })
    .limit(40)
    .select("status goalText agent createdAt updatedAt events")
    .lean();

  const agents = await Agent.find({ _id: { $in: agentIds }, user: userId })
    .select("name schedule.lastRunAt schedule.nextRunAt computer.lastSeenAt")
    .lean();

  /** @type {object[]} */
  const events = [];
  for (const a of agents) {
    if (a.schedule?.lastRunAt) {
      events.push({
        at: a.schedule.lastRunAt,
        type: "schedule",
        label: `${a.name}: schedule last run`,
      });
    }
  }
  for (const t of tasks) {
    events.push({
      at: t.updatedAt || t.createdAt,
      type: "task",
      label: `Task ${t.status}: ${String(t.goalText || "").slice(0, 120)}`,
      taskId: String(t._id),
      agentId: String(t.agent),
    });
    const evs = Array.isArray(t.events) ? t.events.slice(-5) : [];
    for (const e of evs) {
      events.push({
        at: e.at || t.updatedAt,
        type: e.type || "event",
        label: `${e.type || "event"}: ${JSON.stringify(e.payload || {}).slice(0, 100)}`,
        taskId: String(t._id),
      });
    }
  }

  events.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  return {
    ok: true,
    events: events.slice(0, 80),
    agents: agents.map((a) => ({ _id: String(a._id), name: a.name })),
  };
}

/**
 * Printable blueprint markdown.
 * @param {object} doc
 */
export function exportBlueprintDocument(doc) {
  const bp = normalizeArchitectBlueprint(doc.blueprint) || {};
  const plan = bp.plan || {};
  const lines = [
    "# Business Automation Blueprint",
    "",
    `Title: ${doc.title || "Untitled"}`,
    `Status: ${doc.status}`,
    `Built: ${doc.builtAt ? new Date(doc.builtAt).toISOString() : "—"}`,
    "",
    "## Objective",
    doc.understanding?.objective || bp.summary || "—",
    "",
    "## Understanding",
    ...(doc.understanding?.bullets || []).map((b) => `- ${b}`),
    "",
    "## Assumptions",
    ...(doc.understanding?.assumptions || []).map((b) => `- ${b}`),
    "",
    "## Business rules",
    ...(doc.businessRules || []).map((b) => `- ${b}`),
    "",
    "## Agents",
    ...(plan.agents || []).map(
      (a) =>
        `- **${a.name}** (${a.key}): ${a.description || a.skill || ""}` +
        (a.schedule?.enabled
          ? ` | schedule ${a.schedule.interval} ${a.schedule.dailyAt || ""}`
          : "")
    ),
    "",
    "## Triggers",
    ...(plan.triggers || []).map(
      (t) =>
        `- **${t.name}** → ${t.agentKey} (${t.type} ${t.config?.eventType || ""}) — ${t.purpose || ""}`
    ),
    "",
    "## APIs",
    ...(plan.apis || []).map(
      (a) => `- ${a.method} ${a.hostHint}${a.pathHint || ""} — ${a.purpose}`
    ),
    "",
    "## Data maps",
    ...(doc.dataMaps || []).map(
      (m) => `- ${m.source || "?"} → ${m.target || "?"} (${m.note || ""})`
    ),
    "",
    "## Branches",
    ...(bp.branches || []).map((b) => `- ${b}`),
    "",
    "## Failure handling",
    ...(bp.failureHandling || []).map((b) => `- ${b}`),
    ...(doc.incidentPolicy
      ? [
          `- Retries: API ${doc.incidentPolicy.apiRetries}, Email ${doc.incidentPolicy.emailRetries}`,
          `- On exhausted: ${doc.incidentPolicy.onExhausted}`,
        ]
      : []),
    "",
    "## Human approvals",
    ...(bp.humanApprovals || []).map((b) => `- ${b}`),
    "",
    "## Checklist",
    "```json",
    JSON.stringify(bp.checklist || {}, null, 2),
    "```",
    "",
    "## Manual setup map",
    ...(bp.uiMap || []).flatMap((row) => [
      `### ${row.page}`,
      row.purpose || "",
      ...(row.fields || []).map((f) => `- ${f.label}: ${f.value}`),
      "",
    ]),
  ];
  return {
    ok: true,
    contentType: "text/markdown",
    filename: `${String(doc.title || "blueprint")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 60)}.md`,
    markdown: lines.filter((l) => l != null).join("\n"),
  };
}

/**
 * Persist high-level facts into CompanyMemory.
 * @param {string} userId
 * @param {object} doc
 */
export async function syncBlueprintToCompanyMemory(userId, doc) {
  const key = `business.${String(doc._id)}.objective`;
  const value = String(doc.understanding?.objective || doc.title || "").slice(0, 2000);
  if (!value) return;
  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      user: userId,
      key,
      value,
      category: "company",
      source: "architect",
      confidence: 1,
    },
    { upsert: true, new: true }
  ).catch(() => {});

  for (const [i, rule] of (doc.businessRules || []).slice(0, 10).entries()) {
    const rkey = `business.${String(doc._id)}.rule.${i}`;
    await CompanyMemory.findOneAndUpdate(
      { user: userId, key: rkey },
      {
        user: userId,
        key: rkey,
        value: String(rule).slice(0, 1000),
        category: "policy",
        source: "architect",
      },
      { upsert: true }
    ).catch(() => {});
  }
}

/**
 * Derive dataMaps from plan APIs if missing.
 * @param {object} bp
 * @param {object[]} [existing]
 */
export function ensureDataMaps(bp, existing = []) {
  if (Array.isArray(existing) && existing.length) {
    return existing
      .map((m) => ({
        source: String(m.source || "").slice(0, 200),
        target: String(m.target || "").slice(0, 200),
        note: String(m.note || "").slice(0, 400),
      }))
      .filter((m) => m.source || m.target);
  }
  const plan = bp?.plan;
  /** @type {object[]} */
  const maps = [];
  for (const api of plan?.apis || []) {
    if (/GET/i.test(api.method)) {
      maps.push({
        source: `${api.hostHint}${api.pathHint || ""} → customer.email`,
        target: "Email tool → recipient",
        note: api.purpose || "List customers",
      });
      maps.push({
        source: `${api.hostHint} → customer.name`,
        target: "Email template → {{customer_name}}",
        note: "Personalization",
      });
      maps.push({
        source: `${api.hostHint} → customer.id`,
        target: "POST status body",
        note: "Status update key",
      });
    }
  }
  return maps.slice(0, 30);
}
