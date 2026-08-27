/**
 * @fileoverview Trigger evaluators — condition, threshold, anomaly types.
 * Purpose: Extend triggerEngine beyond time/event/change for richer automation.
 * Downstream: triggerEngine tickTriggers, scheduler.
 */

import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { Task } from "../models/Task.js";
import { MetricBaseline } from "../models/MetricBaseline.js";
import { fireTrigger } from "./triggerEngine.js";

/**
 * Evaluates condition triggers (metric expression in config).
 */
export async function tickConditionTriggers() {
  const triggers = await Trigger.find({ enabled: true, type: "condition" }).limit(50);
  let fired = 0;
  const now = Date.now();

  for (const trigger of triggers) {
    const intervalMin = Math.max(5, Number(trigger.config?.intervalMinutes) || 30);
    const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
    if (now - last < intervalMin * 60_000) continue;

    const metricKey = String(trigger.config?.metricKey || "").trim();
    const op = String(trigger.config?.operator || "gt").trim();
    const threshold = Number(trigger.config?.threshold);
    if (!metricKey || !Number.isFinite(threshold)) continue;

    const baseline = await MetricBaseline.findOne({
      user: trigger.user,
      metricKey,
    }).lean();
    const value = Number(baseline?.lastValue ?? trigger.config?.currentValue ?? 0);

    let match = false;
    if (op === "gt") match = value > threshold;
    else if (op === "gte") match = value >= threshold;
    else if (op === "lt") match = value < threshold;
    else if (op === "lte") match = value <= threshold;
    else if (op === "eq") match = value === threshold;

    if (match) {
      await fireTrigger(trigger, { event: { type: "condition.met", payload: { metricKey, value } } });
      fired += 1;
    }
  }
  return { fired, checked: triggers.length };
}

/**
 * Evaluates threshold triggers on goal KPI gaps.
 */
export async function tickThresholdTriggers() {
  const triggers = await Trigger.find({ enabled: true, type: "threshold" }).limit(50);
  let fired = 0;
  const now = Date.now();

  for (const trigger of triggers) {
    const intervalMin = Math.max(5, Number(trigger.config?.intervalMinutes) || 60);
    const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
    if (now - last < intervalMin * 60_000) continue;

    const goalId = trigger.config?.goalId || trigger.goal;
    if (!goalId) continue;
    const goal = await Goal.findOne({ _id: goalId, user: trigger.user }).lean();
    if (!goal) continue;

    const kpiName = String(trigger.config?.kpiName || "").trim();
    const kpi = (goal.kpis || []).find((k) => k.name === kpiName) || goal.kpis?.[0];
    if (!kpi || kpi.target == null) continue;

    const pct = kpi.target ? (Number(kpi.current) / Number(kpi.target)) * 100 : 0;
    const minPct = Number(trigger.config?.minPercent) || 0;
    const maxPct = Number(trigger.config?.maxPercent) || 100;

    if (pct < minPct || pct > maxPct) {
      await fireTrigger(trigger, {
        event: { type: "threshold.breached", payload: { kpiName: kpi.name, pct, current: kpi.current } },
      });
      fired += 1;
    }
  }
  return { fired, checked: triggers.length };
}

/**
 * Anomaly triggers — high task failure rate in rolling window.
 */
export async function tickAnomalyTriggers() {
  const triggers = await Trigger.find({ enabled: true, type: "anomaly" }).limit(30);
  let fired = 0;
  const since = new Date(Date.now() - 60 * 60 * 1000);

  for (const trigger of triggers) {
    const intervalMin = Math.max(15, Number(trigger.config?.intervalMinutes) || 60);
    const last = trigger.lastFiredAt ? new Date(trigger.lastFiredAt).getTime() : 0;
    if (Date.now() - last < intervalMin * 60_000) continue;

    const filter = {
      user: trigger.user,
      completedAt: { $gte: since },
    };
    if (trigger.agent) filter.agent = trigger.agent;

    const [failed, total] = await Promise.all([
      Task.countDocuments({ ...filter, status: "error" }),
      Task.countDocuments({ ...filter, status: { $in: ["done", "error"] } }),
    ]);
    if (total < 3) continue;

    const failRate = failed / total;
    const maxRate = Number(trigger.config?.maxFailRate) || 0.3;
    if (failRate >= maxRate) {
      await fireTrigger(trigger, {
        event: {
          type: "anomaly.detected",
          payload: { failRate, failed, total, windowMinutes: 60 },
        },
      });
      fired += 1;
    }
  }
  return { fired, checked: triggers.length };
}
