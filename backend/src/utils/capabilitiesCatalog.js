/**
 * @fileoverview Capability discovery — what YamBot can already do for this user.
 * Purpose: Single catalog for Architect reuse, CEO chat, and Command Center.
 * Downstream: GET /api/capabilities, architectChat design context, ceoChat.
 */

import { Agent } from "../models/Agent.js";
import { Skill } from "../models/Skill.js";
import { Trigger } from "../models/Trigger.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { Goal } from "../models/Goal.js";
import { publicEmailSummary } from "./agentEmail.js";
import { computeAgentReadiness } from "./agentReadiness.js";

/** Built-in worker action groups (mirrors worker ACTION_TYPES at a high level). */
const BUILTIN_ACTIONS = [
  { id: "browser", label: "Browser navigation / click / type / extract" },
  { id: "email", label: "send_email / check_email" },
  { id: "http", label: "http_request (APIs)" },
  { id: "entities", label: "CRM entities / processes / KPI updates" },
  { id: "slack", label: "send_slack / send_webhook" },
  { id: "tickets", label: "support tickets" },
  { id: "deals", label: "deals / invoices" },
  { id: "finish", label: "finish task with result summary" },
];

/**
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function buildCapabilitiesCatalog(userId) {
  const [agents, skills, triggers, memoryRows, goals] = await Promise.all([
    Agent.find({ user: userId })
      .select(
        "name skill description role schedule.enabled schedule.interval email instructions successCriteria active computer.lastSeenAt computer.desired"
      )
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean(),
    Skill.find({ user: userId })
      .select("name slug description status triggers sourceDemonstration")
      .sort({ updatedAt: -1 })
      .limit(60)
      .lean(),
    Trigger.find({ user: userId }).select("name agent enabled type config").lean(),
    CompanyMemory.find({ user: userId })
      .select("key value")
      .limit(80)
      .lean(),
    Goal.find({ user: userId })
      .select("name status kpis agent")
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean(),
  ]);

  const triggerAgentIds = new Set(
    triggers.filter((t) => t.enabled !== false && t.agent).map((t) => String(t.agent))
  );

  const memMap = Object.fromEntries(
    memoryRows.map((r) => [String(r.key || "").trim(), String(r.value || "").trim()])
  );

  const integrations = {
    slackWebhook: Boolean(memMap.slack_webhook_url),
    defaultWebhook: Boolean(memMap.default_webhook_url),
    hubspot: Boolean(memMap.hubspot_api_key || memMap.hubspot_token),
    calendarOrganizer: Boolean(memMap.calendar_organizer_email),
    agentsWithEmail: agents.filter((a) => publicEmailSummary(a).configured).length,
  };

  const agentSummaries = agents.map((a) => {
    const email = publicEmailSummary(a);
    const readiness = computeAgentReadiness(a, {
      hasTrigger: triggerAgentIds.has(String(a._id)),
    });
    return {
      _id: String(a._id),
      name: a.name,
      role: a.role || "worker",
      skill: String(a.skill || "").slice(0, 200),
      description: String(a.description || "").slice(0, 200),
      scheduleEnabled: Boolean(a.schedule?.enabled),
      scheduleInterval: a.schedule?.interval || "",
      emailConfigured: Boolean(email.configured),
      emailAddress: email.fromAddress || "",
      active: a.active !== false,
      readinessScore: readiness.score,
    };
  });

  return {
    ok: true,
    at: new Date().toISOString(),
    agents: agentSummaries,
    skills: skills.map((s) => ({
      _id: String(s._id),
      name: s.name,
      slug: s.slug || "",
      status: s.status,
      description: String(s.description || "").slice(0, 200),
      fromDemo: Boolean(s.sourceDemonstration),
      triggers: (s.triggers || []).slice(0, 8),
    })),
    triggers: triggers.map((t) => ({
      _id: String(t._id),
      name: t.name,
      type: t.type,
      enabled: t.enabled !== false,
      agentId: t.agent ? String(t.agent) : "",
      eventType: t.config?.eventType || "",
    })),
    goals: goals.map((g) => ({
      _id: String(g._id),
      name: g.name,
      status: g.status,
      agentId: g.agent ? String(g.agent) : "",
      kpiCount: Array.isArray(g.kpis) ? g.kpis.length : 0,
    })),
    builtinActions: BUILTIN_ACTIONS,
    integrations,
    summary: {
      agentCount: agentSummaries.length,
      skillCount: skills.length,
      triggerCount: triggers.length,
      goalCount: goals.length,
      avgReadiness:
        agentSummaries.length === 0
          ? 0
          : Math.round(
              agentSummaries.reduce((s, a) => s + a.readinessScore, 0) / agentSummaries.length
            ),
    },
  };
}

/**
 * Compact text block for LLM system prompts.
 * @param {object} catalog
 * @returns {string}
 */
export function formatCapabilitiesForPrompt(catalog) {
  if (!catalog) return "(no capabilities loaded)";
  const lines = [
    `Agents (${catalog.summary?.agentCount || 0}):`,
    ...(catalog.agents || [])
      .slice(0, 25)
      .map(
        (a) =>
          `- ${a.name} [${a.role}] ready=${a.readinessScore}% email=${a.emailConfigured} schedule=${a.scheduleEnabled} skill=${(a.skill || "").slice(0, 60)}`
      ),
    `Skills (${catalog.summary?.skillCount || 0}):`,
    ...(catalog.skills || [])
      .slice(0, 20)
      .map((s) => `- ${s.name} (${s.status})${s.fromDemo ? " from-demo" : ""}`),
    `Integrations: slack=${catalog.integrations?.slackWebhook} hubspot=${catalog.integrations?.hubspot} emailAgents=${catalog.integrations?.agentsWithEmail}`,
    `Builtin tools: ${(catalog.builtinActions || []).map((a) => a.id).join(", ")}`,
  ];
  return lines.join("\n").slice(0, 8000);
}
