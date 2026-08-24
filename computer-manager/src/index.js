/**
 * @fileoverview YamBot computer-manager — auto-starts/stops per-agent Playwright containers.
 * Purpose: When an agent is created with runner=cloud, spin up its own Chromium box on the VPS.
 * Inputs: Mongo agents + Docker socket; Downstream: yambot-worker containers on the Compose network.
 *
 * Env: MONGODB_URI, SETTINGS_CRYPTO_KEY, DOCKER_NETWORK, WORKER_IMAGE,
 *      YAMBOT_API_BASE_URL, MANAGER_POLL_MS, WORKER_MEM_LIMIT
 */

import Docker from "dockerode";
import mongoose from "mongoose";
import { decryptSecret } from "./crypto.js";
import { startInternalServer } from "./httpApi.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://mongo:27017/yambot";
const SETTINGS_CRYPTO_KEY = process.env.SETTINGS_CRYPTO_KEY || "";
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || "deploy_default";
const WORKER_IMAGE = process.env.WORKER_IMAGE || "yambot-worker:local";
const API_BASE = (process.env.YAMBOT_API_BASE_URL || "http://api:4000").replace(/\/$/, "");
const POLL_MS = Math.max(5000, Number(process.env.MANAGER_POLL_MS) || 10000);
const MEM_LIMIT = Number(process.env.WORKER_MEM_LIMIT) || 3072 * 1024 * 1024;
const MANAGER_HTTP_PORT = Number(process.env.MANAGER_HTTP_PORT) || 4050;

const agentSchema = new mongoose.Schema(
  {
    name: String,
    active: Boolean,
    runner: String,
    workerTokenEnc: String,
    computer: {
      desired: String,
      containerName: String,
      containerId: String,
      provisionError: String,
      workerName: String,
    },
  },
  { collection: "agents", strict: false }
);

const Agent = mongoose.model("Agent", agentSchema);
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

/**
 * @param {string} agentId
 * @returns {string}
 */
function containerNameFor(agentId) {
  const id = String(agentId).replace(/[^a-zA-Z0-9]/g, "").slice(-16).toLowerCase();
  return `yambot-agent-${id || "box"}`;
}

/**
 * @param {string} name
 */
async function findContainerByName(name) {
  const list = await docker.listContainers({ all: true, filters: { name: [name] } });
  // Docker name filter is substring; match exact /name
  const hit = list.find((c) => (c.Names || []).some((n) => n === `/${name}` || n.endsWith(`/${name}`)));
  return hit ? docker.getContainer(hit.Id) : null;
}

/**
 * @param {import('mongoose').Document} agent
 */
