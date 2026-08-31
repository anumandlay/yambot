/**
 * @fileoverview CEO / Command Center AI — natural-language business control plane.
 * Purpose: Chat that reasons over capabilities, readiness, runs; emits safe UI actions only.
 * Downstream: POST /api/ceo/chat, /diagnose, /discover.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import {
  buildCapabilitiesCatalog,
  formatCapabilitiesForPrompt,
} from "./capabilitiesCatalog.js";
import { computeAgentReadiness } from "./agentReadiness.js";
import { formatCompanyMemoryBlock } from "../models/CompanyMemory.js";
import { publicEmailSummary } from "./agentEmail.js";

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
 * @param {string} userId
 * @param {string} [profileId]
 */
async function resolveCeoCreds(userId, profileId) {
  const user = await User.findById(userId);
  if (!user) {
    return { error: { ok: false, title: "User missing", detail: "Could not load account." } };
  }
  if (profileId) {
    const { resolveLlmCredentialsForAgent } = await import("./llmCredentials.js");
    const fakeAgent = { llm: { profile: profileId, useCustom: true } };
    const creds = await resolveLlmCredentialsForAgent(user, fakeAgent);
    if (!creds.apiKey) {
      return {
        error: {
          ok: false,
          title: "LLM not configured",
          detail: "Pick a working LLM profile in Settings.",
        },
      };
    }
    return { creds, user };
  }
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      error: {
        ok: false,
        title: "LLM not configured",
        detail: "Connect your LLM in Settings before using Command Center.",
      },
    };
  }
  return { creds, user };
}

/**
 * @param {string} userId
 */
async function loadCeoContext(userId) {
  const catalog = await buildCapabilitiesCatalog(userId);
  const [recentFails, memoryBlock, blueprints] = await Promise.all([
    Task.find({ user: userId, status: "error" })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select("agent goal resultSummary lastError status updatedAt")
      .populate("agent", "name")
      .lean(),
    formatCompanyMemoryBlock(userId, 25),
    BusinessBlueprint.find({ user: userId })
      .select("title status stage builtAt createdAgentIds")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const weakAgents = (catalog.agents || [])
    .filter((a) => a.readinessScore < 80)
    .slice(0, 10);

  return {
    catalog,
    capabilitiesText: formatCapabilitiesForPrompt(catalog),
    recentFails: recentFails.map((t) => ({
      taskId: String(t._id),
      agentId: t.agent?._id ? String(t.agent._id) : "",
      agentName: t.agent?.name || "?",
      goal: String(t.goal || "").slice(0, 200),
      error: String(t.lastError || t.resultSummary || "").slice(0, 300),
      at: t.updatedAt,
    })),
    memoryBlock: String(memoryBlock || "").slice(0, 3000),
    blueprints: blueprints.map((b) => ({
      _id: String(b._id),
      title: b.title,
      status: b.status,
      stage: b.stage,
    })),
    weakAgents,
  };
}

/**
 * Normalize CEO actions to safe verbs the UI understands.
 * @param {unknown[]} raw
 * @returns {object[]}
 */
function normalizeActions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const allowed = new Set([
    "open_architect",
    "propose_hire",
    "propose_change",
    "diagnose_run",
    "emergency_stop",
    "emergency_resume",
    "show_readiness",
    "discover",
    "link",
  ]);
  return list
    .slice(0, 8)
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const type = String(a.type || a.action || "").trim();
      if (!allowed.has(type)) return null;
      return {
        type,
        label: String(a.label || type).trim().slice(0, 80),
        href: String(a.href || a.path || "").trim().slice(0, 300),
        agentId: String(a.agentId || "").trim().slice(0, 40),
        blueprintId: String(a.blueprintId || "").trim().slice(0, 40),
        prompt: String(a.prompt || a.request || a.text || "").trim().slice(0, 2000),
        question: String(a.question || "").trim().slice(0, 1000),
      };
    })
    .filter(Boolean);
}

/**
 * @param {string} userId
 * @param {{ messages?: object[], profileId?: string }} body
 */
