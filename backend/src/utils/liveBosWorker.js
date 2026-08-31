/**
 * @fileoverview LIVE_BOS worker helpers — start desired computer + claim path for browser proofs.
 * Purpose: Prefer real cloud claim (computer-manager); optional TEST_ONLY inline claim for local Mongo-only runs.
 * Downstream: liveBosScenarios scenarioRealBrowser, Lead-to-Customer ordeal.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";
import { containerNameForAgent } from "./workerAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Request computer-manager to boot this agent's Chromium box.
 * @param {import('mongoose').Document} agent
 */
export async function requestBrowserWorkerRunning(agent) {
  agent.computer = agent.computer || {};
  agent.computer.desired = "running";
  agent.computer.containerName = containerNameForAgent(agent._id);
  agent.active = true;
  await agent.save();
  return {
    desired: agent.computer.desired,
    containerName: agent.computer.containerName,
  };
}

/**
 * Same Mongo claim semantics as worker `/tasks/next` (LIVE_BOS TEST_ONLY fallback).
 * @param {string} userId
 * @param {string} agentId
 */
export async function inlineClaimPendingTask(userId, agentId) {
  return Task.findOneAndUpdate(
    { user: userId, agent: agentId, status: "pending" },
    {
      $set: {
        status: "running",
        claimedAt: new Date(),
        startedAt: new Date(),
      },
      $push: {
        events: {
          type: "claimed",
          payload: { claimAs: "live_bos_inline", agentId: String(agentId) },
          at: new Date(),
        },
      },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

/**
 * Try `docker kill` on the agent container (controlled crash).
 * @param {string} containerName
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function tryDockerKillContainer(containerName) {
  const name = String(containerName || "").trim();
  if (!name) return { ok: false, detail: "No container name" };
  return new Promise((resolve) => {
    const child = spawn("docker", ["kill", name], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => resolve({ ok: false, detail: e.message }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, detail: `docker kill ${name}` });
      else resolve({ ok: false, detail: err.trim() || `docker kill exit ${code}` });
    });
  });
}

/**
 * Wait until task leaves pending, or timeout.
 * @param {string} taskId
 * @param {number} waitMs
 */
export async function waitForTaskClaim(taskId, waitMs) {
  const deadline = Date.now() + waitMs;
  let task = await Task.findById(taskId);
  while (Date.now() < deadline) {
    task = await Task.findById(taskId);
    if (task && task.status !== "pending") break;
    const agent = task?.agent ? await Agent.findById(task.agent).select("computer").lean() : null;
    if (agent?.computer?.lastSeenAt) {
      const age = Date.now() - new Date(agent.computer.lastSeenAt).getTime();
      if (age < 60_000 && task?.status === "pending") {
        // Worker online but not claimed yet — keep waiting a bit
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return Task.findById(taskId);
}

/**
 * Repo-relative worker entry (optional spawn against a live API).
 */
export function workerEntryPath() {
  return path.resolve(__dirname, "../../../worker/src/index.js");
}
