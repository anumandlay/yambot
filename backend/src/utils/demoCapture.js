/**
 * @fileoverview Demo capture helpers — append steps during Take control sessions.
 * Purpose: Record human actions server-side (control queue + URL changes) for Skills demos.
 * Downstream: agents control route, worker heartbeat, demos start/finish.
 */

import { Demonstration } from "../models/Demonstration.js";

/**
 * Appends a step to the agent's active demonstration when recording.
 * @param {import('mongoose').Document} agent
 * @param {{ observation?: string, action?: object, result?: string }} step
 */
export async function appendDemoStepIfActive(agent, step) {
  const demoId = agent.computer?.activeDemoId;
  if (!demoId) return;
  const demo = await Demonstration.findOne({ _id: demoId, user: agent.user });
  if (!demo) return;
  demo.steps.push({
    observation: String(step.observation || ""),
    action: step.action || {},
    result: String(step.result || ""),
    at: new Date(),
  });
  await demo.save();
}

/**
 * Records a URL navigation during human control if it changed since last recorded URL step.
 * @param {import('mongoose').Document} agent
 * @param {string} pageUrl
 */
export async function recordDemoUrlChange(agent, pageUrl) {
  const url = String(pageUrl || "").trim();
  if (!url || !agent.computer?.activeDemoId) return;
  const demo = await Demonstration.findOne({ _id: agent.computer.activeDemoId, user: agent.user });
  if (!demo) return;
  const lastNav = [...(demo.steps || [])]
    .reverse()
    .find((s) => s.action?.type === "navigate" && s.action?.url);
  if (lastNav?.action?.url === url) return;
  demo.steps.push({
    observation: url,
    action: { type: "navigate", url },
    result: "url_change",
    at: new Date(),
  });
  await demo.save();
}