export async function chatCeo(userId, body = {}) {
  const resolved = await resolveCeoCreds(userId, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").trim().slice(0, 4000),
    }))
    .filter((m) => m.content)
    .slice(-20);
  if (!messages.length) {
    return {
      ok: false,
      title: "Message required",
      detail: "Tell the Command Center what you want the business to do.",
    };
  }

  const ctx = await loadCeoContext(userId);
  const system = [
    "You are YamBot's CEO AI — the business owner talks to YOU, not to fifty agents.",
    "Reply with JSON ONLY:",
    '{ "assistantMessage": "...", "actions": [ { "type", "label", "href?", "agentId?", "blueprintId?", "prompt?", "question?" } ] }',
    "Allowed action types: open_architect, propose_hire, propose_change, diagnose_run, emergency_stop, emergency_resume, show_readiness, discover, link.",
    "For propose_hire / open_architect set prompt to the hire brief. For propose_change set blueprintId if known and prompt=English change.",
    "For diagnose_run set agentId and/or question. For link set href like /agents/ID or /architect?id=...",
    "Never invent secrets. Prefer reusing existing capabilities. Be concise and executive.",
  ].join("\n");

  const userBlock = [
    "CAPABILITIES:",
    ctx.capabilitiesText,
    "",
    "WEAK_AGENTS:",
    JSON.stringify(ctx.weakAgents).slice(0, 2000),
    "",
    "RECENT_FAILURES:",
    JSON.stringify(ctx.recentFails).slice(0, 2500),
    "",
    "BLUEPRINTS:",
    JSON.stringify(ctx.blueprints).slice(0, 1500),
    "",
    "COMPANY_MEMORY:",
    ctx.memoryBlock || "(none)",
    "",
    "CONVERSATION:",
    messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.3,
      maxTokens: 2500,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userBlock.slice(0, 14_000) },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "CEO chat failed",
      detail: err?.message || "LLM request failed",
    };
  }

  const parsed = parseJsonObject(raw) || {};
  const assistantMessage =
    String(parsed.assistantMessage || parsed.message || "").trim().slice(0, 6000) ||
    String(raw || "").trim().slice(0, 2000) ||
    "I need a bit more detail.";

  return {
    ok: true,
    assistantMessage,
    actions: normalizeActions(parsed.actions),
    contextSummary: {
      agentCount: ctx.catalog.summary?.agentCount || 0,
      avgReadiness: ctx.catalog.summary?.avgReadiness || 0,
      weakCount: ctx.weakAgents.length,
      recentFailCount: ctx.recentFails.length,
    },
  };
}

/**
 * @param {string} userId
 * @param {{ agentId?: string, question?: string, taskId?: string, profileId?: string }} body
 */
export async function diagnoseCeo(userId, body = {}) {
  const resolved = await resolveCeoCreds(userId, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const agentId = String(body.agentId || "").trim();
  const question = String(body.question || "").trim().slice(0, 1000);
  const taskId = String(body.taskId || "").trim();

  /** @type {object|null} */
  let agent = null;
  if (agentId) {
    agent = await Agent.findOne({ _id: agentId, user: userId }).lean();
  }

  const taskFilter = { user: userId };
  if (taskId) taskFilter._id = taskId;
  else if (agentId) taskFilter.agent = agentId;

  const runs = await Task.find(taskFilter)
    .sort({ createdAt: -1 })
    .limit(12)
    .select(
      "status goal resultSummary lastError startedAt completedAt createdAt events agent"
    )
    .lean();

  if (!agent && runs[0]?.agent) {
    agent = await Agent.findOne({ _id: runs[0].agent, user: userId }).lean();
  }

  const triggers = agent
    ? await Trigger.find({ user: userId, agent: agent._id }).lean()
    : [];

  const readiness = agent
    ? computeAgentReadiness(agent, { hasTrigger: triggers.some((t) => t.enabled !== false) })
    : null;

  const email = agent ? publicEmailSummary(agent) : null;

  const system = [
    "You diagnose YamBot agent failures for a business owner in plain English.",
    "Reply JSON ONLY: { \"assistantMessage\": \"...\", \"causes\": [\"...\"], \"fixes\": [{ \"label\", \"href\" }], \"actions\": [...] }",
    "actions use same safe types as CEO chat (link, open_architect, diagnose_run, show_readiness).",
    "Be specific: cite missing mailbox, schedule off, last error text, skipped steps.",
  ].join("\n");

  const userBlock = [
    `QUESTION: ${question || "Why did recent runs fail?"}`,
    "",
    "AGENT:",
    agent
      ? JSON.stringify({
          id: String(agent._id),
          name: agent.name,
          instructions: String(agent.instructions || "").slice(0, 800),
          schedule: agent.schedule,
          emailConfigured: email?.configured,
          emailAddress: email?.fromAddress,
          readiness,
        })
      : "(unknown)",
    "",
    "TRIGGERS:",
    JSON.stringify(
      triggers.map((t) => ({
        name: t.name,
        type: t.type,
        enabled: t.enabled,
        eventType: t.config?.eventType,
      }))
    ).slice(0, 1500),
    "",
    "RECENT_RUNS:",
    JSON.stringify(
      runs.map((t) => ({
        id: String(t._id),
        status: t.status,
        goal: String(t.goal || "").slice(0, 160),
        result: String(t.resultSummary || "").slice(0, 400),
        error: String(t.lastError || "").slice(0, 400),
        at: t.completedAt || t.createdAt,
      }))
    ).slice(0, 6000),
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.2,
      maxTokens: 2200,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userBlock },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "Diagnose failed",
      detail: err?.message || "LLM request failed",
    };
  }

  const parsed = parseJsonObject(raw) || {};
  const fixes = Array.isArray(parsed.fixes)
    ? parsed.fixes.slice(0, 8).map((f) => ({
        label: String(f?.label || "Fix").slice(0, 120),
        href: String(f?.href || (agent ? `/agents/${agent._id}` : "/agents")).slice(0, 300),
      }))
    : agent
      ? [{ label: `Edit ${agent.name}`, href: `/agents/${agent._id}` }]
      : [];

  return {
    ok: true,
    assistantMessage:
      String(parsed.assistantMessage || "").trim().slice(0, 6000) ||
      String(raw || "").trim().slice(0, 2000),
    causes: (Array.isArray(parsed.causes) ? parsed.causes : [])
      .map((c) => String(c || "").trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 10),
    fixes,
    actions: normalizeActions(parsed.actions),
    agentId: agent ? String(agent._id) : "",
    readiness,
  };
}

