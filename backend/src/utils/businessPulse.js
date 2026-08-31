/**
 * @fileoverview Business pulse — observe → decide → act loop for Command Center / scheduler.
 * Purpose: Surface proactive findings and auto-apply safe fixes under maxAuthorityLevel.
 * Downstream: GET/POST /api/ceo/pulse*, tickBusinessPulse in scheduler, CommandCenterPage.
 */

import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { Goal } from "../models/Goal.js";
import { CompanyEvent } from "../models/CompanyEvent.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { Skill } from "../models/Skill.js";
import { Demonstration } from "../models/Demonstration.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { recordDecision } from "../models/DecisionJournal.js";
import { computeAgentReadiness } from "./agentReadiness.js";
import { emitEvent } from "./eventBus.js";
import { enqueueTask } from "./enqueueTask.js";
import { applyBusinessPlan } from "./applyBusinessPlan.js";
import { optimizeModelCosts } from "./ceoChat.js";

const AUTHORITY_RANK = {
  observe: 0,
  internal: 1,
  external: 2,
  financial: 3,
  critical: 4,
};

/**
 * @param {string|import("mongoose").Types.ObjectId} id
 * @returns {import("mongoose").Types.ObjectId}
 */
function asObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * @param {string} maxLevel
 * @param {string} need
 * @returns {boolean}
 */
function authorityAllows(maxLevel, need) {
  const ceiling = AUTHORITY_RANK[maxLevel] ?? AUTHORITY_RANK.external;
  const rank = AUTHORITY_RANK[need] ?? AUTHORITY_RANK.external;
  return rank <= ceiling;
}

/**
 * Pick least-busy agent that meets a minimum readiness score.
 * @param {string} userId
 * @param {{ minReadiness?: number, excludeIds?: string[] }} [opts]
 * @returns {Promise<object|null>}
 */
export async function pickWorkforceAssignee(userId, opts = {}) {
  const minReadiness = Number(opts.minReadiness) || 50;
  const exclude = new Set((opts.excludeIds || []).map(String));
  const agents = await Agent.find({
    user: userId,
    active: { $ne: false },
    role: { $ne: "manager" },
  })
    .limit(40)
    .lean();

  /** @type {{ agent: object, readiness: number, busy: number }[]} */
  const scored = [];
  for (const a of agents) {
    if (exclude.has(String(a._id))) continue;
    const readiness = computeAgentReadiness(a, {}).score;
    if (readiness < minReadiness) continue;
    const busy = await Task.countDocuments({
      user: userId,
      agent: a._id,
      status: { $in: ["pending", "running", "waiting_user", "blocked"] },
    });
    scored.push({ agent: a, readiness, busy });
  }
  scored.sort((x, y) => x.busy - y.busy || y.readiness - x.readiness);
  return scored[0] || null;
}

