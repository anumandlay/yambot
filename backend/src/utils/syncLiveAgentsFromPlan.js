/**
 * @fileoverview Sync Architect blueprint plan onto already-created live agents.
 * Purpose: After English change approval, update instructions/schedule without recreating agents.
 * Downstream: POST /api/architect/:id/apply-change with syncLiveAgents.
 */

import { Agent, computeNextRunAt } from "../models/Agent.js";
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
    updated.push({ agentId: String(agent._id), name: agent.name });
  }

  return { updated, skipped };
}