/**
 * @param {string} userId
 * @param {{ brief?: string, profileId?: string }} body
 */
export async function discoverAutomations(userId, body = {}) {
  const resolved = await resolveCeoCreds(userId, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const ctx = await loadCeoContext(userId);
  const brief = String(body.brief || "").trim().slice(0, 4000);

  const system = [
    "You find automation opportunities for a YamBot business.",
    "Reply JSON ONLY:",
    '{ "assistantMessage": "...", "opportunities": [ { "title", "effort": "low|medium|high", "automationPct": 0-100, "architectPrompt", "reason" } ] }',
    "Prefer opportunities that reuse existing agents/skills. Do not invent OAuth integrations.",
    "architectPrompt must be a ready-to-paste Business Architect hire brief.",
    "Return 3–8 opportunities.",
  ].join("\n");

  const userBlock = [
    "BUSINESS_BRIEF:",
    brief || "(use company memory + existing agents)",
    "",
    "CAPABILITIES:",
    ctx.capabilitiesText,
    "",
    "COMPANY_MEMORY:",
    ctx.memoryBlock || "(none)",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.35,
      maxTokens: 3000,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userBlock.slice(0, 12_000) },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "Discovery failed",
      detail: err?.message || "LLM request failed",
    };
  }

  const parsed = parseJsonObject(raw) || {};
  const opportunities = (Array.isArray(parsed.opportunities) ? parsed.opportunities : [])
    .slice(0, 10)
    .map((o, i) => ({
      id: `opp_${i}`,
      title: String(o?.title || `Opportunity ${i + 1}`).trim().slice(0, 160),
      effort: ["low", "medium", "high"].includes(String(o?.effort || "").toLowerCase())
        ? String(o.effort).toLowerCase()
        : "medium",
      automationPct: Math.max(0, Math.min(100, Number(o?.automationPct) || 70)),
      architectPrompt: String(o?.architectPrompt || o?.title || "").trim().slice(0, 2000),
      reason: String(o?.reason || "").trim().slice(0, 500),
    }))
    .filter((o) => o.title && o.architectPrompt);

  return {
    ok: true,
    assistantMessage:
      String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
      `Found ${opportunities.length} automation opportunities.`,
    opportunities,
  };
}

/**
 * Turn SOP / document text into an Architect hire brief (+ optional department plan).
 * @param {string} userId
 * @param {{ text?: string, documentId?: string, profileId?: string }} body
 */