/**
 * Build proactive business findings for one account.
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function buildBusinessPulse(userId) {
  const user = await User.findById(userId).select("settings").lean();
  const maxAuthorityLevel = user?.settings?.maxAuthorityLevel || "external";

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    agents,
    recentFails,
    kpiGaps,
    highEvents,
    draftSkills,
    recentDemos,
    improvements,
    goalGaps,
  ] = await Promise.all([
    Agent.find({ user: userId }).limit(80).lean(),
    Task.find({
      user: userId,
      status: "error",
      createdAt: { $gte: since24h },
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .select("agent goal lastError createdAt")
      .lean(),
    CompanyEvent.find({
      user: userId,
      type: "goal.kpi.gap",
      createdAt: { $gte: since7d },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    CompanyEvent.find({
      user: userId,
      significance: { $in: ["high", "critical"] },
      createdAt: { $gte: since24h },
    })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
    Skill.find({ user: userId, status: "draft" })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select("name status sourceDemonstration agent updatedAt")
      .lean(),
    Demonstration.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(8)
      .select("title agent steps createdAt")
      .lean(),
    ImprovementProposal.find({ user: userId, status: "proposed" })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Goal.find({
      user: userId,
      status: "active",
    })
      .select("title kpis agent autonomy")
      .limit(30)
      .lean(),
  ]);

  /** @type {object[]} */
  const findings = [];

  for (const a of agents) {
    const readiness = computeAgentReadiness(a, {}).score;
    if (a.active !== false && readiness < 60) {
      findings.push({
        id: `readiness:${a._id}`,
        severity: readiness < 40 ? "high" : "medium",
        kind: "weak_agent",
        title: `${a.name} readiness ${readiness}%`,
        detail: "Missing instructions, email, schedule/trigger, or recent healthy runs.",
        agentId: String(a._id),
        actions: [
          {
            type: "link",
            label: "Edit agent",
            href: `/agents/${a._id}`,
            authority: "observe",
          },
          {
            type: "diagnose",
            label: "Diagnose",
            agentId: String(a._id),
            authority: "observe",
          },
        ],
      });
    }
  }

  const failByAgent = new Map();
  for (const t of recentFails) {
    const id = String(t.agent || "");
    if (!id) continue;
    failByAgent.set(id, (failByAgent.get(id) || 0) + 1);
  }
  for (const [agentId, count] of failByAgent) {
    if (count < 2) continue;
    const agent = agents.find((a) => String(a._id) === agentId);
    const sample = recentFails.find((t) => String(t.agent) === agentId);
    const errText = String(sample?.lastError || "");
    findings.push({
      id: `fails:${agentId}`,
      severity: count >= 4 ? "high" : "medium",
      kind: "repeated_failures",
      title: `${agent?.name || "Agent"} failed ${count}× in 24h`,
      detail: errText.slice(0, 240) || "See Agent runs for details.",
      agentId,
      actions: [
        {
          type: "apply_recovery",
          label: "Apply recovery playbook",
          agentId,
          errorHint: errText.slice(0, 200),
          authority: "internal",
        },
        {
          type: "diagnose",
          label: "Ask why",
          agentId,
          authority: "observe",
        },
        {
          type: "link",
          label: "Open runs",
          href: `/runs?agentId=${agentId}`,
          authority: "observe",
        },
      ],
    });
  }

  for (const g of goalGaps) {
    const kpis = Array.isArray(g.kpis) ? g.kpis : [];
    for (const k of kpis) {
      const target = Number(k.target);
      const current = Number(k.current) || 0;
      if (!Number.isFinite(target) || target <= 0) continue;
      if (current >= target) continue;
      const pct = Math.round((current / target) * 100);
      findings.push({
        id: `kpi:${g._id}:${k.name}`,
        severity: pct < 50 ? "high" : "medium",
        kind: "kpi_gap",
        title: `KPI “${k.name}” at ${pct}% of target`,
        detail: `Goal “${g.title}”: ${current} / ${target}${k.unit ? ` ${k.unit}` : ""}`,
        goalId: String(g._id),
        agentId: g.agent ? String(g.agent) : "",
        actions: [
          {
            type: "spawn_goal_work",
            label: "Assign work now",
            goalId: String(g._id),
            authority: "internal",
          },
          {
            type: "link",
            label: "Open goal",
            href: `/goals/${g._id}`,
            authority: "observe",
          },
        ],
      });
    }
  }

  for (const e of kpiGaps.slice(0, 5)) {
    findings.push({
      id: `event:${e._id}`,
      severity: e.significance === "critical" ? "high" : "medium",
      kind: "kpi_event",
      title: e.summary || "KPI gap event",
      detail: `Event ${e.type}`,
      actions: [{ type: "link", label: "Operations", href: "/operations", authority: "observe" }],
    });
  }

  for (const e of highEvents.slice(0, 6)) {
    if (e.type === "goal.kpi.gap") continue;
    findings.push({
      id: `hevent:${e._id}`,
      severity: e.significance === "critical" ? "high" : "medium",
      kind: "business_event",
      title: e.summary || e.type,
      detail: `Significance: ${e.significance}`,
      actions: [{ type: "link", label: "Governance", href: "/governance", authority: "observe" }],
    });
  }

  for (const s of draftSkills) {
    findings.push({
      id: `skill:${s._id}`,
      severity: "low",
      kind: "watch_me_draft",
      title: `Watch-me draft skill: ${s.name}`,
      detail: "Promote to production or hire an employee that uses this skill.",
      skillId: String(s._id),
      actions: [
        {
          type: "link",
          label: "Open Skills",
          href: "/skills",
          authority: "observe",
        },
        {
          type: "open_architect",
          label: "Hire from this skill",
          prompt: `Hire an employee whose primary skill is “${s.name}”. Use the draft skill playbook already captured from a Watch-me demonstration.`,
          authority: "external",
        },
      ],
    });
  }

  for (const d of recentDemos) {
    if ((d.steps || []).length < 3) continue;
    findings.push({
      id: `demo:${d._id}`,
      severity: "low",
      kind: "watch_me_demo",
      title: `Recent demonstration: ${d.title || "Untitled"}`,
      detail: `${(d.steps || []).length} steps · convert on Live screen / Skills if not already a skill.`,
      agentId: d.agent ? String(d.agent) : "",
      actions: [
        {
          type: "link",
          label: "Open agent live",
          href: d.agent ? `/agents/${d.agent}` : "/skills",
          authority: "observe",
        },
      ],
    });
  }

  for (const imp of improvements) {
    findings.push({
      id: `imp:${imp._id}`,
      severity: imp.risk === "high" ? "medium" : "low",
      kind: "improvement",
      title: imp.title,
      detail: imp.proposedState || imp.currentState || "",
      improvementId: String(imp._id),
      agentId: imp.agent ? String(imp.agent) : "",
      actions: [
        {
          type: "link",
          label: "Review in Governance",
          href: "/governance",
          authority: "observe",
        },
        {
          type: "apply_recovery",
          label: "Apply recovery hint",
          agentId: imp.agent ? String(imp.agent) : "",
          errorHint: String(imp.currentState || "").slice(0, 200),
          authority: "internal",
        },
      ],
    });
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  unique.sort(
    (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
  );

  return {
    ok: true,
    at: new Date().toISOString(),
    maxAuthorityLevel,
    summary: {
      findingCount: unique.length,
      high: unique.filter((f) => f.severity === "high").length,
      medium: unique.filter((f) => f.severity === "medium").length,
      weakAgents: unique.filter((f) => f.kind === "weak_agent").length,
      draftSkills: draftSkills.length,
      openImprovements: improvements.length,
    },
    findings: unique.slice(0, 40),
  };
}

/**
 * Persist a recovery playbook tip for an error pattern.
 * @param {string} userId
 * @param {string} pattern
 * @param {string} playbook
 */
async function upsertRecoveryPlaybook(userId, pattern, playbook) {
  const key = `recovery:${String(pattern || "generic")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .slice(0, 80)}`;
  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      $set: {
        value: String(playbook || "").slice(0, 2000),
        category: "system",
        source: "ceo_pulse",
        key,
      },
      $setOnInsert: { user: userId, confidence: 0.8 },
    },
    { upsert: true }
  );
  return key;
}

