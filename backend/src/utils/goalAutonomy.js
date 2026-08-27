/**
 * @fileoverview Goal autonomy — goal-directed work loop without human prompts.
 * Purpose: Periodically assess goals/KPIs and spawn assessment or execution tasks.
 * Downstream: scheduler tick.
 */

import { Goal, buildGoalRunText } from "../models/Goal.js";
import { Task } from "../models/Task.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";
import { recordMetricSample } from "./anomaly.js";
import { formatCompanyMemoryBlock } from "../models/CompanyMemory.js";

/**
 * @returns {Promise<{ checked: number, spawned: number }>}
 */
export async function tickGoalAutonomy() {
  const goals = await Goal.find({
    status: "active",
    "autonomy.enabled": true,
    agent: { $ne: null },
  }).limit(50);

  let spawned = 0;
  const now = Date.now();

  for (const goal of goals) {
    try {
      const intervalMin = Math.max(1, Number(goal.autonomy?.checkIntervalMinutes) || 60);
      const last = goal.autonomy?.lastCheckAt ? new Date(goal.autonomy.lastCheckAt).getTime() : 0;
      if (now - last < intervalMin * 60_000) continue;

      const agentId = String(goal.agent);
      const busy = await Task.countDocuments({
        user: goal.user,
        agent: agentId,
        status: { $in: ["pending", "running", "waiting_user", "blocked"] },
      });
      if (busy > 0) {
        goal.autonomy.lastCheckAt = new Date();
        await goal.save();
        continue;
      }

      const kpiGaps = (goal.kpis || []).filter(
        (k) => k.target != null && Number(k.current) < Number(k.target)
      );

      if (kpiGaps.length) {
        await recordMetricSample({
          userId: goal.user,
          metricKey: `goal.${goal._id}.kpi_gap`,
          value: kpiGaps.length,
          goalId: goal._id,
        });
        await emitEvent({
          userId: goal.user,
          type: "goal.kpi.gap",
          source: "goal",
          significance: "medium",
          agentId,
          goalId: goal._id,
          summary: `Goal "${goal.title}" has ${kpiGaps.length} KPI gap(s)`,
          payload: { gaps: kpiGaps },
        });
      }

      if (!goal.autonomy?.autoRun) {
        goal.autonomy.lastCheckAt = new Date();
        await goal.save();
        continue;
      }

      const companyMemory = await formatCompanyMemoryBlock(goal.user, 15);
      const assessment = [
        buildGoalRunText(goal),
        "",
        "AUTONOMOUS GOAL CHECK — you are operating without a human prompt.",
        "1) Measure current progress toward success criteria and KPIs.",
        "2) Identify the highest-value next work item.",
        "3) Execute that work or finish with a clear status report.",
        kpiGaps.length
          ? `KPI gaps: ${kpiGaps.map((k) => `${k.name} ${k.current}/${k.target}`).join("; ")}`
          : "",
        companyMemory ? `COMPANY MEMORY:\n${companyMemory}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const slaMinutes = Number(goal.sla?.responseMinutes) || 0;
      const slaDeadline =
        slaMinutes > 0 ? new Date(Date.now() + slaMinutes * 60_000) : null;

      await enqueueTask({
        userId: goal.user,
        agentId,
        goalText: assessment,
        goalRef: String(goal._id),
        priority: goal.priority || "normal",
        chatId: goal.chatId ? String(goal.chatId) : null,
        chatTitle: `Goal · ${goal.title}`.slice(0, 80),
        slaDeadline,
        slaName: goal.sla?.name || "",
        source: "goal_autonomy",
      });
      spawned += 1;
      goal.autonomy.lastCheckAt = new Date();
      await goal.save();
    } catch (err) {
      console.error(`[goalAutonomy] goal ${goal._id}:`, err?.message || err);
    }
  }

  return { checked: goals.length, spawned };
}
