/**
 * @fileoverview Business Architect chat — staged analyst → understanding → executable blueprint.
 * Purpose: Progressive questions, confirm understanding, then design graph/why/checklist/reuse/plan.
 * Downstream: POST /api/architect/chat, BusinessArchitectPage; apply via applyBusinessPlan.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import { resolveLlmCredentials, resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { normalizeBusinessPlan } from "./businessPlanFromBrief.js";
import { mergeAnswersIntoPlan } from "./businessChat.js";

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
    if (!profile) {
      return {
        error: {
          ok: false,
          title: "LLM profile missing",
          detail: "That planning LLM was not found. Pick another profile or Settings default.",
        },
      };
    }
    const creds = await resolveLlmCredentialsForAgent(user, {
      llm: { profile: profile._id, useCustom: true },
    });
    if (!creds.apiKey) {
      return {
        error: {
          ok: false,
          title: "LLM profile has no key",
          detail: `Profile “${profile.name}” has no API key. Edit it in Settings → LLMs.`,
        },
      };
    }
    return { creds: { ...creds, profileId: String(profile._id), profileName: profile.name } };
  }
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      error: {
        ok: false,
        title: "LLM not configured",
        detail: "Connect an LLM in Settings, or pick an LLM profile on this page.",
        hint: "Open Settings → LLM or Settings → LLMs.",
      },
    };
  }
  return { creds: { ...creds, profileId: "", profileName: "Account settings" } };
}

/**
 * @param {object} answers
 * @returns {string}
 */