/**
 * Load a recovery playbook matching error text.
 * @param {string} userId
 * @param {string} errorHint
 * @returns {Promise<string>}
 */
async function findRecoveryPlaybook(userId, errorHint) {
  const hint = String(errorHint || "").toLowerCase();
  const rows = await CompanyMemory.find({
    user: userId,
    key: { $regex: /^recovery:/ },
  })
    .limit(40)
    .lean();
  for (const r of rows) {
    const token = String(r.key || "").replace(/^recovery:/, "").replace(/_/g, " ");
    if (token && hint.includes(token.slice(0, 24))) {
      return String(r.value || "");
    }
  }
  if (/email|smtp|imap|mailbox|not configured/i.test(hint)) {
    return "Open Agents → Email (or Architect Sync mailbox). Ensure Gmail app password + smtp.gmail.com / imap.gmail.com. Then retry check_email.";
  }
  if (/captcha|challenge/i.test(hint)) {
    return "Take control on Live Wall, solve CAPTCHA once, optionally Teach skill, then resume the agent.";
  }
  if (/timeout|navigation|net::/i.test(hint)) {
    return "Retry with a narrower goal URL; add site memory; lower schedule frequency if the site is slow.";
  }
  return "Diagnose the last run, simplify standing instructions, or record a Watch-me demonstration for this site.";
}

/**
 * Apply a pulse action under authority policy.
 * @param {string} userId
 * @param {object} body
 * @returns {Promise<object>}
 */
