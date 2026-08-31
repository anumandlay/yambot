/**
 * @fileoverview System overview API — Docker containers + processor stats for the dashboard.
 * Purpose: Proxy the computer-manager internal inventory (Docker sock stays off the public API).
 * Downstream: frontend `/system` page.
 */

import { Router } from "express";
import { Agent } from "../models/Agent.js";
import { User } from "../models/User.js";
import { env } from "../utils/env.js";
import { isSuperAdmin } from "../utils/superAdmin.js";

export const systemRouter = Router();

const MANAGER_URL = (process.env.COMPUTER_MANAGER_URL || env.COMPUTER_MANAGER_URL).replace(
  /\/$/,
  ""
);

/**
 * @param {string} name
 * @returns {boolean}
 */
function isAgentContainerName(name) {
  return /^yambot-agent-/i.test(String(name || ""));
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function managerFetch(path, init = {}) {
  const res = await fetch(`${MANAGER_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || `Manager HTTP ${res.status}`);
    err.status = res.status;
    err.title = "System manager error";
    err.detail = data?.detail || err.message;
    throw err;
  }
  return data;
}

/**
 * Tenant users see only cloud boxes for agents they own; superadmin sees the full VPS inventory.
 * Attaches Agent.computer.browserData so /system can show cookies/cache/downloads sizes.
 * @param {object} snapshot
 * @param {string} userId
 * @param {boolean} superAdmin
 * @returns {Promise<object>}
 */
async function scopeSystemOverview(snapshot, userId, superAdmin) {
  const agentQuery = superAdmin ? {} : { user: userId };
  const owned = await Agent.find(agentQuery)
    .select("_id name computer.containerName computer.browserData")
    .lean();
  const byId = new Map(owned.map((a) => [String(a._id), a]));
  const byName = new Map(
    owned
      .map((a) => [String(a.computer?.containerName || "").trim(), a])
      .filter(([name]) => Boolean(name))
  );

  /**
   * @param {object} c
   * @returns {object}
   */
  function enrichContainer(c) {
    const labelId = c.labels?.["yambot.agentId"] ? String(c.labels["yambot.agentId"]) : "";
    const agent =
      (labelId && byId.get(labelId)) || byName.get(String(c.name || "").trim()) || null;
    if (!agent) {
      return {
        ...c,
        agentId: labelId || null,
        agentName: null,
        browserData: null,
      };
    }
    return {
      ...c,
      agentId: String(agent._id),
      agentName: agent.name || "",
      browserData: agent.computer?.browserData || null,
    };
  }

  if (superAdmin) {
    return {
      ...snapshot,
      scope: "all",
      containers: (snapshot.containers || []).map(enrichContainer),
    };
  }

  const ownedIds = new Set(owned.map((a) => String(a._id)));
  const ownedNames = new Set(
    owned.map((a) => String(a.computer?.containerName || "").trim()).filter(Boolean)
  );

  const containers = (snapshot.containers || [])
    .filter((c) => {
      const name = String(c.name || "");
      if (!isAgentContainerName(name)) return false;
      const labelId = c.labels?.["yambot.agentId"];
      if (labelId && ownedIds.has(String(labelId))) return true;
      return ownedNames.has(name);
    })
    .map(enrichContainer);

  const running = containers.filter((c) => c.state === "running").length;
  const host = snapshot.host
    ? {
        ...snapshot.host,
        containersRunning: running,
        containersTotal: containers.length,
        containersStopped: Math.max(0, containers.length - running),
      }
    : snapshot.host;

  return {
    ...snapshot,
    host,
    containers,
    scope: "user",
  };
}

/**
 * @param {string} userId
 * @param {string} containerName
 * @param {string} [labelAgentId]
 * @returns {Promise<boolean>}
 */
async function userOwnsAgentContainer(userId, containerName, labelAgentId) {
  const filter = { user: userId };
  if (labelAgentId) {
    filter._id = labelAgentId;
  } else {
    filter["computer.containerName"] = containerName;
  }
  return Boolean(await Agent.exists(filter));
}

/**
 * GET /api/system/overview — host + containers with live CPU/memory (scoped by tenant).
 */
systemRouter.get("/overview", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("email role").lean();
    const data = await managerFetch("/internal/system");
    const scoped = await scopeSystemOverview(data, req.userId, isSuperAdmin(user));
    res.json(scoped);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/system/stop — force-stop/remove a container by name (ops).
 * Body: { name }
 */
systemRouter.post("/stop", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, title: "Name required", detail: "name is required" });
      return;
    }
    if (!isAgentContainerName(name)) {
      res.status(403).json({
        ok: false,
        title: "Forbidden",
        detail: "Only yambot-agent-* containers can be stopped from the dashboard.",
      });
      return;
    }

    const user = await User.findById(req.userId).select("email role").lean();
    if (!isSuperAdmin(user)) {
      const snapshot = await managerFetch("/internal/system");
      const row = (snapshot.containers || []).find((c) => c.name === name);
      const labelId = row?.labels?.["yambot.agentId"];
      const ok = await userOwnsAgentContainer(req.userId, name, labelId ? String(labelId) : "");
      if (!ok) {
        res.status(403).json({
          ok: false,
          title: "Forbidden",
          detail: "You can only stop containers for your own agents.",
        });
        return;
      }
    }

    const data = await managerFetch("/internal/stop", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/system/emergency-stop — stop all AI for this user (computers + schedules).
 */
systemRouter.post("/emergency-stop", async (req, res, next) => {
  try {
    const agents = await Agent.find({ user: req.userId });
    let stopped = 0;
    let schedulesPaused = 0;
    for (const agent of agents) {
      agent.computer = agent.computer || {};
      // Why: resume must restore prior desired — do not force every agent back to running.
      if (!agent.computer.desiredBeforeEmergency) {
        agent.computer.desiredBeforeEmergency =
          agent.computer.desired === "stopped" ? "stopped" : "running";
      }
      agent.computer.desired = "stopped";
      agent.schedule = agent.schedule || {};
      if (agent.schedule.enabled) {
        agent.schedule.enabledBeforeEmergency = true;
        agent.schedule.enabled = false;
        agent.schedule.pausedByEmergency = true;
        agent.schedule.nextRunAt = null;
        schedulesPaused += 1;
      } else if (agent.schedule.pausedByEmergency) {
        /* already paused */
      }
      await agent.save();
      stopped += 1;

      const name = String(agent.computer?.containerName || "").trim();
      if (name) {
        try {
          await managerFetch("/internal/stop", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
        } catch {
          /* manager may be down — desired=stopped still prevents restart */
        }
      }
    }

    // Why: cancel only pending (not claimed) tasks so workers finish current step safely.
    const { Task } = await import("../models/Task.js");
    const cancelResult = await Task.updateMany(
      { user: req.userId, status: "pending" },
      { $set: { status: "cancelled", lastError: "Emergency stop" } }
    );

    res.json({
      ok: true,
      stoppedAgents: stopped,
      schedulesPaused,
      pendingCancelled: cancelResult.modifiedCount || 0,
      detail: `Emergency stop: ${stopped} agent(s) set to stopped; ${schedulesPaused} schedule(s) paused.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/system/emergency-resume — restore computers + schedules paused by emergency stop.
 */
systemRouter.post("/emergency-resume", async (req, res, next) => {
  try {
    const agents = await Agent.find({ user: req.userId });
    let resumed = 0;
    let schedulesRestored = 0;
    for (const agent of agents) {
      if (agent.active === false) continue;
      agent.computer = agent.computer || {};
      const priorDesired = agent.computer.desiredBeforeEmergency;
      agent.computer.desired =
        priorDesired === "stopped" || priorDesired === "running"
          ? priorDesired
          : "running";
      agent.computer.desiredBeforeEmergency = "";
      agent.schedule = agent.schedule || {};
      if (agent.schedule.pausedByEmergency || agent.schedule.enabledBeforeEmergency) {
        if (agent.schedule.enabledBeforeEmergency) {
          agent.schedule.enabled = true;
          schedulesRestored += 1;
        }
        agent.schedule.pausedByEmergency = false;
        agent.schedule.enabledBeforeEmergency = false;
      }
      await agent.save();
      resumed += 1;
    }
    res.json({
      ok: true,
      resumedAgents: resumed,
      schedulesRestored,
      detail: `Emergency resume: ${resumed} agent(s) set to running; ${schedulesRestored} schedule(s) restored.`,
    });
  } catch (err) {
    next(err);
  }
});
