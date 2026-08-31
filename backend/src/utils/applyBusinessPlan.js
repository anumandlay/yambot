/**
 * @fileoverview Applies a confirmed business plan: create agents, schedules, triggers.
 * Purpose: Second step after planBusinessFromBrief — only runs when the user confirms.
 * Downstream: POST /api/business/apply, computer-manager (new agent boxes), Operations triggers.
 */

import { Agent, computeNextRunAt } from "../models/Agent.js";
import { Trigger, TRIGGER_TYPES, TRIGGER_ACTIONS, normalizeTriggerEventType } from "../models/Trigger.js";
import { getPlatformSettings } from "../models/PlatformSettings.js";
import { debitWallet, creditWallet } from "./wallet.js";
import { issueWorkerToken, containerNameForAgent } from "./workerAuth.js";
import { encryptSecret } from "./crypto.js";
import { normalizeBusinessPlan } from "./businessPlanFromBrief.js";
import {
  mergeAnswersIntoPlan,
  isPlaceholderSecret,
  inferMailHosts,
} from "./businessChat.js";
import { publicEmailSummary } from "./agentEmail.js";

/**
 * Creates one cloud agent from a plan agent row (wallet debit when priced).
 * @param {string} userId
 * @param {object} row
 * @param {number} agentPriceCents
 * @returns {Promise<import('mongoose').Document>}
 */
async function createAgentFromPlanRow(userId, row, agentPriceCents) {
  const issued = issueWorkerToken();
  const scheduleEnabled = Boolean(row.schedule?.enabled);
  const schedule = {
    enabled: scheduleEnabled,
    goal: String(row.schedule?.goal || "").trim().slice(0, 4000),
    interval: String(row.schedule?.interval || "daily"),
    dailyAt: String(row.schedule?.dailyAt || "09:00").trim().slice(0, 5) || "09:00",
    lastRunAt: null,
    nextRunAt: null,
    chatId: null,
  };
  if (scheduleEnabled) {
    schedule.nextRunAt = computeNextRunAt(schedule, new Date());
  }

  const agent = new Agent({
    user: userId,
    name: row.name,
    description: row.description,
    profile: row.profile,
    skill: row.skill,
    instructions: row.instructions,
    successCriteria: row.successCriteria,
    mode: "browser",
    runner: "cloud",
    active: true,
    role: row.role === "manager" ? "manager" : "worker",
    managedAgents: [],
    schedule,
    policy: {
      requireApprovalForSubmit: false,
      monthlyBudgetUsd: 0,
      dailyBudgetUsd: 0,
      maxTaskMinutes: 0,
      escalateWaitingMinutes: 30,
      blockedUrlPatterns: [],
      httpAllowHosts: Array.isArray(row.policy?.httpAllowHosts) ? row.policy.httpAllowHosts : [],
    },
    email: {
      enabled: false,
    },
    workerTokenHash: issued.workerTokenHash,
    workerTokenEnc: issued.workerTokenEnc,
    computer: {
      desired: "running",
      containerName: "",
    },
  });

  if (row.email && (row.email.fromAddress || row.email.smtpHost || row.email.smtpPassword)) {
    const hosts = inferMailHosts(row.email.fromAddress, row.email.smtpHost, row.email.imapHost);
    let pass = String(row.email.smtpPassword || "").trim();
    if (isPlaceholderSecret(pass)) pass = "";
    agent.email = {
      enabled: row.email.enabled !== false,
      fromName: String(row.email.fromName || row.name || "").trim().slice(0, 120),
      fromAddress: String(row.email.fromAddress || "").trim().slice(0, 200),
      smtpHost: String(hosts.smtpHost || "").trim().slice(0, 200),
      smtpPort: Number(row.email.smtpPort) || 587,
      smtpSecure: Boolean(row.email.smtpSecure) || Number(row.email.smtpPort) === 465,
      smtpUser: String(row.email.smtpUser || row.email.fromAddress || "").trim().slice(0, 200),
      imapHost: String(hosts.imapHost || hosts.smtpHost || "").trim().slice(0, 200),
      imapPort: Number(row.email.imapPort) || 993,
      imapSecure: row.email.imapSecure !== false,
    };
    if (pass) {
      agent.email.smtpPasswordEnc = encryptSecret(pass);
    }
  } else if (row.needsEmail) {
    // Why: mark enabled so the edit form shows email as expected; still not "configured" until password+hosts.
    agent.email = {
      enabled: true,
      fromName: String(row.name || "").trim().slice(0, 120),
    };
  }

  /** @type {{ transaction?: { _id: unknown } } | null} */
  let debitResult = null;
  if (agentPriceCents > 0) {
    debitResult = await debitWallet({
      userId,
      amountCents: agentPriceCents,
      type: "agent_create",
      note: `Business setup: ${row.name}`,
      meta: { agentName: row.name, priceCents: agentPriceCents, source: "business_plan" },
    });
  }

  try {
    // Why: container name needs _id — assign before first save.
    agent.computer.containerName = containerNameForAgent(agent._id);
    await agent.save();
    if (debitResult?.transaction?._id) {
      const { WalletTransaction } = await import("../models/WalletTransaction.js");
      await WalletTransaction.findByIdAndUpdate(debitResult.transaction._id, {
        agent: agent._id,
      });
    }
  } catch (saveErr) {
    if (agentPriceCents > 0) {
      await creditWallet({
        userId,
        amountCents: agentPriceCents,
        type: "refund",
        note: `Refund — business setup agent failed: ${row.name}`,
        meta: { reason: saveErr.message },
      }).catch(() => {});
    }
    throw saveErr;
  }

  return agent;
}

