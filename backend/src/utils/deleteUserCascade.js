/**
 * @fileoverview Cascade-delete a tenant user and all owned data (super-admin).
 * Purpose: Remove a registered account plus agents, chats, tasks, and company artifacts.
 * Downstream: DELETE /api/admin/users/:userId
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { Goal } from "../models/Goal.js";
import { Trigger } from "../models/Trigger.js";
import { Watcher } from "../models/Watcher.js";
import { Skill } from "../models/Skill.js";
import { Demonstration } from "../models/Demonstration.js";
import { TrainingRequest } from "../models/TrainingRequest.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { SiteProfile } from "../models/SiteProfile.js";
import { WalletTransaction } from "../models/WalletTransaction.js";
import { Approval } from "../models/Approval.js";
import { Entity } from "../models/Entity.js";
import { EntityGroup } from "../models/EntityGroup.js";
import { WorkflowDefinition, WorkflowRun } from "../models/WorkflowDefinition.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { CompanyEvent } from "../models/CompanyEvent.js";
import { DecisionJournal } from "../models/DecisionJournal.js";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import { BusinessTemplate } from "../models/BusinessTemplate.js";
import { Campaign, Enrollment } from "../models/Campaign.js";
import { Ticket } from "../models/Ticket.js";
import { Deal } from "../models/Deal.js";
import { Invoice } from "../models/Invoice.js";
import { DocumentFile } from "../models/DocumentFile.js";
import { EmailMessage } from "../models/EmailMessage.js";
import { Team } from "../models/Team.js";
import { ProcessDefinition, ProcessInstance } from "../models/Process.js";
import { AuditEvent } from "../models/AuditEvent.js";
import { MetricBaseline } from "../models/MetricBaseline.js";
import { PerformanceReview } from "../models/PerformanceReview.js";
import { AgentMessage } from "../models/AgentMessage.js";

/**
 * Asks computer-manager to stop one agent box (best-effort).
 * @param {object} agent
 * @returns {Promise<string|null>} container name stopped, if any
 */