async function ensureRunning(agent) {
  const agentId = String(agent._id);
  const name = agent.computer?.containerName || containerNameFor(agentId);
  const workerToken = decryptSecret(agent.workerTokenEnc || "", SETTINGS_CRYPTO_KEY);
  if (!workerToken) {
    await Agent.updateOne(
      { _id: agent._id },
      {
        $set: {
          "computer.containerName": name,
          "computer.provisionError": "Missing worker token — recreate the agent",
        },
      }
    );
    return;
  }

  let container = await findContainerByName(name);
  if (container) {
    try {
      const info = await container.inspect();
      const running = Boolean(info.State?.Running);
      const restarting = Boolean(info.State?.Restarting);
      const exitCode = info.State?.ExitCode;

      // Why: after rebuilding yambot-worker:local, old agent boxes keep stale code (JSON parse bugs, etc.).
      let imageStale = false;
      try {
        const want = await docker.getImage(WORKER_IMAGE).inspect();
        if (want?.Id && info.Image && want.Id !== info.Image) {
          imageStale = true;
        }
      } catch {
        /* ignore — create path will fail loudly if image missing */
      }

      if (running && !restarting && !imageStale) {
        await Agent.updateOne(
          { _id: agent._id },
          {
            $set: {
              "computer.containerName": name,
              "computer.containerId": info.Id,
              "computer.provisionError": "",
              "computer.workerName": name,
            },
          }
        );
        return;
      }
      if (imageStale) {
        console.warn(`[manager] ${name} on stale worker image; recreating`);
        await ensureStopped(name);
      } else if (!running && !restarting) {
        await container.start();
        const after = await container.inspect();
        await Agent.updateOne(
          { _id: agent._id },
          {
            $set: {
              "computer.containerName": name,
              "computer.containerId": after.Id,
              "computer.provisionError": "",
              "computer.workerName": name,
            },
          }
        );
        console.log(`[manager] started existing ${name}`);
        return;
      } else {
        // Restart loop (e.g. Playwright browser mismatch) → recreate with current image.
        console.warn(`[manager] ${name} unhealthy (restarting/exit=${exitCode}); recreating`);
        await ensureStopped(name);
      }
    } catch (err) {
      console.warn(`[manager] ${name} start failed (${err?.message || err}); recreating`);
      try {
        await ensureStopped(name);
      } catch {
        /* continue to create */
      }
    }
  }

  // Ensure image exists
  try {
    await docker.getImage(WORKER_IMAGE).inspect();
  } catch {
    throw new Error(`Worker image missing: ${WORKER_IMAGE}. Run: docker compose build worker-image`);
  }

  const volumeName = profileVolumeName(name);
  try {
    await docker.createVolume({ Name: volumeName });
  } catch (err) {
    if (!String(err?.message || err).includes("already exists")) {
      // ignore race; createContainer will fail loudly otherwise
      console.warn(`[manager] volume ${volumeName}:`, err?.message || err);
    }
  }

  const created = await docker.createContainer({
    Image: WORKER_IMAGE,
    name,
    Env: [
      `YAMBOT_API_BASE_URL=${API_BASE}`,
      `YAMBOT_AGENT_ID=${agentId}`,
      `YAMBOT_WORKER_TOKEN=${workerToken}`,
      `YAMBOT_WORKER_NAME=${name}`,
      "YAMBOT_PROFILE_DIR=/data/browser-profile",
      "YAMBOT_POLL_MS=5000",
      "YAMBOT_SCREEN_MS=1200",
      "YAMBOT_HEADED=1",
      "DISPLAY=:99",
      "YAMBOT_NOVNC_PORT=6080",
      "YAMBOT_VNC_PORT=5900",
    ],
    HostConfig: {
      NetworkMode: DOCKER_NETWORK,
      Binds: [`${volumeName}:/data/browser-profile`],
      Memory: MEM_LIMIT,
      // Why: Chromium + Xvfb need shared memory; default 64MB causes tab crashes.
      ShmSize: 1 * 1024 * 1024 * 1024,
      RestartPolicy: { Name: "unless-stopped" },
    },
    Labels: {
      "yambot.role": "agent-computer",
      "yambot.agentId": agentId,
    },
  });
  await created.start();
  const info = await created.inspect();
  await Agent.updateOne(
    { _id: agent._id },
    {
      $set: {
        "computer.containerName": name,
        "computer.containerId": info.Id,
        "computer.provisionError": "",
        "computer.workerName": name,
      },
    }
  );
  console.log(`[manager] provisioned ${name} for agent ${agentId}`);
}

/**
 * @param {string} containerName
 * @returns {string}
 */
function profileVolumeName(containerName) {
  return `yambot_profile_${containerName}`;
}

/**
 * @param {string} volumeName
 */
async function removeProfileVolume(volumeName) {
  try {
    const vol = docker.getVolume(volumeName);
    await vol.remove();
    console.log(`[manager] removed volume ${volumeName}`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/no such volume|not found|404/i.test(msg)) {
      console.warn(`[manager] volume remove ${volumeName}:`, msg);
    }
  }
}

/**
 * Profile volumes we must keep (any cloud agent still in Mongo, plus boxes being provisioned).
 * @param {object[]} wantRunning
 * @returns {Promise<Set<string>>}
 */
async function collectWantedProfileVolumes(wantRunning) {
  const agents = await Agent.find({
    "computer.containerName": { $nin: [null, ""] },
  })
    .select("computer.containerName")
    .lean();

  const wanted = new Set(
    agents.map((a) => profileVolumeName(a.computer.containerName))
  );
  for (const agent of wantRunning) {
    wanted.add(
      profileVolumeName(agent.computer?.containerName || containerNameFor(agent._id))
    );
  }
  return wanted;
}

/**
 * Deletes browser profile volumes left behind when agents were removed from Mongo.
 */
