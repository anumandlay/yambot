/**
 * @fileoverview Sync Architect blueprint plan onto already-created live agents + triggers.
 * Purpose: After English change approval, update instructions/schedule/triggers without full rebuild.
 * Downstream: POST /api/architect/:id/apply-change with syncLiveAgents.
 */

import { Agent, computeNextRunAt } from "../models/Agent.js";
import {
  Trigger,
  TRIGGER_TYPES,
  TRIGGER_ACTIONS,
  normalizeTriggerEventType,
} from "../models/Trigger.js";
import { inferMailHosts, isPlaceholderSecret } from "./businessChat.js";

/**
 * @param {string} userId
 * @param {string[]} createdAgentIds
 * @param {object|null} proposedPlan
 * @returns {Promise<{ updated: object[], skipped: string[] }>}
 */
export async function syncLiveAgentsFromPlan(userId, createdAgentIds, proposedPlan) {
  const ids = (createdAgentIds || []).map(String).filter(Boolean);
  const planAgents = Array.isArray(proposedPlan?.agents) ? proposedPlan.agents : [];
  if (!ids.length || !planAgents.length) {
    return { updated: [], skipped: ["No live agents or plan agents to sync"] };
  }

  const agents = await Agent.find({ _id: { $in: ids }, user: userId });
  /** @type {object[]} */
  const updated = [];
  /** @type {string[]} */
  const skipped = [];

  for (const agent of agents) {
    const byName = planAgents.find(
      (p) =>
        String(p.name || "")
          .trim()
          .toLowerCase() === String(agent.name || "").trim().toLowerCase()
    );
    const byKey =
      !byName && planAgents.length === 1
        ? planAgents[0]
        : planAgents.find(
            (p) =>
              p.key &&
              String(agent.name || "")
                .toLowerCase()
                .includes(String(p.key).toLowerCase())
          );
    const row = byName || byKey;
    if (!row) {
      skipped.push(agent.name || String(agent._id));
      continue;
    }

    if (row.instructions) agent.instructions = String(row.instructions).slice(0, 8000);
    if (row.skill) agent.skill = String(row.skill).slice(0, 2000);
    if (row.profile) agent.profile = String(row.profile).slice(0, 4000);
    if (row.successCriteria) {
      agent.successCriteria = String(row.successCriteria).slice(0, 2000);
    }
    if (row.description) agent.description = String(row.description).slice(0, 300);
    if (row.role === "manager" || row.role === "worker") agent.role = row.role;

    if (row.policy?.httpAllowHosts?.length) {
      agent.policy = agent.policy || {};
      const hosts = new Set([
        ...(agent.policy.httpAllowHosts || []),
        ...row.policy.httpAllowHosts.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean),
      ]);
      agent.policy.httpAllowHosts = [...hosts].slice(0, 40);
    }

    if (row.schedule) {
      agent.schedule = agent.schedule || {};
      if (row.schedule.enabled != null) agent.schedule.enabled = Boolean(row.schedule.enabled);
      if (row.schedule.interval) agent.schedule.interval = String(row.schedule.interval);
      if (row.schedule.dailyAt) agent.schedule.dailyAt = String(row.schedule.dailyAt).slice(0, 5);
      if (row.schedule.goal) agent.schedule.goal = String(row.schedule.goal).slice(0, 4000);
      if (agent.schedule.enabled) {
        agent.schedule.nextRunAt = computeNextRunAt(agent.schedule, new Date());
      }
    }

    if (row.email && (row.email.fromAddress || row.email.smtpHost)) {
      const hosts = inferMailHosts(row.email.fromAddress, row.email.smtpHost, row.email.imapHost);
      agent.email = agent.email || {};
      agent.email.enabled = row.email.enabled !== false;
      if (row.email.fromName) agent.email.fromName = String(row.email.fromName).slice(0, 120);
      if (row.email.fromAddress) {
        agent.email.fromAddress = String(row.email.fromAddress).slice(0, 200);
      }
      if (hosts.smtpHost) agent.email.smtpHost = hosts.smtpHost;
      if (hosts.imapHost) agent.email.imapHost = hosts.imapHost;
      agent.email.smtpUser = String(
        row.email.smtpUser || agent.email.smtpUser || row.email.fromAddress || ""
      ).slice(0, 200);
      // Why: never overwrite password with public blueprint placeholders.
      const pass = String(row.email.smtpPassword || "").trim();
      if (pass && !isPlaceholderSecret(pass)) {
        const { encryptSecret } = await import("./crypto.js");
        agent.email.smtpPasswordEnc = encryptSecret(pass);
      }
    }

    await agent.save();
    updated.push({ agentId: String(agent._id), name: agent.name, planKey: row.key || "" });
  }

  return { updated, skipped };
}

