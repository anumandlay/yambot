/**
 * @fileoverview Department one-shot hire — agents + KPIs + skills + triggers + workflow stub.
 * Purpose: "Create a sales department" yields a complete operating unit, not just role shells.
 * Downstream: businessPulse hire_roles, CEO hire-roles, Command Center.
 */

import { Goal } from "../models/Goal.js";
import { Skill } from "../models/Skill.js";
import { Trigger } from "../models/Trigger.js";
import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { Agent } from "../models/Agent.js";
import { applyBusinessPlan } from "./applyBusinessPlan.js";
import { recordDecision } from "../models/DecisionJournal.js";

/**
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return String(title || "role")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Hire a full department with goals, draft skills, escalation trigger, and workflow stub.
 * @param {string} userId
 * @param {{
 *   roles: object[],
 *   departmentName?: string,
 *   rationale?: string,
 *   sharedRules?: string[],
 *   kpis?: { name: string, target?: number, unit?: string }[],
 * }} body
 */
export async function hireDepartmentComplete(userId, body = {}) {
  const roles = Array.isArray(body.roles) ? body.roles : [];
  if (!roles.length) {
    return { ok: false, title: "No roles", detail: "Provide roles[] from SOP/department design." };
  }
  const departmentName = String(body.departmentName || "Department").slice(0, 120);
  const sharedRules = Array.isArray(body.sharedRules)
    ? body.sharedRules.map((r) => String(r).slice(0, 400)).filter(Boolean)
    : [];

  const plan = {
    summary: `Hire ${departmentName}`,
    agents: roles.slice(0, 6).map((r, i) => {
      const title = String(r.title || `Role ${i + 1}`).slice(0, 120);
      const responsibilities = String(r.responsibilities || title).slice(0, 2000);
      const architectPrompt = String(r.architectPrompt || responsibilities || title).slice(0, 8000);
      const rulesBlock = sharedRules.length
        ? `\n\nDepartment rules:\n- ${sharedRules.join("\n- ")}`
        : "";
      return {
        key: `hire_${i}`,
        name: title,
        role: i === 0 && roles.length > 1 ? "manager" : "worker",
        skill: responsibilities,
        instructions: `${architectPrompt}${rulesBlock}`,
        profile: responsibilities.slice(0, 4000),
        successCriteria: String(r.successCriteria || `Complete ${title} responsibilities reliably.`).slice(
          0,
          1000
        ),
        managedAgentKeys:
          i === 0 && roles.length > 1 ? roles.slice(1).map((_, j) => `hire_${j + 1}`) : [],
        schedule: { enabled: false },
        needsEmail: /email|inbox|mail/i.test(`${title} ${responsibilities}`),
        policy: {
          httpAllowHosts: Array.isArray(r.httpAllowHosts) ? r.httpAllowHosts : [],
        },
      };
    }),
    triggers: [],
    apis: [],
  };

  const result = await applyBusinessPlan(userId, plan);
  if (!result.ok) return result;

  const createdAgents = result.created?.agents || [];
  /** @type {string[]} */
  const completeness = ["agents"];

  // Lifecycle: manager active; workers start in training until first success.
  for (let i = 0; i < createdAgents.length; i++) {
    const a = createdAgents[i];
    const id = a._id || a.id;
    if (!id) continue;
    await Agent.updateOne(
      { _id: id, user: userId },
      {
        $set: {
          lifecycleStatus: i === 0 ? "active" : "training",
          authorityLevel: i === 0 ? "external" : "internal",
        },
      }
    ).catch(() => {});
  }
  completeness.push("lifecycle");

  /** Map hire index → agent id */
  const agentIds = createdAgents.map((a) => String(a._id || a.id)).filter(Boolean);
  const managerId = agentIds[0] || null;

  /** Department parent goal + per-role goals with KPIs */
  const deptKpis =
    Array.isArray(body.kpis) && body.kpis.length
      ? body.kpis.slice(0, 5).map((k) => ({
          name: String(k.name || "KPI").slice(0, 80),
          target: k.target != null ? Number(k.target) : null,
          current: 0,
          unit: String(k.unit || "").slice(0, 40),
        }))
      : [{ name: "Tasks completed", target: 10, current: 0, unit: "runs" }];

  let parentGoal = null;
  if (managerId) {
    parentGoal = await Goal.create({
      user: userId,
      agent: managerId,
      title: `${departmentName} · outcomes`,
      description: `Parent goal for ${departmentName}`,
      instructions: `Coordinate the ${departmentName} team. Escalate blockers. Report KPI progress.`,
      successCriteria: "Department KPIs trending toward target; no unescalated failures.",
      status: "active",
      priority: "high",
      kpis: deptKpis,
      autonomy: { enabled: true },
    });
    completeness.push("parent_goal");
  }

  /** @type {object[]} */
  const roleGoals = [];
  for (let i = 0; i < Math.min(roles.length, agentIds.length); i++) {
    const r = roles[i];
    const title = String(r.title || `Role ${i + 1}`);
    const g = await Goal.create({
      user: userId,
      agent: agentIds[i],
      parentGoal: parentGoal?._id || null,
      title: `${title} · standing goal`,
      description: String(r.responsibilities || "").slice(0, 2000),
      instructions: String(r.architectPrompt || r.responsibilities || title).slice(0, 8000),
      successCriteria: String(r.successCriteria || `Reliable delivery for ${title}`).slice(0, 1000),
      status: "active",
      priority: "normal",
      kpis: [
        {
          name: "Successful runs",
          target: 5,
          current: 0,
          unit: "runs",
        },
      ],
      autonomy: { enabled: i > 0 },
    });
    roleGoals.push(g);
  }
  if (roleGoals.length) completeness.push("role_goals");

  /** Draft skills per role */
  /** @type {object[]} */
  const skills = [];
  for (let i = 0; i < Math.min(roles.length, agentIds.length); i++) {
    const r = roles[i];
    const title = String(r.title || `Role ${i + 1}`);
    const baseSlug = `${slugify(departmentName)}-${slugify(title)}`;
    let slug = baseSlug;
    let n = 0;
    while (await Skill.exists({ user: userId, slug })) {
      n += 1;
      slug = `${baseSlug}-${n}`;
    }
    const skill = await Skill.create({
      user: userId,
      agent: agentIds[i],
      name: `${title} playbook`,
      slug,
      description: String(r.responsibilities || title).slice(0, 500),
      playbookMd: [
        `# ${title}`,
        "",
        "## When to use",
        String(r.responsibilities || title),
        "",
        "## Procedure",
        String(r.architectPrompt || r.responsibilities || "Follow standing instructions.").slice(0, 4000),
        "",
        "## Verification",
        String(r.successCriteria || "Task completes without error."),
      ].join("\n"),
      status: "draft",
      triggers: [title.toLowerCase()],
      executionMode: "hints",
    });
    skills.push(skill);
  }
  if (skills.length) completeness.push("draft_skills");

  /** Escalation trigger on manager for agent.failed */
  let escalationTrigger = null;
  if (managerId) {
    escalationTrigger = await Trigger.create({
      user: userId,
      name: `${departmentName} · escalate failures`,
      type: "event",
      agent: managerId,
      enabled: true,
      config: { eventType: "agent.failed" },
      action: "enqueue_task",
      actionConfig: {
        instructions: `A team member failed. Diagnose, reassign or heal, and update the ${departmentName} parent goal.`,
        priority: "high",
      },
    }).catch(() => null);
    if (escalationTrigger) completeness.push("escalation_trigger");
  }

  /** Workflow stub linking department (draft environment) */
  let workflow = null;
  if (agentIds.length) {
    const agentKeyToId = {};
    agentIds.forEach((id, i) => {
      agentKeyToId[`hire_${i}`] = id;
    });
    workflow = await WorkflowDefinition.create({
      user: userId,
      name: `${departmentName} · core flow`,
      environment: "draft",
      version: 1,
      steps: agentIds.slice(0, 3).map((id, i) => ({
        id: `step_${i}`,
        kind: "agent_task",
        name: roles[i]?.title || `Step ${i + 1}`,
        agentId: id,
        agentKey: `hire_${i}`,
        goalTemplate: String(roles[i]?.responsibilities || "Execute department step.").slice(0, 2000),
      })),
      handoffs:
        agentIds.length > 1
          ? [
              {
                fromAgentKey: "hire_0",
                toAgentKey: "hire_1",
                onEvent: "agent.completed",
                condition: "",
                payloadMap: {},
              },
            ]
          : [],
      agentKeyToId,
      active: true,
      lastTestStatus: "unknown",
    });
    completeness.push("workflow_stub");
  }

  await recordDecision(userId, {
    actorType: "ceo",
    authorityLevel: "external",
    decision: `Hired complete department “${departmentName}” (${createdAgents.length} agents)`,
    rationale: body.rationale || "Department one-shot hire",
    context: {
      departmentName,
      agentIds,
      completeness,
      parentGoalId: parentGoal ? String(parentGoal._id) : null,
      workflowId: workflow ? String(workflow._id) : null,
    },
    outcome: "hired",
    approved: true,
  }).catch(() => {});

  return {
    ok: true,
    detail: `Created ${createdAgents.length} agent(s) for ${departmentName} with ${completeness.join(", ")}.`,
    created: {
      ...result.created,
      goals: roleGoals.map((g) => ({ _id: g._id, title: g.title })),
      parentGoal: parentGoal ? { _id: parentGoal._id, title: parentGoal.title } : null,
      skills: skills.map((s) => ({ _id: s._id, name: s.name, slug: s.slug })),
      trigger: escalationTrigger
        ? { _id: escalationTrigger._id, name: escalationTrigger.name }
        : null,
      workflow: workflow ? { _id: workflow._id, name: workflow.name } : null,
    },
    completeness,
  };
}