async function reconcileOrphanProfileVolumes(wantRunning) {
  let listed;
  try {
    listed = await docker.listVolumes();
  } catch (err) {
    console.warn("[manager] list volumes:", err?.message || err);
    return;
  }

  const wanted = await collectWantedProfileVolumes(wantRunning);
  const prefix = "yambot_profile_yambot-agent-";

  for (const v of listed.Volumes || []) {
    const name = v.Name || "";
    if (!name.startsWith(prefix) || wanted.has(name)) continue;
    await removeProfileVolume(name);
  }
}

/**
 * @param {string} name
 * @param {string} [agentId]
 * @param {{ removeVolume?: boolean }} [opts]
 */
async function ensureStopped(name, agentId, opts = {}) {
  const container = await findContainerByName(name);
  if (!container) {
    if (opts.removeVolume) {
      await removeProfileVolume(profileVolumeName(name));
    }
    if (agentId) {
      await Agent.updateOne(
        { _id: agentId },
        { $set: { "computer.containerId": "", "computer.provisionError": "" } }
      );
    }
    return;
  }
  try {
    const info = await container.inspect();
    if (info.State?.Running) await container.stop({ t: 10 });
  } catch {
    /* already stopped */
  }
  try {
    await container.remove({ force: true });
  } catch (err) {
    console.warn(`[manager] remove ${name}:`, err?.message || err);
  }
  if (opts.removeVolume) {
    await removeProfileVolume(profileVolumeName(name));
  }
  if (agentId) {
    await Agent.updateOne(
      { _id: agentId },
      { $set: { "computer.containerId": "", "computer.provisionError": "" } }
    );
  }
  console.log(`[manager] stopped ${name}`);
}

async function reconcile() {
  if (!SETTINGS_CRYPTO_KEY) {
    console.error("[manager] SETTINGS_CRYPTO_KEY missing");
    return;
  }

  const wantRunning = await Agent.find({
    active: { $ne: false },
    $or: [
      { "computer.desired": "running" },
      { "computer.desired": { $exists: false } },
      { "computer.desired": null },
    ],
  }).lean();

  for (const agent of wantRunning) {
    try {
      await ensureRunning(agent);
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 500);
      console.error(`[manager] provision failed ${agent._id}:`, msg);
      await Agent.updateOne(
        { _id: agent._id },
        { $set: { "computer.provisionError": msg } }
      );
    }
  }

  const wantStopped = await Agent.find({
    $or: [{ "computer.desired": "stopped" }, { active: false }],
    "computer.containerName": { $nin: [null, ""] },
  }).lean();

  for (const agent of wantStopped) {
    try {
      await ensureStopped(agent.computer.containerName, String(agent._id));
    } catch (err) {
      console.error(`[manager] stop failed ${agent._id}:`, err?.message || err);
    }
  }

  // Orphan containers labeled yambot but agent gone
  const labeled = await docker.listContainers({
    all: true,
    filters: { label: ["yambot.role=agent-computer"] },
  });
  const wantedNames = new Set(
    wantRunning.map((a) => a.computer?.containerName || containerNameFor(a._id))
  );
  for (const c of labeled) {
    const names = c.Names || [];
    const name = names[0]?.replace(/^\//, "") || "";
    if (name && !wantedNames.has(name)) {
      const agentId = c.Labels?.["yambot.agentId"];
      const stillWanted = agentId && wantRunning.some((a) => String(a._id) === agentId);
      if (!stillWanted) {
        try {
          const agentGone = !agentId || !(await Agent.exists({ _id: agentId }));
          await ensureStopped(name, agentId, { removeVolume: agentGone });
        } catch (err) {
          console.warn(`[manager] orphan cleanup ${name}:`, err?.message || err);
        }
      }
    }
  }

  await reconcileOrphanProfileVolumes(wantRunning);
}

async function main() {
  console.log(
    `[manager] starting — image=${WORKER_IMAGE} network=${DOCKER_NETWORK} api=${API_BASE}`
  );
  await mongoose.connect(MONGODB_URI);
  console.log("[manager] mongo connected");

  startInternalServer({ docker, ensureStopped, port: MANAGER_HTTP_PORT });

  const tick = async () => {
    try {
      await reconcile();
    } catch (err) {
      console.error("[manager] reconcile error", err);
    }
  };

  await tick();
  setInterval(() => void tick(), POLL_MS);
}

main().catch((err) => {
  console.error("[manager] fatal", err);
  process.exit(1);
});