export async function applyPulseAction(userId, body = {}) {
  const user = await User.findById(userId).select("settings");
  const maxAuthorityLevel = user?.settings?.maxAuthorityLevel || "external";
  const type = String(body.type || body.action || "").trim();
  const need = String(body.authority || "internal").trim();

  if (!authorityAllows(maxAuthorityLevel, need)) {
    return {
      ok: false,
      title: "Blocked by authority",
      detail: `Action “${type}” needs ${need}; account ceiling is ${maxAuthorityLevel}. Raise it under Policies.`,
    };
  }

  if (type === "apply_recovery") {
    const agentId = String(body.agentId || "").trim();
    if (!mongoose.isValidObjectId(agentId)) {
      return { ok: false, title: "Agent required", detail: "Pick an agent to recover." };
    }
    const agent = await Agent.findOne({ _id: agentId, user: userId });
    if (!agent) {
      return { ok: false, title: "Agent missing", detail: "Agent not found." };
    }
    const playbook = await findRecoveryPlaybook(userId, body.errorHint || "");
    const tip = `\n\n[Recovery playbook ${new Date().toISOString().slice(0, 10)}]\n${playbook}`;
    agent.instructions = `${String(agent.instructions || "").trim()}${tip}`.slice(0, 8000);
    await agent.save();
    const pattern =
      String(body.errorHint || "")
        .toLowerCase()
        .match(/[a-z]{4,}/g)
        ?.slice(0, 3)
        .join("_") || "generic";
    await upsertRecoveryPlaybook(userId, pattern, playbook);
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "internal",
      decision: `Applied recovery playbook to ${agent.name}`,
      rationale: playbook.slice(0, 500),
      context: { agentId },
      outcome: "applied",
      approved: true,
    });
    await emitEvent({
      userId,
      type: "ceo.recovery_applied",
      source: "system",
      significance: "medium",
      agentId,
      summary: `Recovery playbook applied to ${agent.name}`,
    });
    return {
      ok: true,
      detail: `Recovery tip appended to ${agent.name}'s instructions.`,
      playbook,
      agentId,
    };
  }

  if (type === "spawn_goal_work") {
    const goalId = String(body.goalId || "").trim();
    if (!mongoose.isValidObjectId(goalId)) {
      return { ok: false, title: "Goal required", detail: "Missing goalId." };
    }
    const goal = await Goal.findOne({ _id: goalId, user: userId });
    if (!goal) {
      return { ok: false, title: "Goal missing", detail: "Goal not found." };
    }
    let agentId = goal.agent ? String(goal.agent) : "";
    if (!agentId) {
      const pick = await pickWorkforceAssignee(userId);
      if (!pick) {
        return {
          ok: false,
          title: "No capacity",
          detail: "No ready worker available. Hire or fix readiness first.",
        };
      }
      agentId = String(pick.agent._id);
      goal.agent = pick.agent._id;
      await goal.save();
    }
    const busy = await Task.countDocuments({
      user: userId,
      agent: agentId,
      status: { $in: ["pending", "running", "waiting_user"] },
    });
    if (busy > 0) {
      return {
        ok: false,
        title: "Agent busy",
        detail: "Assignee already has active work. Try again shortly.",
      };
    }
    const { buildGoalRunText } = await import("../models/Goal.js");
    const text = buildGoalRunText(goal);
    const enq = await enqueueTask({
      userId,
      agentId,
      goalText: text,
      source: "ceo_pulse",
      goalRef: goal._id,
      priority: "high",
      chatTitle: `Pulse · ${goal.title}`,
    });
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "internal",
      decision: `Assigned work for goal “${goal.title}”`,
      rationale: "KPI gap / pulse assign",
      context: { goalId, agentId, taskId: String(enq.task._id) },
      outcome: "enqueued",
      approved: true,
    });
    return {
      ok: true,
      detail: `Work enqueued for “${goal.title}”.`,
      taskId: String(enq.task._id),
      agentId,
    };
  }

  if (type === "apply_model_route") {
    const agentId = String(body.agentId || "").trim();
    const profileId = String(body.profileId || "").trim();
    if (!mongoose.isValidObjectId(agentId) || !mongoose.isValidObjectId(profileId)) {
      return { ok: false, title: "Invalid ids", detail: "agentId and profileId required." };
    }
    const [agent, profile] = await Promise.all([
      Agent.findOne({ _id: agentId, user: userId }),
      LlmProfile.findOne({ _id: profileId, user: userId }),
    ]);
    if (!agent || !profile) {
      return { ok: false, title: "Missing", detail: "Agent or LLM profile not found." };
    }
    agent.llm = agent.llm || {};
    agent.llm.useCustom = true;
    agent.llm.profile = profile._id;
    await agent.save();
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "internal",
      decision: `Routed ${agent.name} → LLM “${profile.name}”`,
      rationale: body.reason || "Cost/model optimizer",
      context: { agentId, profileId },
      outcome: "applied",
      approved: true,
    });
    return {
      ok: true,
      detail: `${agent.name} now uses LLM profile “${profile.name}”.`,
    };
  }

  if (type === "hire_roles") {
    if (!authorityAllows(maxAuthorityLevel, "external")) {
      return {
        ok: false,
        title: "Blocked by authority",
        detail: "Hiring employees needs external authority or higher.",
      };
    }
    const roles = Array.isArray(body.roles) ? body.roles : [];
    if (!roles.length) {
      return { ok: false, title: "No roles", detail: "Provide roles[] from SOP/department design." };
    }
    const departmentName = String(body.departmentName || "Department").slice(0, 120);
    const plan = {
      summary: `Hire ${departmentName}`,
      agents: roles.slice(0, 6).map((r, i) => {
        const title = String(r.title || `Role ${i + 1}`).slice(0, 120);
        return {
          key: `hire_${i}`,
          name: title,
          role: i === 0 && roles.length > 1 ? "manager" : "worker",
          skill: String(r.responsibilities || title).slice(0, 2000),
          instructions: String(r.architectPrompt || r.responsibilities || title).slice(0, 8000),
          profile: String(r.responsibilities || "").slice(0, 4000),
          managedAgentKeys:
            i === 0 && roles.length > 1 ? roles.slice(1).map((_, j) => `hire_${j + 1}`) : [],
          schedule: { enabled: false },
          needsEmail: /email|inbox|mail/i.test(`${title} ${r.responsibilities || ""}`),
        };
      }),
      triggers: [],
      apis: [],
    };

    const result = await applyBusinessPlan(userId, plan);
    if (!result.ok) return result;
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "external",
      decision: `Hired ${result.created?.agents?.length || 0} employees for ${departmentName}`,
      rationale: body.rationale || "SOP / department hire from Command Center",
      context: { departmentName, agentIds: (result.created?.agents || []).map((a) => a._id) },
      outcome: "hired",
      approved: true,
    });
    return {
      ok: true,
      detail: `Created ${result.created?.agents?.length || 0} agent(s) for ${departmentName}.`,
      created: result.created,
    };
  }

  return {
    ok: false,
    title: "Unknown action",
    detail: `Pulse action “${type}” is not supported.`,
  };
}

