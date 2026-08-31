/**
 * @fileoverview Natural-language company audit — structural findings + optional LLM narrative.
 * Purpose: “Audit my business” for broken automations, duplicates, weak KPIs, cost, policy gaps.
 * Downstream: POST /api/ceo/audit-company, Command Center.
 */

import { Agent } from "../models/Agent.js";
import { Goal } from "../models/Goal.js";
import { Trigger } from "../models/Trigger.js";
import { Skill } from "../models/Skill.js";
import { Task } from "../models/Task.js";
import { WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { User } from "../models/User.js";
import { computeAgentReadiness } from "./agentReadiness.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { buildCapabilitiesCatalog, formatCapabilitiesForPrompt } from "./capabilitiesCatalog.js";
import { formatCompanyMemoryBlock } from "../models/CompanyMemory.js";

/**
 * Structural audit without LLM.
 * @param {string} userId
 */
export async function structuralCompanyAudit(userId) {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    agents,
    goals,
    triggers,
    skills,
    workflows,
    failedTasks,
    user,
  ] = await Promise.all([
    Agent.find({ user: userId }).lean(),
    Goal.find({ user: userId, status: "active" }).lean(),
    Trigger.find({ user: userId }).lean(),
    Skill.find({ user: userId }).lean(),
    WorkflowDefinition.find({ user: userId, active: true }).lean(),
    Task.find({ user: userId, status: "error", createdAt: { $gte: since7d } })
      .select("agent goal lastError")
      .limit(40)
      .lean(),
    User.findById(userId).select("settings").lean(),
  ]);

  /** @type {{ severity: string, category: string, title: string, detail: string, ref?: object }[]} */
  const findings = [];

  const nameCounts = new Map();
  for (const a of agents) {
    const key = String(a.name || "").trim().toLowerCase();
    if (!key) continue;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      findings.push({
        severity: "medium",
        category: "duplicate_agents",
        title: `Duplicate agent name “${name}” (${count})`,
        detail: "Consolidate or rename to avoid confusing handoffs and schedules.",
      });
    }
  }

  for (const a of agents) {
    if (a.active === false || a.lifecycleStatus === "retired") continue;
    const readiness = computeAgentReadiness(a, {});
    if (readiness.score < 50) {
      findings.push({
        severity: "high",
        category: "broken_automation",
        title: `Low readiness: ${a.name} (score ${readiness.score})`,
        detail: readiness.checks.filter((c) => !c.ok).map((c) => c.label).join("; "),
        ref: { agentId: String(a._id) },
      });
    }
    if (!a.schedule?.enabled) {
      const hasTrig = triggers.some((t) => String(t.agent) === String(a._id) && t.enabled !== false);
      if (!hasTrig && a.role !== "manager") {
        findings.push({
          severity: "medium",
          category: "idle_employee",
          title: `${a.name} has no schedule or trigger`,
          detail: "Employee only runs from chat — attach a schedule or event trigger.",
          ref: { agentId: String(a._id) },
        });
      }
    }
  }

  for (const t of triggers) {
    if (t.enabled === false) {
      findings.push({
        severity: "low",
        category: "stale_integration",
        title: `Disabled trigger “${t.name}”`,
        detail: "Re-enable or delete unused triggers.",
        ref: { triggerId: String(t._id) },
      });
    }
    if (t.type === "event" && !t.config?.eventType) {
      findings.push({
        severity: "high",
        category: "broken_automation",
        title: `Trigger “${t.name}” missing eventType`,
        detail: "Event triggers without eventType never fire.",
        ref: { triggerId: String(t._id) },
      });
    }
  }

  const draftSkills = skills.filter((s) => s.status === "draft");
  if (draftSkills.length) {
    findings.push({
      severity: "low",
      category: "unused_skills",
      title: `${draftSkills.length} draft skill(s) not promoted`,
      detail: draftSkills
        .slice(0, 5)
        .map((s) => s.name)
        .join(", "),
    });
  }
  const unusedSkills = skills.filter(
    (s) => s.status === "production" && (s.stats?.runs || 0) === 0
  );
  for (const s of unusedSkills.slice(0, 5)) {
    findings.push({
      severity: "low",
      category: "unused_skills",
      title: `Production skill “${s.name}” never used`,
      detail: "Deprecate or wire slash-invoke / triggers.",
      ref: { skillId: String(s._id) },
    });
  }

  for (const g of goals) {
    const kpis = g.kpis || [];
    if (!kpis.length) {
      findings.push({
        severity: "medium",
        category: "weak_kpi",
        title: `Goal “${g.title}” has no KPIs`,
        detail: "Add measurable KPIs so goal autonomy can detect gaps.",
        ref: { goalId: String(g._id) },
      });
    } else {
      for (const k of kpis) {
        if (k.target != null && Number(k.current) < Number(k.target) * 0.5) {
          findings.push({
            severity: "high",
            category: "weak_kpi",
            title: `KPI lagging: ${g.title} / ${k.name}`,
            detail: `Current ${k.current} vs target ${k.target} ${k.unit || ""}`,
            ref: { goalId: String(g._id) },
          });
        }
      }
    }
  }

  const failByAgent = new Map();
  for (const t of failedTasks) {
    const id = String(t.agent || "unknown");
    failByAgent.set(id, (failByAgent.get(id) || 0) + 1);
  }
  for (const [agentId, count] of failByAgent) {
    if (count >= 3) {
      const a = agents.find((x) => String(x._id) === agentId);
      findings.push({
        severity: "high",
        category: "broken_automation",
        title: `${count} failures in 7d — ${a?.name || agentId}`,
        detail: "Run Heal diagnose or CEO pulse recovery.",
        ref: { agentId },
      });
    }
  }

  for (const w of workflows) {
    if (w.environment === "canary") {
      findings.push({
        severity: "medium",
        category: "release",
        title: `Workflow “${w.name}” still in canary`,
        detail: "Monitor failure rate; promote to production or rollback to sandbox.",
        ref: { workflowId: String(w._id) },
      });
    }
    if (w.environment === "production" && w.lastTestStatus === "failed") {
      findings.push({
        severity: "high",
        category: "broken_automation",
        title: `Production workflow “${w.name}” last tests failed`,
        detail: "Rollback or re-run sandbox suite before more traffic.",
        ref: { workflowId: String(w._id) },
      });
    }
    if (w.environment === "draft" && (w.steps || []).length) {
      findings.push({
        severity: "low",
        category: "release",
        title: `Draft workflow “${w.name}” not promoted`,
        detail: "Run tests then promote sandbox → canary → production.",
        ref: { workflowId: String(w._id) },
      });
    }
  }

  const mode = user?.settings?.operatingMode || "assisted";
  const maxAuth = user?.settings?.maxAuthorityLevel || "external";
  if (mode === "autopilot" && maxAuth === "critical") {
    findings.push({
      severity: "medium",
      category: "policy_conflict",
      title: "Autopilot + critical authority",
      detail: "Highest autonomy with critical ceiling — confirm this is intentional.",
    });
  }
  if (mode === "observe" && failedTasks.length >= 5) {
    findings.push({
      severity: "medium",
      category: "policy_conflict",
      title: "Observe mode while failures accumulate",
      detail: "CEO loop cannot heal; raise operating mode or apply heal manually.",
    });
  }

  const recentCostTasks = await Task.find({
    user: userId,
    createdAt: { $gte: since7d },
    "llmUsage.estimatedUsd": { $gt: 0 },
  })
    .select("llmUsage.estimatedUsd")
    .limit(200)
    .lean();
  const spend = recentCostTasks.reduce((s, t) => s + (Number(t.llmUsage?.estimatedUsd) || 0), 0);
  const budget = Number(user?.settings?.monthlyBudgetUsd) || 0;
  if (budget > 0 && spend > budget * 0.35) {
    findings.push({
      severity: "high",
      category: "excessive_cost",
      title: `LLM spend ~$${spend.toFixed(2)} in 7d vs monthly budget $${budget}`,
      detail: "Run model cost optimizer or lower max steps / switch profiles.",
    });
  } else if (spend > 25) {
    findings.push({
      severity: "medium",
      category: "excessive_cost",
      title: `LLM spend ~$${spend.toFixed(2)} in last 7 days`,
      detail: "Consider cheaper profiles for routine workers.",
    });
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  return {
    ok: true,
    auditedAt: new Date().toISOString(),
    counts: {
      agents: agents.length,
      goals: goals.length,
      triggers: triggers.length,
      skills: skills.length,
      workflows: workflows.length,
      failedTasks7d: failedTasks.length,
      findings: findings.length,
    },
    findings,
    policy: { operatingMode: mode, maxAuthorityLevel: maxAuth },
  };
}