/**
 * Sync blueprint plan.triggers onto live Trigger docs for this blueprint.
 * Why: Apply-change previously only updated agents; UI promised trigger diffs too.
 * @param {string} userId
 * @param {{
 *   createdAgentIds?: string[],
 *   createdTriggerIds?: string[],
 *   proposedPlan?: object|null,
 * }} opts
 * @returns {Promise<{ updated: object[], created: object[], disabled: object[], triggerIds: string[] }>}
 */
export async function syncLiveTriggersFromPlan(userId, opts = {}) {
  const agentIds = (opts.createdAgentIds || []).map(String).filter(Boolean);
  const priorTriggerIds = (opts.createdTriggerIds || []).map(String).filter(Boolean);
  const planTriggers = Array.isArray(opts.proposedPlan?.triggers) ? opts.proposedPlan.triggers : [];
  const planAgents = Array.isArray(opts.proposedPlan?.agents) ? opts.proposedPlan.agents : [];

  if (!agentIds.length) {
    return { updated: [], created: [], disabled: [], triggerIds: priorTriggerIds };
  }

  const agents = await Agent.find({ _id: { $in: agentIds }, user: userId });
  /** @type {Map<string, import("mongoose").Document>} */
  const agentByKey = new Map();
  for (const a of agents) {
    agentByKey.set(String(a.name || "").trim().toLowerCase(), a);
  }
  for (const pa of planAgents) {
    const key = String(pa.key || "").trim().toLowerCase();
    const name = String(pa.name || "").trim().toLowerCase();
    const match =
      agents.find((a) => String(a.name || "").trim().toLowerCase() === name) ||
      agents.find(
        (a) => key && String(a.name || "").toLowerCase().includes(key)
      );
    if (match && key) agentByKey.set(key, match);
    if (match && name) agentByKey.set(name, match);
  }

  const existing = await Trigger.find({
    user: userId,
    $or: [{ _id: { $in: priorTriggerIds } }, { agent: { $in: agentIds } }],
  });

  /** @type {object[]} */
  const updated = [];
  /** @type {object[]} */
  const created = [];
  /** @type {object[]} */
  const disabled = [];
  /** @type {Set<string>} */
  const keptIds = new Set();

  for (const t of planTriggers) {
    const name = String(t.name || "").trim();
    if (!name) continue;
    const nameLc = name.toLowerCase();
    const agentKey = String(t.agentKey || "").trim().toLowerCase();
    const agent =
      (agentKey && agentByKey.get(agentKey)) ||
      agentByKey.get(nameLc) ||
      (agents.length === 1 ? agents[0] : null);
    if (!agent) continue;

    const type = TRIGGER_TYPES.includes(t.type) ? t.type : "event";
    const action = TRIGGER_ACTIONS.includes(t.action) ? t.action : "enqueue_task";
    const config = { ...(t.config || {}) };
    if (type === "event" && config.eventType) {
      config.eventType = normalizeTriggerEventType(config.eventType) || config.eventType;
    }
    const actionConfig = {
      ...(t.actionConfig || {}),
      instructions: String(t.actionConfig?.instructions || t.purpose || "").slice(0, 4000),
    };

    const match = existing.find(
      (e) =>
        String(e.name || "")
          .trim()
          .toLowerCase() === nameLc && String(e.agent) === String(agent._id)
    ) || existing.find(
      (e) =>
        String(e.name || "")
          .trim()
          .toLowerCase() === nameLc
    );

    if (match) {
      match.enabled = t.enabled !== false;
      match.type = type;
      match.agent = agent._id;
      match.config = config;
      match.action = action;
      match.actionConfig = actionConfig;
      await match.save();
      keptIds.add(String(match._id));
      updated.push({ triggerId: String(match._id), name: match.name });
    } else {
      const row = await Trigger.create({
        user: userId,
        name,
        enabled: t.enabled !== false,
        type,
        agent: agent._id,
        config,
        action,
        actionConfig,
      });
      keptIds.add(String(row._id));
      created.push({ triggerId: String(row._id), name: row.name });
    }
  }

  // Why: disable blueprint-owned triggers removed from the plan (do not delete — audit trail).
  for (const e of existing) {
    const id = String(e._id);
    if (priorTriggerIds.includes(id) && !keptIds.has(id) && e.enabled !== false) {
      e.enabled = false;
      await e.save();
      disabled.push({ triggerId: id, name: e.name });
    }
  }

  const triggerIds = [
    ...new Set([...priorTriggerIds.filter((id) => keptIds.has(id) || !planTriggers.length), ...keptIds]),
  ];

  return { updated, created, disabled, triggerIds };
}