function summarizeAnswersForPrompt(answers) {
  if (!answers || typeof answers !== "object") return "(none yet)";
  const lines = [];
  for (const [agentKey, bag] of Object.entries(answers)) {
    if (!bag || typeof bag !== "object") continue;
    const parts = [];
    for (const [k, v] of Object.entries(bag)) {
      const secret = /password|secret|token|apiKey|api_key/i.test(k);
      if (secret) {
        parts.push(`${k}=${String(v || "").trim() ? "(provided)" : "(missing)"}`);
      } else {
        parts.push(`${k}=${String(v || "").trim().slice(0, 120) || "(empty)"}`);
      }
    }
    lines.push(`- ${agentKey}: ${parts.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "(none yet)";
}

/**
 * @param {unknown} raw
 * @returns {{ role: string, content: string }[]}
 */
function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: String(m?.content || "").trim().slice(0, 8000),
    }))
    .filter((m) => m.content)
    .slice(-40);
}

/**
 * @param {object} parsed
 * @returns {object[]}
 */
function normalizePendingRequirements(parsed) {
  const list = Array.isArray(parsed?.pendingRequirements) ? parsed.pendingRequirements : [];
  return list
    .slice(0, 4)
    .map((req, i) => {
      const fields = (Array.isArray(req?.fields) ? req.fields : [])
        .slice(0, 8)
        .map((f) => ({
          key: String(f?.key || "").trim().slice(0, 60),
          label: String(f?.label || f?.key || "Field").trim().slice(0, 120),
          type: String(f?.type || "text") === "password" ? "password" : "text",
          secret: Boolean(f?.secret) || String(f?.type || "") === "password",
          placeholder: String(f?.placeholder || "").trim().slice(0, 200),
          required: f?.required !== false,
        }))
        .filter((f) => f.key);
      return {
        id: String(req?.id || `req_${i + 1}`).trim().slice(0, 80),
        agentKey: String(req?.agentKey || "").trim().slice(0, 40),
        title: String(req?.title || "Information needed").trim().slice(0, 160),
        detail: String(req?.detail || "").trim().slice(0, 800),
        fields,
      };
    })
    .filter((r) => r.fields.length);
}

/**
 * @param {object} u
 * @returns {object}
 */
function normalizeUnderstanding(u) {
  if (!u || typeof u !== "object") {
    return { objective: "", bullets: [], assumptions: [] };
  }
  return {
    objective: String(u.objective || "").trim().slice(0, 1000),
    bullets: (Array.isArray(u.bullets) ? u.bullets : [])
      .map((b) => String(b || "").trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 20),
    assumptions: (Array.isArray(u.assumptions) ? u.assumptions : [])
      .map((b) => String(b || "").trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 15),
  };
}

/**
 * @param {object} bp
 * @param {object} answers
 * @returns {object|null}
 */
export function normalizeArchitectBlueprint(bp, answers = null) {
  if (!bp || typeof bp !== "object") return null;

  const nodes = (Array.isArray(bp.graph?.nodes) ? bp.graph.nodes : [])
    .slice(0, 40)
    .map((n, i) => ({
      id: String(n?.id || `n${i}`).trim().slice(0, 60),
      label: String(n?.label || n?.id || `Node ${i + 1}`).trim().slice(0, 120),
      kind: String(n?.kind || "step").trim().slice(0, 40),
    }))
    .filter((n) => n.id);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(bp.graph?.edges) ? bp.graph.edges : [])
    .slice(0, 60)
    .map((e) => ({
      from: String(e?.from || "").trim().slice(0, 60),
      to: String(e?.to || "").trim().slice(0, 60),
      label: String(e?.label || "").trim().slice(0, 80),
    }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const components = (Array.isArray(bp.components) ? bp.components : [])
    .slice(0, 30)
    .map((c, i) => ({
      id: String(c?.id || `c${i}`).trim().slice(0, 60),
      kind: String(c?.kind || "agent").trim().slice(0, 40),
      title: String(c?.title || "").trim().slice(0, 160),
      purpose: String(c?.purpose || "").trim().slice(0, 800),
      uses: (Array.isArray(c?.uses) ? c.uses : [])
        .map((x) => String(x || "").trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 15),
      starts: String(c?.starts || "").trim().slice(0, 200),
    }))
    .filter((c) => c.title);

  const checklistRaw = bp.checklist && typeof bp.checklist === "object" ? bp.checklist : {};
  const checklist = {
    agents: Math.max(0, Number(checklistRaw.agents) || 0),
    schedules: Math.max(0, Number(checklistRaw.schedules) || 0),
    triggers: Math.max(0, Number(checklistRaw.triggers) || 0),
    apiConnections: Math.max(0, Number(checklistRaw.apiConnections) || 0),
    emailConnections: Math.max(0, Number(checklistRaw.emailConnections) || 0),
    handoffs: Math.max(0, Number(checklistRaw.handoffs) || 0),
    branches: Math.max(0, Number(checklistRaw.branches) || 0),
    humanApprovals: Math.max(0, Number(checklistRaw.humanApprovals) || 0),
  };

  let plan = null;
  if (bp.plan) {
    plan = answers ? mergeAnswersIntoPlan(bp.plan, answers) : normalizeBusinessPlan(bp.plan);
  }

  // Why: derive checklist from executable plan when LLM under-counts.
  if (plan?.agents?.length) {
    checklist.agents = Math.max(checklist.agents, plan.agents.length);
    checklist.schedules = Math.max(
      checklist.schedules,
      plan.agents.filter((a) => a.schedule?.enabled).length
    );
    checklist.emailConnections = Math.max(
      checklist.emailConnections,
      plan.agents.filter((a) => a.needsEmail).length
    );
    checklist.apiConnections = Math.max(checklist.apiConnections, plan.apis?.length || 0);
  }
  if (plan?.triggers?.length) {
    checklist.triggers = Math.max(checklist.triggers, plan.triggers.length);
  }

  const uiMap =
    Array.isArray(bp.uiMap) && bp.uiMap.length
      ? bp.uiMap
      : plan?.uiMap || [];

  return {
    summary: String(bp.summary || plan?.summary || "").trim().slice(0, 2000),
    graph: { nodes, edges },
    components,
    checklist,
    branches: (Array.isArray(bp.branches) ? bp.branches : [])
      .map((b) => String(b || "").trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 20),
    failureHandling: (Array.isArray(bp.failureHandling) ? bp.failureHandling : [])
      .map((b) => String(b || "").trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 20),
    humanApprovals: (Array.isArray(bp.humanApprovals) ? bp.humanApprovals : [])
      .map((b) => String(b || "").trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 15),
    reuse: (Array.isArray(bp.reuse) ? bp.reuse : [])
      .slice(0, 15)
      .map((r) => ({
        agentKey: String(r?.agentKey || "").trim().slice(0, 40),
        existingAgentId: String(r?.existingAgentId || "").trim().slice(0, 40),
        existingAgentName: String(r?.existingAgentName || "").trim().slice(0, 120),
        reason: String(r?.reason || "").trim().slice(0, 500),
        changeRisk: String(r?.changeRisk || "none").trim().slice(0, 200),
        recommend: String(r?.recommend || "create_new").trim().slice(0, 40),
      }))
      .filter((r) => r.agentKey || r.existingAgentId),
    uiMap: (Array.isArray(uiMap) ? uiMap : []).slice(0, 40),
    plan,
  };
}

/**
 * Public blueprint (strip email passwords from embedded plan).
 * @param {object|null} bp
 * @returns {object|null}
 */
export function publicArchitectBlueprint(bp) {
  if (!bp) return null;
  const plan = bp.plan
    ? {
        ...bp.plan,
        agents: (bp.plan.agents || []).map((a) => ({
          ...a,
          email: a.email
            ? { ...a.email, smtpPassword: a.email.smtpPassword ? "(provided)" : "" }
            : null,
        })),
      }
    : null;
  return { ...bp, plan };
}

/**
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function loadExistingAgentsSummary(userId) {
  const agents = await Agent.find({ user: userId })
    .select("name skill description schedule.enabled schedule.interval email.enabled role")
    .sort({ updatedAt: -1 })
    .limit(40)
    .lean();
  return agents.map((a) => ({
    _id: String(a._id),
    name: a.name,
    skill: String(a.skill || "").slice(0, 200),
    description: String(a.description || "").slice(0, 200),
    role: a.role || "worker",
    scheduleEnabled: Boolean(a.schedule?.enabled),
    scheduleInterval: a.schedule?.interval || "",
    emailEnabled: Boolean(a.email?.enabled),
  }));
}

/**
 * Dedicated design pass — used when the user confirmed understanding but the chat
 * turn did not return a usable blueprint (models often stay on "understanding").
 * @param {object} creds
 * @param {{ understanding: object, transcript: string, answers: object, existingAgents: object[] }} ctx
 * @returns {Promise<object|null>}
 */
/**
 * Emit a progress step for streaming clients (no-op if callback missing).
 * @param {((step: { id: string, label: string, pct: number }) => void)|undefined} onProgress
 * @param {string} id
 * @param {string} label
 * @param {number} pct
 */
function emitProgress(onProgress, id, label, pct) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress({ id, label, pct: Math.max(0, Math.min(100, Math.round(pct))) });
  } catch {
    /* ignore client write failures mid-stream */
  }
}

/**
 * Fix common LLM JSON shapes (agents at wrong nesting).
 * @param {object|null} parsed
 * @returns {object|null}
 */
function coerceDesignParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const out = { ...parsed };
  if (!out.blueprint && out.plan) {
    out.blueprint = { plan: out.plan, summary: out.summary || "" };
  }
  if (!out.blueprint) return out;
  const bp = { ...out.blueprint };
  const plan = bp.plan && typeof bp.plan === "object" ? { ...bp.plan } : {};
  if (!Array.isArray(plan.agents) || !plan.agents.length) {
    if (Array.isArray(bp.agents) && bp.agents.length) plan.agents = bp.agents;
    if (Array.isArray(out.agents) && out.agents.length) plan.agents = out.agents;
  }
  if (!Array.isArray(plan.triggers) || !plan.triggers.length) {
    if (Array.isArray(bp.triggers)) plan.triggers = bp.triggers;
    if (Array.isArray(out.triggers)) plan.triggers = out.triggers;
  }
  if (!Array.isArray(plan.apis) || !plan.apis.length) {
    if (Array.isArray(bp.apis)) plan.apis = bp.apis;
    if (Array.isArray(out.apis)) plan.apis = out.apis;
  }
  bp.plan = plan;
  out.blueprint = bp;
  return out;
}

async function generateDesignBlueprint(creds, ctx) {
  const onProgress = ctx.onProgress;
  const system = [
    "You are YamBot's Business Architect designer.",
    "The user already confirmed the business understanding. Output JSON ONLY:",
    '{ "assistantMessage": "...", "blueprint": { summary, graph, components, checklist, branches, failureHandling, humanApprovals, reuse, uiMap, plan: { agents[], triggers[], apis[] } } }',
    "plan.agents is REQUIRED (1–4 items). Each agent: key,name,skill,profile,instructions,successCriteria,schedule,policy.httpAllowHosts,needsEmail;",
    "triggers[] / apis[] as needed. Fill graph nodes/edges and uiMap.",
    "Do not ask questions. Never return an empty agents array.",
  ].join("\n");

  const userBlock = [
    "CONFIRMED_UNDERSTANDING:",
    JSON.stringify(ctx.understanding || {}),
    "",
    "ANSWERS:",
    summarizeAnswersForPrompt(ctx.answers),
    "",
    "EXISTING_AGENTS:",
    JSON.stringify(ctx.existingAgents || []).slice(0, 4000),
    "",
    "CONVERSATION:",
    String(ctx.transcript || "").slice(0, 12_000),
    "",
    "Design the full executable blueprint now.",
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      emitProgress(
        onProgress,
        attempt ? "design_retry_send" : "design_send",
        attempt
          ? "Retrying design — agents were missing…"
          : "Sending design request to LLM…",
        attempt ? 65 : 62
      );
      const raw = await llmChatCompletion({
        apiKey: creds.apiKey,
        baseUrl: creds.llmBaseUrl,
        model: creds.llmModel,
        openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
        temperature: attempt ? 0.15 : 0.2,
        maxTokens: 6000,
        timeoutMs: 100_000,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              attempt === 0
                ? userBlock
                : `${userBlock}\n\nCRITICAL: Your previous reply had no plan.agents. Return at least one complete agent in plan.agents now.`,
          },
        ],
      });
      emitProgress(onProgress, "design_recv", "Received design response from LLM", 78);
      emitProgress(onProgress, "design_parse", "Parsing agents, workflow graph, and checklist…", 85);
      const parsed = coerceDesignParsed(parseJsonObject(raw));
      if (!parsed?.blueprint) continue;
      const bp = normalizeArchitectBlueprint(parsed.blueprint, ctx.answers);
      if (!bp?.plan?.agents?.length) continue;
      return {
        blueprint: bp,
        assistantMessage:
          String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
          "Here is the full architecture. Review it, then Approve & Build.",
      };
    } catch {
      /* try again or fail */
    }
  }
  return null;
}

/**
 * Re-run design for a saved draft that has understanding but no executable plan.agents.
 * @param {string} userId
 * @param {string} blueprintId
 * @param {object} [body]
 * @param {{ onProgress?: Function }} [opts]
 */
export async function designSavedBlueprint(userId, blueprintId, body = {}, opts = {}) {
  const onProgress = opts.onProgress;
  const doc = await BusinessBlueprint.findOne({ _id: blueprintId, user: userId });
  if (!doc) {
    return { ok: false, title: "Not found", detail: "Blueprint missing" };
  }

  emitProgress(onProgress, "prepare", "Preparing architecture design…", 8);

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  const resolved = await resolvePlannerCreds(user, body.profileId || doc.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const understanding = normalizeUnderstanding(doc.understanding);
  const transcript = (doc.messages || [])
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  if (!understanding.objective && !transcript.trim()) {
    return {
      ok: false,
      title: "Nothing to design yet",
      detail: "Describe your business in the Architect chat first, then confirm understanding.",
    };
  }

  emitProgress(onProgress, "agents", "Loading existing agents…", 18);
  const existingAgents = await loadExistingAgentsSummary(userId);
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};

  const designed = await generateDesignBlueprint(creds, {
    understanding,
    transcript,
    answers,
    existingAgents,
    onProgress,
  });

  if (!designed?.blueprint?.plan?.agents?.length) {
    return {
      ok: false,
      title: "Design failed",
      detail:
        "The planning LLM did not return agents for this business. Check your LLM profile, then try Generate architecture again.",
      hint: "Settings → LLM profiles, or pick a different Planning LLM on /architect.",
    };
  }

  emitProgress(onProgress, "save", "Saving blueprint draft…", 92);
  doc.stage = "ready";
  doc.blueprint = publicArchitectBlueprint(designed.blueprint);
  doc.understanding = { ...understanding, confirmed: true };
  doc.profileId = creds.profileId || doc.profileId;
  if (Object.keys(answers).length) doc.answersMeta = redactAnswersMeta(answers);
  doc.messages = [
    ...(doc.messages || []),
    {
      role: "assistant",
      content: designed.assistantMessage,
      at: new Date(),
    },
  ].slice(-50);
  await doc.save();

  emitProgress(onProgress, "done", "Blueprint ready", 100);

  return {
    ok: true,
    stage: "ready",
    assistantMessage: designed.assistantMessage,
    blueprint: doc.blueprint,
    blueprintId: String(doc._id),
    profileId: creds.profileId || "",
    profileName: creds.profileName || "",
  };
}

/**
 * One Architect turn.
 * @param {string} userId
 * @param {object} body
 * @param {{ onProgress?: (step: { id: string, label: string, pct: number }) => void }} [opts]
 */
export async function chatArchitect(userId, body = {}, opts = {}) {
  const onProgress = opts.onProgress;
  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return {
      ok: false,
      title: "Message required",
      detail: "Describe the business outcome you want in plain English.",
    };
  }

  emitProgress(
    onProgress,
    "prepare",
    body.understandingConfirmed
      ? "Preparing full blueprint…"
      : "Preparing Architect reply…",
    5
  );

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  emitProgress(onProgress, "creds", "Loading LLM profile and credentials…", 12);
  const resolved = await resolvePlannerCreds(user, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  emitProgress(onProgress, "agents", "Loading your existing agents for reuse checks…", 18);
  const existingAgents = await loadExistingAgentsSummary(userId);
  const understandingConfirmed = body.understandingConfirmed === true;
  const understandingRejected = body.understandingRejected === true;

  /** @type {import('mongoose').Document|null} */
  let doc = null;
  if (body.blueprintId) {
    emitProgress(onProgress, "draft", "Loading saved blueprint draft…", 22);
    doc = await BusinessBlueprint.findOne({ _id: body.blueprintId, user: userId });
  }

  const system = [
    "You are YamBot's Business Architect — a senior business analyst, NOT an agent form-filler.",
    "The user must NEVER need to understand agents, triggers, schedules, APIs, or tools.",
    "They describe a business outcome; you translate it into an executable workflow.",
    "",
    "ALWAYS reply with JSON only (no markdown fences):",
    "{",
    '  "stage": "gathering" | "understanding" | "ready",',
    '  "assistantMessage": "conversational reply to the user",',
    '  "pendingRequirements": [ { "id", "agentKey", "title", "detail", "fields": [{ "key", "label", "type", "secret", "placeholder", "required" }] } ],',
    '  "understanding": { "objective": "", "bullets": ["..."], "assumptions": ["..."] },',
    '  "blueprint": null | {',
    '    "summary": "",',
    '    "graph": { "nodes": [{ "id", "label", "kind": "api|agent|email|wait|branch|schedule|human|step" }], "edges": [{ "from", "to", "label" }] },',
    '    "components": [{ "id", "kind", "title", "purpose", "uses": [], "starts": "" }],',
    '    "checklist": { "agents", "schedules", "triggers", "apiConnections", "emailConnections", "handoffs", "branches", "humanApprovals" },',
    '    "branches": ["..."],',
    '    "failureHandling": ["API fail → retry 3x → notify"],',
    '    "humanApprovals": ["..."],',
    '    "reuse": [{ "agentKey", "existingAgentId", "existingAgentName", "reason", "changeRisk", "recommend": "reuse|create_new" }],',
    '    "uiMap": [{ "page", "routeHint", "purpose", "relatedAgentKey", "fields": [{ "label", "value" }] }],',
    '    "plan": { /* same shape as business plan: agents, triggers, apis, explanation, setupRequired */ }',
    "  }",
    "}",
    "",
    "STAGE RULES:",
    "- gathering: Ask ONLY the next necessary question (prefer 1). Use pendingRequirements for secrets (email password, API key). Infer smtp/imap hosts when safe (e.g. Gmail → smtp.gmail.com / imap.gmail.com). Never dump 20 questions.",
    "- understanding: When you know the business well enough, set stage=understanding with objective, bullets (My understanding), assumptions. Do NOT include blueprint yet. Ask them to confirm.",
    "- ready: ONLY after the user confirmed understanding (see flags below). Then emit full blueprint + executable plan.agents/triggers/apis with concrete instructions, schedules, email.replied triggers, httpAllowHosts, uiMap teaching pages/fields.",
    "",
    "If UNDERSTANDING_CONFIRMED=true → produce stage=ready with complete blueprint (unless critical secrets still missing → gathering with pendingRequirements).",
    "If UNDERSTANDING_REJECTED=true → stage=gathering or understanding; revise based on their correction.",
    "",
    "Reuse: Inspect EXISTING_AGENTS. Prefer recommend=create_new unless an existing agent clearly matches; never imply silent modification of production agents. If reuse, set recommend=reuse and explain changeRisk.",
    "Branches: model decision trees in graph (kind=branch) and branches[].",
    "plan.agents keys must be stable slugs; triggers.agentKey must match; include schedule for daily 9am style requests.",
  ].join("\n");

  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  let raw;
  try {
    emitProgress(
      onProgress,
      "llm_send",
      understandingConfirmed
        ? "Sent blueprint request to LLM — waiting for response…"
        : "Sent request to LLM — waiting for response…",
      30
    );
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.25,
      maxTokens: 6000,
      timeoutMs: 100_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `UNDERSTANDING_CONFIRMED=${understandingConfirmed}`,
            `UNDERSTANDING_REJECTED=${understandingRejected}`,
            "",
            "ALREADY COLLECTED ANSWERS:",
            summarizeAnswersForPrompt(body.answers),
            "",
            "EXISTING_AGENTS:",
            existingAgents.length
              ? JSON.stringify(existingAgents, null, 0).slice(0, 6000)
              : "(none)",
            "",
            "CONVERSATION:",
            transcript,
            "",
            "Respond with the JSON object now.",
          ].join("\n"),
        },
      ],
    });
    emitProgress(onProgress, "llm_recv", "Received response from LLM", 55);
  } catch (err) {
    return {
      ok: false,
      title: "Architect LLM failed",
      detail: err?.message || "Could not reach the planning LLM.",
      hint: "Check the selected LLM profile or Settings → LLM.",
    };
  }

  emitProgress(onProgress, "parse", "Parsing Architect reply…", 58);
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      ok: false,
      title: "Could not parse reply",
      detail: "The architect did not return valid JSON. Send another message to retry.",
    };
  }

  let stage = String(parsed.stage || "gathering").toLowerCase();
  if (!["gathering", "understanding", "ready"].includes(stage)) stage = "gathering";

  // Why: never skip confirmation — force understanding before ready unless user just confirmed.
  if (stage === "ready" && !understandingConfirmed) {
    if (normalizeUnderstanding(parsed.understanding).objective) {
      stage = "understanding";
    } else {
      stage = "gathering";
    }
  }

  let understanding = normalizeUnderstanding(parsed.understanding);
  // Why: after confirm, keep prior understanding if the model returns an empty one.
  if (
    understandingConfirmed &&
    !understanding.objective &&
    doc?.understanding?.objective
  ) {
    understanding = normalizeUnderstanding(doc.understanding);
  }

  let pendingRequirements =
    stage === "ready" ? [] : normalizePendingRequirements(parsed);

  let blueprint = null;
  if ((stage === "ready" || understandingConfirmed) && parsed.blueprint) {
    blueprint = normalizeArchitectBlueprint(parsed.blueprint, body.answers);
    if (blueprint?.plan?.agents?.length) {
      stage = "ready";
      pendingRequirements = [];
    } else {
      blueprint = null;
    }
  }

  let assistantMessage =
    String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
    (stage === "understanding"
      ? "Here’s what I understand — please confirm or correct me."
      : stage === "ready"
        ? "Here is the full architecture. Review it, then Approve & Build."
        : "Tell me a bit more so I can design this correctly.");

  // Why: user clicked "Yes, correct — design it" but many models stay on understanding.
  // Run a dedicated design pass so the UI always advances to the blueprint panel.
  if (understandingConfirmed && stage !== "ready") {
    emitProgress(
      onProgress,
      "design_retry",
      "First reply incomplete — running dedicated design pass…",
      60
    );
    const designed = await generateDesignBlueprint(creds, {
      understanding:
        understanding.objective
          ? understanding
          : normalizeUnderstanding(doc?.understanding) || understanding,
      transcript,
      answers: body.answers,
      existingAgents,
      onProgress,
    });
    if (designed?.blueprint) {
      stage = "ready";
      blueprint = designed.blueprint;
      pendingRequirements = [];
      assistantMessage = designed.assistantMessage;
      if (!understanding.objective && doc?.understanding) {
        understanding = normalizeUnderstanding(doc.understanding);
      }
    } else if (!pendingRequirements.length) {
      assistantMessage =
        "I confirmed your understanding but could not finish the architecture design. Click “Yes, correct — design it” again, or add one more detail in chat.";
      stage = "understanding";
    }
  }

  emitProgress(onProgress, "save", "Saving blueprint draft…", 92);
  // Persist draft blueprint document
  const title =
    understanding.objective.slice(0, 120) ||
    blueprint?.summary?.slice(0, 120) ||
    "Business architecture";

  if (!doc) {
    doc = new BusinessBlueprint({
      user: userId,
      title,
      status: "draft",
      stage,
      profileId: creds.profileId || "",
      messages: [
        ...messages.map((m) => ({ ...m, at: new Date() })),
        { role: "assistant", content: assistantMessage, at: new Date() },
      ].slice(-50),
      understanding: {
        ...understanding,
        confirmed: understandingConfirmed && stage === "ready",
      },
      blueprint: blueprint ? publicArchitectBlueprint(blueprint) : null,
      answersMeta: redactAnswersMeta(body.answers),
    });
  } else {
    doc.title = title;
    doc.stage = stage;
    doc.profileId = creds.profileId || doc.profileId;
    doc.messages = [
      ...messages.map((m) => ({ ...m, at: new Date() })),
      { role: "assistant", content: assistantMessage, at: new Date() },
    ].slice(-50);
    doc.understanding = {
      ...understanding,
      confirmed: Boolean(understandingConfirmed && stage === "ready"),
    };
    if (blueprint) doc.blueprint = publicArchitectBlueprint(blueprint);
    doc.answersMeta = redactAnswersMeta(body.answers);
    if (stage !== "ready") doc.status = "draft";
  }
  await doc.save();

  emitProgress(
    onProgress,
    "done",
    stage === "ready" ? "Blueprint ready" : "Reply ready",
    100
  );

  return {
    ok: true,
    stage,
    assistantMessage,
    pendingRequirements,
    // Why: hide understanding card once we have a ready blueprint.
    understanding: stage === "understanding" ? understanding : null,
    blueprint: publicArchitectBlueprint(blueprint),
    blueprintId: String(doc._id),
    profileId: creds.profileId || "",
    profileName: creds.profileName || "",
  };
}

/**
 * @param {object} answers
 * @returns {object}
 */
function redactAnswersMeta(answers) {
  if (!answers || typeof answers !== "object") return {};
  /** @type {object} */
  const out = {};
  for (const [k, bag] of Object.entries(answers)) {
    if (!bag || typeof bag !== "object") continue;
    out[k] = {};
    for (const [fk, v] of Object.entries(bag)) {
      if (/password|secret|token|apiKey|api_key/i.test(fk)) {
        out[k][fk] = String(v || "").trim() ? "(set)" : "";
      } else {
        out[k][fk] = String(v || "").trim().slice(0, 200);
      }
    }
  }
  return out;
}