/**
 * Scheduler tick: auto-apply low-risk recoveries when authority allows.
 * @returns {Promise<{ users: number, autoApplied: number }>}
 */
export async function tickBusinessPulse() {
  const users = await User.find({}).select("_id settings").limit(100).lean();
  let autoApplied = 0;
  for (const u of users) {
    const userId = String(u._id);
    const maxAuthorityLevel = u.settings?.maxAuthorityLevel || "external";
    if (!authorityAllows(maxAuthorityLevel, "internal")) continue;

    // Rate limit: one auto pulse per user per 30 minutes
    const last = await CompanyMemory.findOne({ user: userId, key: "pulse_last_auto_at" }).lean();
    if (last?.value) {
      const t = Date.parse(last.value);
      if (Number.isFinite(t) && Date.now() - t < 30 * 60_000) continue;
    }

    const pulse = await buildBusinessPulse(userId);
    const recoverable = (pulse.findings || []).filter(
      (f) => f.kind === "repeated_failures" && f.severity === "high"
    );
    for (const f of recoverable.slice(0, 1)) {
      const res = await applyPulseAction(userId, {
        type: "apply_recovery",
        authority: "internal",
        agentId: f.agentId,
        errorHint: f.detail,
      });
      if (res.ok) autoApplied += 1;
    }

    await CompanyMemory.findOneAndUpdate(
      { user: userId, key: "pulse_last_auto_at" },
      {
        $set: {
          value: new Date().toISOString(),
          category: "system",
          source: "ceo_pulse",
          key: "pulse_last_auto_at",
        },
        $setOnInsert: { user: userId },
      },
      { upsert: true }
    );
  }
  return { users: users.length, autoApplied };
}

/**
 * Apply all model optimizer suggestions that are safe (internal authority).
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function applyAllModelOptimizations(userId) {
  const opt = await optimizeModelCosts(userId);
  const suggestions = opt.suggestions || [];
  /** @type {object[]} */
  const applied = [];
  /** @type {object[]} */
  const skipped = [];
  for (const s of suggestions.slice(0, 20)) {
    const res = await applyPulseAction(userId, {
      type: "apply_model_route",
      authority: "internal",
      agentId: s.agentId,
      profileId: s.profileId,
      reason: s.reason,
    });
    if (res.ok) applied.push({ agentId: s.agentId, profileId: s.profileId });
    else skipped.push({ agentId: s.agentId, detail: res.detail });
  }
  return {
    ok: true,
    applied,
    skipped,
    detail: `Applied ${applied.length} model route(s); skipped ${skipped.length}.`,
  };
}
