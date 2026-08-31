/**
 * @fileoverview Manager autonomy — managers notice work and delegate to managed agents.
 * Purpose: Autonomous workforce coordination without human clicking Delegate.
 * Downstream: scheduler tick, workforce delegation.
 */

import { Agent } from "../models/Agent.js";
import { Goal } from "../models/Goal.js";
import { Task } from "../models/Task.js";
import { CompanyEvent } from "../models/CompanyEvent.js";
import { enqueueTask } from "./enqueueTask.js";
import { emitEvent } from "./eventBus.js";

/**
 * @returns {Promise<{ managers: number, delegated: number }>}
 */
export async function tickManagerAutonomy() {
  const managers = await Agent.find({ role: "manager", active: { $ne: false } }).limit(20);
  let delegated = 0;

  for (const manager of managers) {
    try {
      const managed = (manager.managedAgents || []).map(String).filter(Boolean);
      if (!managed.length) continue;

      const recentEvents = await CompanyEvent.find({
        user: manager.user,
        createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        significance: { $in: ["medium", "high", "critical"] },
        type: { $in: ["goal.kpi.gap", "watcher.change", "anomaly.detected", "task.failed"] },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      if (!recentEvents.length) continue;

      const managerGoals = await Goal.find({
        user: manager.user,
        agent: manager._id,
        status: "active",
      }).limit(5);

      const parentGoal = managerGoals[0];
      if (!parentGoal) continue;

      for (const ev of recentEvents.slice(0, 3)) {
        // Why: without dedupe, every scheduler tick re-delegates the same events.
        const already = await CompanyEvent.exists({
          user: manager.user,
          type: "workforce.delegated",
          "payload.eventId": String(ev._id),
          createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        });
        if (already) continue;

        const workloads = await Task.aggregate([
          {
            $match: {
              user: manager.user,
              agent: { $in: managed },
              status: { $in: ["pending", "running", "waiting_user"] },
            },
          },
          { $group: { _id: "$agent", count: { $sum: 1 } } },
        ]);
        const loadMap = new Map(workloads.map((w) => [String(w._id), w.count]));
        const targetAgent = managed
          .slice()
          .sort((a, b) => (loadMap.get(a) || 0) - (loadMap.get(b) || 0))[0];

        const busy = await Task.countDocuments({
          user: manager.user,
          agent: targetAgent,
          status: { $in: ["pending", "running", "waiting_user"] },
        });
        if (busy > 2) continue;

        const child = await Goal.create({
          user: manager.user,
          agent: targetAgent,
          parentGoal: parentGoal._id,
          title: `Delegated: ${ev.summary || ev.type}`.slice(0, 200),
          description: parentGoal.description,
          instructions: `Handle event: ${ev.type}\n${ev.summary || ""}\nDetails: ${JSON.stringify(ev.payload || {}).slice(0, 500)}`,
          successCriteria: parentGoal.successCriteria,
          priority: "high",
          status: "active",
        });

        await enqueueTask({
          userId: manager.user,
          agentId: targetAgent,
          goalText: child.instructions,
          goalRef: String(child._id),
          priority: "high",
          source: "manager_autonomy",
          chatTitle: `Delegated · ${child.title}`.slice(0, 80),
        });

        await emitEvent({
          userId: manager.user,
          type: "workforce.delegated",
          source: "agent",
          agentId: manager._id,
          goalId: String(child._id),
          summary: `Manager "${manager.name}" delegated work to agent ${targetAgent}`,
          payload: { eventId: String(ev._id), childGoalId: String(child._id) },
        });

        delegated += 1;
      }
    } catch (err) {
      console.error(`[managerAutonomy] manager ${manager._id}:`, err?.message || err);
    }
  }

  return { managers: managers.length, delegated };
}
