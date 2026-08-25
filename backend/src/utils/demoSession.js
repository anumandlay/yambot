/**
 * @fileoverview Demonstration session lifecycle — start, step, finish.
 * Purpose: Shared logic for Take control demo recording (UI + worker routes).
 * Downstream: skills routes, worker routes, agents control session end.
 */

import { Agent } from "../models/Agent.js";
import { Demonstration } from "../models/Demonstration.js";
import { emitEvent } from "./eventBus.js";

/**
 * Starts a new demonstration capture on an agent.
 * @param {string} userId
 * @param {{ agentId: string, taskId?: string|null, title?: string }} opts
 * @returns {Promise<import('mongoose').Document>}
 */
export async function startDemoSession(userId, opts) {
  const agentId = String(opts.agentId || "").trim();
  const agent = await Agent.findOne({ _id: agentId, user: userId });
  if (!agent) {
    const err = new Error("Agent missing");
    err.status = 404;
    throw err;
  }
  const demo = await Demonstration.create({
    user: userId,
    agent: agentId,
    task: opts.taskId || null,
    title: String(opts.title || "Demonstration").trim(),
    steps: [],
  });
  agent.computer = agent.computer || {};
  agent.computer.activeDemoId = demo._id;
  await agent.save();
  return demo;
}

/**
 * Appends one step to an active demonstration.
 * @param {string} userId
 * @param {string} demoId
 * @param {{ observation?: string, action?: object, result?: string }} step
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function appendDemoSessionStep(userId, demoId, step) {
  const demo = await Demonstration.findOne({ _id: demoId, user: userId });
  if (!demo) return null;
  demo.steps.push({
    observation: String(step.observation || ""),
    action: step.action || {},
    result: String(step.result || ""),
    at: new Date(),
  });
  await demo.save();
  return demo;
}

/**
 * Finalizes a demonstration and emits demo.captured on the event bus.
 * @param {string} userId
 * @param {{ demoId: string, title?: string, emitBusEvent?: boolean }} opts
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function finishDemoSession(userId, opts) {
  const demoId = String(opts.demoId || "").trim();
  if (!demoId) return null;
  const demo = await Demonstration.findOne({ _id: demoId, user: userId });
  if (!demo) return null;
  if (opts.title) demo.title = String(opts.title).trim();
  const agent = await Agent.findOne({ _id: demo.agent, user: userId });
  const wasActive =
    agent?.computer?.activeDemoId &&
    String(agent.computer.activeDemoId) === String(demo._id);
  if (wasActive) {
    agent.computer.activeDemoId = null;
    await agent.save();
  }
  await demo.save();
  if (wasActive && opts.emitBusEvent !== false) {
    await emitEvent({
      userId,
      type: "demo.captured",
      source: "skills",
      summary: `Demonstration captured: ${demo.title}`,
      payload: { demonstrationId: String(demo._id), agentId: String(demo.agent) },
      agentId: demo.agent,
      taskId: demo.task || null,
      significance: "medium",
    });
  }
  return demo;
}

/**
 * Finishes the agent's active demo when human control ends (server-side safety net).
 * @param {import('mongoose').Document} agent
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function finishActiveDemoForAgent(agent) {
  const demoId = agent.computer?.activeDemoId;
  if (!demoId) return null;
  return finishDemoSession(String(agent.user), {
    demoId: String(demoId),
    emitBusEvent: true,
  });
}
