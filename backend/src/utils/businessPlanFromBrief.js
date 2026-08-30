/**
 * @fileoverview LLM planner: plain-English business brief → structured multi-agent plan.
 * Purpose: Explain agents, schedules, triggers, and API steps before any create.
 * Downstream: POST /api/business/plan → BusinessSetupPage preview → applyBusinessPlan.
 */

import { User } from "../models/User.js";
import { SCHEDULE_INTERVALS } from "../models/Agent.js";
import { TRIGGER_TYPES, TRIGGER_ACTIONS } from "../models/Trigger.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";

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
 * @param {unknown} value
 * @returns {string}
 */
function slugKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * @param {object} parsed
 * @returns {object}
 */
export function normalizeBusinessPlan(parsed) {
  const agentsIn = Array.isArray(parsed?.agents) ? parsed.agents : [];
  const usedKeys = new Set();
  const agents = agentsIn.slice(0, 8).map((a, i) => {
    let key = slugKey(a?.key) || `agent_${i + 1}`;
    if (usedKeys.has(key)) key = `${key}_${i + 1}`;
    usedKeys.add(key);
    const intervalRaw = String(a?.schedule?.interval || "").trim();
    const interval = SCHEDULE_INTERVALS.includes(intervalRaw) ? intervalRaw : "daily";
    const scheduleEnabled = Boolean(a?.schedule?.enabled);
    const hosts = Array.isArray(a?.policy?.httpAllowHosts)
      ? a.policy.httpAllowHosts.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];
    return {
      key,
      name: String(a?.name || `Agent ${i + 1}`).trim().slice(0, 80) || `Agent ${i + 1}`,
      description: String(a?.description || "").trim().slice(0, 300),
      skill: String(a?.skill || "").trim().slice(0, 2000),
      profile: String(a?.profile || "").trim().slice(0, 4000),
      instructions: String(a?.instructions || "").trim().slice(0, 8000),
      successCriteria: String(a?.successCriteria || "").trim().slice(0, 2000),
      role: String(a?.role || "worker") === "manager" ? "manager" : "worker",
      managedAgentKeys: Array.isArray(a?.managedAgentKeys)
        ? a.managedAgentKeys.map(slugKey).filter(Boolean).slice(0, 20)
        : [],
      schedule: {
        enabled: scheduleEnabled,
        interval,
        dailyAt: String(a?.schedule?.dailyAt || "09:00").trim().slice(0, 5) || "09:00",
        goal: String(a?.schedule?.goal || "").trim().slice(0, 4000),
      },
      policy: { httpAllowHosts: hosts },
      needsEmail: Boolean(a?.needsEmail),
      notes: String(a?.notes || "").trim().slice(0, 500),
    };
  });

  const keySet = new Set(agents.map((a) => a.key));
  for (const a of agents) {
    a.managedAgentKeys = a.managedAgentKeys.filter((k) => keySet.has(k) && k !== a.key);
  }

  const triggers = (Array.isArray(parsed?.triggers) ? parsed.triggers : [])
    .slice(0, 20)
    .map((t, i) => {
      const type = TRIGGER_TYPES.includes(String(t?.type || "")) ? String(t.type) : "event";
      const action = TRIGGER_ACTIONS.includes(String(t?.action || ""))
        ? String(t.action)
        : "enqueue_task";
      const agentKey = slugKey(t?.agentKey);
      const config =
        t?.config && typeof t.config === "object" && !Array.isArray(t.config) ? { ...t.config } : {};
      if (type === "event" && !config.eventType) {
        config.eventType = String(t?.eventType || "email.replied").trim().slice(0, 120);
      }
      if (type === "time" && !config.cron && !config.interval) {
        config.interval = "1h";
      }
      const actionConfig =
        t?.actionConfig && typeof t.actionConfig === "object" && !Array.isArray(t.actionConfig)
          ? { ...t.actionConfig }
          : {};
      if (!actionConfig.instructions) {
        actionConfig.instructions = String(t?.instructions || t?.purpose || "").trim().slice(0, 4000);
      }
      return {
        name: String(t?.name || `Trigger ${i + 1}`).trim().slice(0, 120) || `Trigger ${i + 1}`,
        purpose: String(t?.purpose || "").trim().slice(0, 800),
        type,
        agentKey: keySet.has(agentKey) ? agentKey : agents[0]?.key || "",
        config,
        action,
        actionConfig,
      };
    })
    .filter((t) => t.agentKey);

  const apis = (Array.isArray(parsed?.apis) ? parsed.apis : []).slice(0, 20).map((api, i) => ({
    purpose: String(api?.purpose || `API step ${i + 1}`).trim().slice(0, 400),
    method: String(api?.method || "GET").trim().toUpperCase().slice(0, 10) || "GET",
    hostHint: String(api?.hostHint || api?.host || "").trim().toLowerCase().slice(0, 200),
    pathHint: String(api?.pathHint || api?.path || "").trim().slice(0, 400),
    usedByAgentKey: keySet.has(slugKey(api?.usedByAgentKey))
      ? slugKey(api.usedByAgentKey)
      : agents[0]?.key || "",
    notes: String(api?.notes || "").trim().slice(0, 800),
  }));

  // Why: fold API hosts into agent allow-lists so http_request works after apply.
  for (const api of apis) {
    if (!api.hostHint || !api.usedByAgentKey) continue;
    const agent = agents.find((a) => a.key === api.usedByAgentKey);
    if (!agent) continue;
    if (!agent.policy.httpAllowHosts.includes(api.hostHint)) {
      agent.policy.httpAllowHosts.push(api.hostHint);
    }
    if (!/http_request|API|endpoint/i.test(agent.instructions)) {
      agent.instructions = [
        agent.instructions,
        "",
        `API usage: use http_request for ${api.method} ${api.hostHint}${api.pathHint || ""} — ${api.purpose}. ${api.notes}`,
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 8000);
    }
  }

  const explanation = (Array.isArray(parsed?.explanation) ? parsed.explanation : [])
    .slice(0, 30)
    .map((e) => ({
      title: String(e?.title || "Step").trim().slice(0, 120),
      detail: String(e?.detail || "").trim().slice(0, 1200),
    }))
    .filter((e) => e.detail);

  if (!explanation.length && agents.length) {
    explanation.push({
      title: "Agents",
      detail: agents.map((a) => `${a.name} (${a.key}): ${a.description || a.skill || "worker"}`).join(" · "),
    });
  }

  const setupRequired = (Array.isArray(parsed?.setupRequired) ? parsed.setupRequired : [])
    .map((s) => String(s || "").trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 20);

  for (const a of agents) {
    if (a.needsEmail) {
      setupRequired.push(
        `Configure SMTP/IMAP on agent “${a.name}” (Agent edit → Email) before outreach runs.`
      );
    }
    if (a.schedule.enabled && !a.schedule.goal) {
      a.schedule.goal = a.successCriteria || a.instructions.slice(0, 500) || `Run: ${a.name}`;
    }
  }
  for (const api of apis) {
    if (api.hostHint) {
      setupRequired.push(
        `Provide API credentials/base URL for ${api.method} ${api.hostHint}${api.pathHint || ""} (${api.purpose}).`
      );
    }
  }

  return {
    summary: String(parsed?.summary || "").trim().slice(0, 2000),
    explanation,
    agents,
    triggers,
    apis,
    setupRequired: [...new Set(setupRequired)].slice(0, 25),
  };
}