/**
 * Applies a user-confirmed plan: agents first, then managedAgents links, then triggers.
 * @param {string} userId
 * @param {object} rawPlan
 * @returns {Promise<{ ok: true, created: object } | { ok: false, title: string, detail: string, hint?: string }>}
 */
export async function applyBusinessPlan(userId, rawPlan, answers = null) {
  const plan = answers
    ? mergeAnswersIntoPlan(rawPlan || {}, answers)
    : normalizeBusinessPlan(rawPlan || {});
  if (!plan.agents.length) {
    return {
      ok: false,
      title: "Nothing to create",
      detail: "The plan has no agents. Generate a plan from your brief first.",
    };
  }

  const settings = await getPlatformSettings();
  const agentPriceCents = Math.max(0, Number(settings.agentPriceCents) || 0);

  /** @type {Map<string, import('mongoose').Document>} */
  const byKey = new Map();
  /** @type {import('mongoose').Document[]} */
  const createdAgents = [];

  try {
    for (const row of plan.agents) {
      const agent = await createAgentFromPlanRow(userId, row, agentPriceCents);
      byKey.set(row.key, agent);
      createdAgents.push(agent);
    }

    // Why: managers need ObjectIds of workers created in the same batch.
    for (const row of plan.agents) {
      if (row.role !== "manager" || !row.managedAgentKeys?.length) continue;
      const manager = byKey.get(row.key);
      if (!manager) continue;
      manager.managedAgents = row.managedAgentKeys
        .map((k) => byKey.get(k)?._id)
        .filter(Boolean)
        .slice(0, 20);
      await manager.save();
    }

    /** @type {object[]} */
    const createdTriggers = [];
    try {
      for (const t of plan.triggers) {
        const agent = byKey.get(t.agentKey);
        if (!agent) continue;
        const type = TRIGGER_TYPES.includes(t.type) ? t.type : "event";
        const action = TRIGGER_ACTIONS.includes(t.action) ? t.action : "enqueue_task";
        const config = { ...(t.config || {}) };
        if (type === "event" && config.eventType) {
          config.eventType = normalizeTriggerEventType(config.eventType) || config.eventType;
        }
        const trigger = await Trigger.create({
          user: userId,
          name: t.name,
          enabled: true,
          type,
          agent: agent._id,
          config,
          action,
          actionConfig: {
            ...(t.actionConfig || {}),
            instructions: String(t.actionConfig?.instructions || t.purpose || "").slice(0, 4000),
          },
        });
        createdTriggers.push({
          _id: String(trigger._id),
          name: trigger.name,
          purpose: t.purpose,
          type: trigger.type,
          agentId: String(agent._id),
          agentKey: t.agentKey,
          agentName: agent.name,
          config: trigger.config,
        });
      }
    } catch (trigErr) {
      for (const t of createdTriggers) {
        await Trigger.deleteOne({ _id: t._id, user: userId }).catch(() => {});
      }
      throw trigErr;
    }

    return {
      ok: true,
      created: {
        summary: plan.summary,
        setupRequired: plan.setupRequired,
        agents: plan.agents.map((row) => {
          const doc = byKey.get(row.key);
          const emailSummary = doc ? publicEmailSummary(doc) : { configured: false };
          return {
            key: row.key,
            _id: doc ? String(doc._id) : null,
            name: doc?.name || row.name,
            role: row.role,
            scheduleEnabled: Boolean(row.schedule?.enabled),
            needsEmail: Boolean(row.needsEmail),
            emailConfigured: Boolean(emailSummary.configured),
            httpAllowHosts: row.policy?.httpAllowHosts || [],
          };
        }),
        triggers: createdTriggers,
        apis: plan.apis,
        emailWarnings: plan.agents
          .map((row) => {
            const doc = byKey.get(row.key);
            if (!doc) return null;
            if (!row.needsEmail && !row.email?.fromAddress) return null;
            if (publicEmailSummary(doc).configured) return null;
            return {
              agentId: String(doc._id),
              agentName: doc.name || row.name,
              detail:
                "Mailbox was not fully saved on this agent (need address, SMTP/IMAP hosts, and app password). Open Edit → Email, fill settings, Save, then retry the chat.",
            };
          })
          .filter(Boolean),
      },
    };
  } catch (err) {
    // Best-effort cleanup of agents created in this batch (triggers are last).
    for (const a of createdAgents) {
      try {
        await Trigger.deleteMany({ user: userId, agent: a._id });
        await Agent.deleteOne({ _id: a._id, user: userId });
        if (agentPriceCents > 0) {
          await creditWallet({
            userId,
            amountCents: agentPriceCents,
            type: "refund",
            note: `Refund — business setup rollback: ${a.name}`,
            meta: { agentId: String(a._id) },
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      title: err?.title || "Setup failed",
      detail: err?.detail || err?.message || "Could not create agents/triggers from the plan.",
      hint: err?.hint || "Fix wallet balance or LLM/agent limits, then try Apply again.",
    };
  }
}