export async function sopToHireBrief(userId, body = {}) {
  const resolved = await resolveCeoCreds(userId, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  let text = String(body.text || "").trim();
  if (body.documentId) {
    const { DocumentFile } = await import("../models/DocumentFile.js");
    const { readDocumentBytes, extractDocumentText } = await import("./documentStorage.js");
    const doc = await DocumentFile.findOne({ _id: body.documentId, user: userId });
    if (!doc) {
      return { ok: false, title: "Document missing", detail: "Upload the SOP first." };
    }
    if (doc.extractedText) text = String(doc.extractedText);
    else {
      const buf = await readDocumentBytes(doc);
      text = extractDocumentText(buf, doc.mimeType, doc.filename);
      if (text) {
        doc.extractedText = text;
        await doc.save();
      }
    }
  }
  if (text.length < 40) {
    return {
      ok: false,
      title: "SOP too short",
      detail: "Paste at least a short process description, or upload a text/PDF SOP.",
    };
  }

  const ctx = await loadCeoContext(userId);
  const system = [
    "Convert an SOP into a YamBot hire brief. JSON ONLY:",
    '{ "assistantMessage": "...", "architectPrompt": "...", "departmentName": "", "roles": [{ "title", "responsibilities", "architectPrompt" }], "requiredConnections": ["gmail","slack",...], "minimizeAgents": true }',
    "Prefer the fewest agents that can safely run the SOP. requiredConnections use connection ids: gmail,slack,hubspot,salesforce,twilio,webhook,calendar,sheets.",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.25,
      maxTokens: 3500,
      timeoutMs: 100_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "CAPABILITIES:",
            ctx.capabilitiesText,
            "",
            "SOP:",
            text.slice(0, 20_000),
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    return { ok: false, title: "SOP parse failed", detail: err?.message || "LLM failed" };
  }

  const parsed = parseJsonObject(raw) || {};
  const architectPrompt =
    String(parsed.architectPrompt || "").trim().slice(0, 4000) ||
    `Turn this SOP into agents:\n${text.slice(0, 1500)}`;
  const roles = (Array.isArray(parsed.roles) ? parsed.roles : [])
    .slice(0, 8)
    .map((r) => ({
      title: String(r?.title || "Role").slice(0, 120),
      responsibilities: String(r?.responsibilities || "").slice(0, 800),
      architectPrompt: String(r?.architectPrompt || "").slice(0, 2000),
    }));

  return {
    ok: true,
    assistantMessage:
      String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
      "SOP converted into a hire brief.",
    architectPrompt,
    departmentName: String(parsed.departmentName || "").slice(0, 120),
    roles,
    requiredConnections: (Array.isArray(parsed.requiredConnections)
      ? parsed.requiredConnections
      : []
    )
      .map((c) => String(c).toLowerCase())
      .slice(0, 12),
    minimizeAgents: parsed.minimizeAgents !== false,
  };
}

/**
 * Propose a full department (multi-role) hire plan.
 * @param {string} userId
 * @param {{ request?: string, profileId?: string }} body
 */
export async function hireDepartment(userId, body = {}) {
  const resolved = await resolveCeoCreds(userId, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;
  const request = String(body.request || "").trim();
  if (request.length < 12) {
    return {
      ok: false,
      title: "Describe the department",
      detail: 'e.g. "Build an AI sales department for outbound leads."',
    };
  }
  const ctx = await loadCeoContext(userId);
  const system = [
    "Design a minimal AI department for YamBot. JSON ONLY:",
    '{ "assistantMessage": "...", "departmentName": "...", "roles": [{ "title", "reportsTo", "responsibilities", "architectPrompt" }], "sharedRules": ["..."], "requiredConnections": [] }',
    "Minimize headcount. Prefer 2–5 roles. One manager optional. Each architectPrompt is a complete hire brief for Business Architect.",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.3,
      maxTokens: 4000,
      timeoutMs: 100_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `REQUEST:\n${request}\n\nCAPABILITIES:\n${ctx.capabilitiesText}`,
        },
      ],
    });
  } catch (err) {
    return { ok: false, title: "Department design failed", detail: err?.message || "LLM failed" };
  }

  const parsed = parseJsonObject(raw) || {};
  const roles = (Array.isArray(parsed.roles) ? parsed.roles : [])
    .slice(0, 8)
    .map((r, i) => ({
      id: `role_${i}`,
      title: String(r?.title || `Role ${i + 1}`).slice(0, 120),
      reportsTo: String(r?.reportsTo || "").slice(0, 120),
      responsibilities: String(r?.responsibilities || "").slice(0, 1000),
      architectPrompt: String(
        r?.architectPrompt || `Hire a ${r?.title || "worker"} for: ${request}`
      ).slice(0, 2000),
    }));

  const { recordDecision } = await import("../models/DecisionJournal.js");
  await recordDecision(userId, {
    actorType: "ceo",
    authorityLevel: "internal",
    decision: `Proposed department: ${parsed.departmentName || request.slice(0, 80)}`,
    rationale: String(parsed.assistantMessage || "").slice(0, 2000),
    context: { roleCount: roles.length },
    outcome: "proposed",
  }).catch(() => {});

  return {
    ok: true,
    assistantMessage:
      String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
      `Proposed ${roles.length} roles.`,
    departmentName: String(parsed.departmentName || "Department").slice(0, 120),
    roles,
    sharedRules: (Array.isArray(parsed.sharedRules) ? parsed.sharedRules : [])
      .map((r) => String(r).slice(0, 400))
      .slice(0, 20),
    requiredConnections: (Array.isArray(parsed.requiredConnections)
      ? parsed.requiredConnections
      : []
    )
      .map((c) => String(c).toLowerCase())
      .slice(0, 12),
  };
}