/**
 * Builds a business automation plan from a plain-English brief (no side effects).
 * @param {string} userId
 * @param {string} brief
 * @returns {Promise<{ ok: true, plan: object, brief: string } | { ok: false, title: string, detail: string, hint?: string }>}
 */
export async function planBusinessFromBrief(userId, brief) {
  const text = String(brief || "").trim();
  if (text.length < 20) {
    return {
      ok: false,
      title: "Brief too short",
      detail: "Describe your business workflow in a few sentences (who does what, when, and what happens next).",
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      ok: false,
      title: "LLM not configured",
      detail: "Connect your LLM in Settings before planning a business setup.",
      hint: "Open Settings → LLM, save an API key or OAuth, then try again.",
    };
  }

  const system = [
    "You are YamBot's business planner. The user describes a whole business workflow in plain English.",
    "You MUST return JSON only (no markdown) matching this shape:",
    "{",
    '  "summary": "2-4 sentence overview of what will be built",',
    '  "explanation": [{ "title": "...", "detail": "what you will create and why" }],',
    '  "agents": [{',
    '    "key": "slug", "name", "description", "skill", "profile", "instructions", "successCriteria",',
    '    "role": "worker"|"manager", "managedAgentKeys": [],',
    '    "schedule": { "enabled": bool, "interval": "15m|30m|1h|6h|12h|24h|daily", "dailyAt": "HH:MM", "goal": "..." },',
    '    "policy": { "httpAllowHosts": ["host.com"] },',
    '    "needsEmail": bool, "notes": "..."',
    "  }],",
    '  "triggers": [{',
    '    "name", "purpose": "why this trigger exists",',
    '    "type": "time|event|condition|threshold|change|anomaly",',
    '    "agentKey": "slug of agent that should run",',
    '    "config": { "eventType": "email.replied" },',
    '    "action": "enqueue_task|emit_event|delegate_goal|escalate",',
    '    "actionConfig": { "instructions": "goal text when fired" }',
    "  }],",
    '  "apis": [{ "purpose", "method": "GET|POST|PUT|PATCH|DELETE", "hostHint", "pathHint", "usedByAgentKey", "notes" }],',
    '  "setupRequired": ["human must provide SMTP", "API key for ..."]',
    "}",
    "",
    "Rules:",
    "- Prefer the fewest agents that still match the brief (usually 1–4).",
    "- If user says daily/every morning/at 9am → schedule.enabled true, interval daily, dailyAt in UTC HH:MM (default 09:00), schedule.goal = the recurring task.",
    "- If user says when reply / after email / if they respond → event trigger type event, config.eventType email.replied (or email.received), enqueue_task on the follow-up agent.",
    "- If user mentions an API to list customers then POST status → put steps in apis[] and bake http_request instructions into that agent; add host to httpAllowHosts.",
    "- Agent instructions must be numbered, concrete standing rules for EVERY run (browser + tools).",
    "- For email outreach: needsEmail true; mention send_email and status updates.",
    "- explanation[] must clearly tell the human what agents, schedules, and triggers you chose and for which purpose — this is shown BEFORE anything is created.",
    "- Do not invent secrets; put credential needs in setupRequired.",
    "- Keys must be stable short slugs (outreach, followup, inbox_checker).",
    "- Never return empty agents if the brief describes work.",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.oauthAccount || "",
      temperature: 0.25,
      maxTokens: 4500,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Business brief:\n\n${text.slice(0, 12_000)}`,
        },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "Planner LLM failed",
      detail: err?.message || "Could not reach your LLM.",
      hint: "Check Settings → LLM, then try again.",
    };
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      ok: false,
      title: "Could not parse plan",
      detail: "The LLM did not return valid JSON. Try again with a clearer brief.",
    };
  }

  const plan = normalizeBusinessPlan(parsed);
  if (!plan.agents.length) {
    return {
      ok: false,
      title: "Empty plan",
      detail: "No agents were proposed. Add more detail about who should do the work.",
    };
  }
  if (!plan.summary) {
    plan.summary = `Create ${plan.agents.length} agent(s)` +
      (plan.triggers.length ? `, ${plan.triggers.length} trigger(s)` : "") +
      (plan.apis.length ? `, and ${plan.apis.length} API step(s)` : "") +
      " from your brief.";
  }

  return { ok: true, plan, brief: text.slice(0, 12_000) };
}