async function stopAgentComputer(agent) {
  const containerName = agent?.computer?.containerName || "";
  if (!containerName) return null;
  try {
    const managerUrl = (
      process.env.COMPUTER_MANAGER_URL || "http://computer-manager:4050"
    ).replace(/\/$/, "");
    await fetch(`${managerUrl}/internal/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: containerName,
        agentId: String(agent._id),
        removeVolume: true,
      }),
    });
    return containerName;
  } catch (err) {
    console.warn(
      "[deleteUserCascade] stop container failed",
      containerName,
      err?.message || err
    );
    return containerName;
  }
}

/**
 * Deletes one user and all tenant-owned documents.
 * Why: Message has no user field — delete via chat ids. Enrollment via campaign ids.
 * @param {string} userId
 * @param {{ actorUserId?: string }} [opts]
 * @returns {Promise<{
 *   ok: true,
 *   userId: string,
 *   email: string,
 *   deletedAgents: number,
 *   deletedChats: number,
 *   stoppedContainers: string[],
 *   counts: Record<string, number>,
 * }>}
 */
export async function deleteUserCascade(userId, opts = {}) {
  const id = String(userId || "").trim();
  if (!id) {
    const err = new Error("userId required");
    err.status = 400;
    throw err;
  }

  const user = await User.findById(id);
  if (!user) {
    const err = new Error("User missing");
    err.status = 404;
    err.title = "Not found";
    throw err;
  }

  if (opts.actorUserId && String(opts.actorUserId) === id) {
    const err = new Error("You cannot delete your own super-admin account.");
    err.status = 400;
    err.title = "Cannot delete self";
    err.hint = "Sign in as a different super-admin, or create another admin first.";
    throw err;
  }

  const agents = await Agent.find({ user: id }).select("_id computer").lean();
  const stoppedContainers = [];
  for (const agent of agents) {
    // Mark stopped so manager loops do not restart during cascade.
    await Agent.updateOne(
      { _id: agent._id },
      { $set: { "computer.desired": "stopped", active: false } }
    ).catch(() => {});
    const name = await stopAgentComputer(agent);
    if (name) stoppedContainers.push(name);
  }

  const agentIds = agents.map((a) => a._id);
  const chatIds = await Chat.find({ user: id }).distinct("_id");

  /** @type {Record<string, number>} */
  const counts = {};

  /**
   * @param {string} key
   * @param {Promise<{ deletedCount?: number }>} promise
   */
  async function track(key, promise) {
    const result = await promise;
    counts[key] = result?.deletedCount || 0;
  }

  await track("messages", Message.deleteMany({ chat: { $in: chatIds } }));
  await track("enrollments", Enrollment.deleteMany({ user: id }));
  await track("workflowRuns", WorkflowRun.deleteMany({ user: id }));
  await track("processInstances", ProcessInstance.deleteMany({ user: id }));

  await Promise.all([
    track("tasks", Task.deleteMany({ user: id })),
    track("chats", Chat.deleteMany({ user: id })),
    track("agents", Agent.deleteMany({ user: id })),
    track("goals", Goal.deleteMany({ user: id })),
    track("triggers", Trigger.deleteMany({ user: id })),
    track("watchers", Watcher.deleteMany({ user: id })),
    track("skills", Skill.deleteMany({ user: id })),
    track("demonstrations", Demonstration.deleteMany({ user: id })),
    track("trainingRequests", TrainingRequest.deleteMany({ user: id })),
    track("llmProfiles", LlmProfile.deleteMany({ user: id })),
    track("siteProfiles", SiteProfile.deleteMany({ user: id })),
    track("walletTransactions", WalletTransaction.deleteMany({ user: id })),
    track("approvals", Approval.deleteMany({ user: id })),
    track("entities", Entity.deleteMany({ user: id })),
    track("entityGroups", EntityGroup.deleteMany({ user: id })),
    track("workflowDefinitions", WorkflowDefinition.deleteMany({ user: id })),
    track("improvementProposals", ImprovementProposal.deleteMany({ user: id })),
    track("companyMemory", CompanyMemory.deleteMany({ user: id })),
    track("companyEvents", CompanyEvent.deleteMany({ user: id })),
    track("decisionJournal", DecisionJournal.deleteMany({ user: id })),
    track("businessBlueprints", BusinessBlueprint.deleteMany({ user: id })),
    track("businessTemplates", BusinessTemplate.deleteMany({ user: id })),
    track("campaigns", Campaign.deleteMany({ user: id })),
    track("tickets", Ticket.deleteMany({ user: id })),
    track("deals", Deal.deleteMany({ user: id })),
    track("invoices", Invoice.deleteMany({ user: id })),
    track("documents", DocumentFile.deleteMany({ user: id })),
    track("emailMessages", EmailMessage.deleteMany({ user: id })),
    track("teams", Team.deleteMany({ user: id })),
    track("processDefinitions", ProcessDefinition.deleteMany({ user: id })),
    track("auditEvents", AuditEvent.deleteMany({ user: id })),
    track("metricBaselines", MetricBaseline.deleteMany({ user: id })),
    track("performanceReviews", PerformanceReview.deleteMany({ user: id })),
    track("agentMessages", AgentMessage.deleteMany({ user: id })),
  ]);

  // Safety: remove any agent-scoped leftovers if user-scoped chat delete missed some.
  if (agentIds.length) {
    await Task.deleteMany({ agent: { $in: agentIds } }).catch(() => {});
    await Chat.deleteMany({ agent: { $in: agentIds } }).catch(() => {});
  }

  const email = user.email;
  await User.deleteOne({ _id: id });
  counts.users = 1;

  return {
    ok: true,
    userId: id,
    email,
    deletedAgents: agentIds.length,
    deletedChats: chatIds.length,
    stoppedContainers,
    counts,
  };
}