/**
 * Suggest cheaper/stronger model routing for agents.
 * @param {string} userId
 */
export async function optimizeModelCosts(userId) {
  const { LlmProfile } = await import("../models/LlmProfile.js");
  const { Agent } = await import("../models/Agent.js");
  const { Task } = await import("../models/Task.js");

  const [profiles, agents, usage] = await Promise.all([
    LlmProfile.find({ user: userId }).lean(),
    Agent.find({ user: userId }).select("name skill instructions llm").limit(80).lean(),
    Task.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: "$agent",
          runs: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const usageByAgent = Object.fromEntries(
    usage.map((u) => [String(u._id), { runs: u.runs, errors: u.errors }])
  );
  const cheap = profiles.filter((p) => (p.tier || "standard") === "cheap");
  const premium = profiles.filter((p) => p.tier === "premium");
  const standard = profiles.filter((p) => (p.tier || "standard") === "standard");

  /** @type {object[]} */
  const suggestions = [];
  for (const a of agents) {
    const u = usageByAgent[String(a._id)] || { runs: 0, errors: 0 };
    const complex = /research|strateg|negotiat|plan|browser|captcha/i.test(
      `${a.skill || ""} ${a.instructions || ""}`
    );
    const simple = /classif|extract|summar|label|tag|status/i.test(
      `${a.skill || ""} ${a.instructions || ""}`
    );
    const currentProfileId = a.llm?.profile ? String(a.llm.profile) : "";
    if (simple && cheap.length && (!currentProfileId || u.errors === 0)) {
      const target = cheap[0];
      if (String(target._id) !== currentProfileId) {
        suggestions.push({
          agentId: String(a._id),
          agentName: a.name,
          action: "use_cheap",
          profileId: String(target._id),
          profileName: target.name,
          reason: "Classification/extraction-style work can use a cheaper model.",
          estimatedSavingsPct: 30,
        });
      }
    } else if (complex && premium.length && u.errors > Math.max(1, u.runs * 0.25)) {
      const target = premium[0];
      if (String(target._id) !== currentProfileId) {
        suggestions.push({
          agentId: String(a._id),
          agentName: a.name,
          action: "use_premium",
          profileId: String(target._id),
          profileName: target.name,
          reason: "High error rate on complex work — try a stronger model.",
          estimatedSavingsPct: 0,
        });
      }
    } else if (!currentProfileId && standard.length) {
      suggestions.push({
        agentId: String(a._id),
        agentName: a.name,
        action: "assign_profile",
        profileId: String(standard[0]._id),
        profileName: standard[0].name,
        reason: "No LLM profile assigned — using account default.",
        estimatedSavingsPct: 0,
      });
    }
  }

  return {
    ok: true,
    profiles: profiles.map((p) => ({
      _id: String(p._id),
      name: p.name,
      model: p.model,
      tier: p.tier || "standard",
      costPer1kUsd: Number(p.costPer1kUsd) || 0,
    })),
    suggestions: suggestions.slice(0, 40),
    summary: {
      profileCount: profiles.length,
      suggestionCount: suggestions.length,
      potentialSavingsAgents: suggestions.filter((s) => s.estimatedSavingsPct > 0).length,
    },
  };
}