/**
 * Full NL company audit (structural + optional LLM executive summary).
 * @param {string} userId
 * @param {{ profileId?: string, withNarrative?: boolean }} [opts]
 */
export async function auditCompany(userId, opts = {}) {
  const structural = await structuralCompanyAudit(userId);
  if (!structural.ok) return structural;

  let narrative = "";
  if (opts.withNarrative !== false) {
    try {
      const userDoc = await User.findById(userId);
      const creds = userDoc ? await resolveLlmCredentials(userDoc, {}) : null;
      if (creds?.apiKey) {
        const catalog = await buildCapabilitiesCatalog(userId).catch(() => null);
        const capabilitiesText = catalog ? formatCapabilitiesForPrompt(catalog) : "";
        const memory = await formatCompanyMemoryBlock(userId).catch(() => "");
        const bullet = structural.findings
          .slice(0, 20)
          .map((f) => `- [${f.severity}/${f.category}] ${f.title}: ${f.detail}`)
          .join("\n");
        narrative = await llmChatCompletion({
          apiKey: creds.apiKey,
          baseUrl: creds.llmBaseUrl,
          model: creds.llmModel,
          openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
          temperature: 0.2,
          maxTokens: 1200,
          timeoutMs: 90_000,
          messages: [
            {
              role: "system",
              content:
                "You are a business operations auditor for YamBot. Write a concise executive audit (markdown): Health score 1-10, Top risks, Quick wins, What to ignore. No fluff.",
            },
            {
              role: "user",
              content: `COUNTS: ${JSON.stringify(structural.counts)}\nPOLICY: ${JSON.stringify(structural.policy)}\nFINDINGS:\n${bullet}\n\nCAPABILITIES:\n${capabilitiesText}\n\nMEMORY:\n${memory}`,
            },
          ],
        });
      } else {
        narrative = "(Configure an LLM profile in Settings to get a narrative executive summary.)";
      }
    } catch (err) {
      narrative = `(Narrative unavailable: ${err?.message || "LLM failed"})`;
    }
  }

  return {
    ...structural,
    narrative,
  };
}
