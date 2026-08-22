/**
 * @fileoverview Internal HTTP API for Docker inventory + CPU/memory stats.
 * Purpose: Expose container list and processor metrics to the YamBot API (private network only).
 * Inputs: Docker socket via dockerode; Downstream: backend `/api/system/*` proxy.
 */

import http from "node:http";
import os from "node:os";

/**
 * CPU % of host capacity for one container (roughly 0–100).
 * @param {object} stats
 * @returns {number}
 */
export function cpuPercentOfHost(stats) {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) -
    (stats.precpu_stats?.system_cpu_usage || 0);
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  // Why: fraction of total host CPU time → percent 0–100 (can briefly exceed under load).
  return Math.max(0, (cpuDelta / systemDelta) * 100);
}

/**
 * @param {import('dockerode')} docker
 * @returns {Promise<object>}
 */
export async function collectSystemSnapshot(docker) {
  const info = await docker.info();
  const list = await docker.listContainers({ all: true });
  /** @type {object[]} */
  const containers = [];

  await Promise.all(
    list.map(async (c) => {
      const name = (c.Names?.[0] || "").replace(/^\//, "");
      let cpuPercent = 0;
      let memUsage = 0;
      let memLimit = 0;
      if (c.State === "running") {
        try {
          const stats = await docker.getContainer(c.Id).stats({ stream: false });
          cpuPercent = cpuPercentOfHost(stats);
          memUsage = Number(stats.memory_stats?.usage) || 0;
          memLimit = Number(stats.memory_stats?.limit) || 0;
        } catch {
          /* stats race while stopping */
        }
      }
      containers.push({
        id: String(c.Id || "").slice(0, 12),
        name,
        image: c.Image || "",
        state: c.State || "",
        status: c.Status || "",
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memUsage,
        memLimit,
        labels: c.Labels || {},
        created: c.Created || 0,
      });
    })
  );

  containers.sort((a, b) => a.name.localeCompare(b.name));

  const runningCpu = containers
    .filter((c) => c.state === "running")
    .reduce((s, c) => s + (c.cpuPercent || 0), 0);

  return {
    at: new Date().toISOString(),
    host: {
      name: info.Name || os.hostname(),
      cpus: info.NCPU || os.cpus().length,
      memTotal: info.MemTotal || os.totalmem(),
      containersRunning: info.ContainersRunning ?? 0,
      containersPaused: info.ContainersPaused ?? 0,
      containersStopped: info.ContainersStopped ?? 0,
      containersTotal: info.Containers ?? containers.length,
      /** Approximate host busy % from summed container CPU shares. */
      cpuPercent: Math.round(Math.min(100, runningCpu) * 10) / 10,
      loadavg: os.loadavg(),
      freemem: os.freemem(),
      totalmem: os.totalmem(),
    },
    containers,
  };
}

/**
 * Starts a loopback-style HTTP server on the Compose network (not published to the internet).
 * @param {{ docker: import('dockerode'), ensureStopped: Function, port?: number }} opts
 * @returns {http.Server}
 */
export function startInternalServer({ docker, ensureStopped, port = 4050 }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://computer-manager.local");
    res.setHeader("Content-Type", "application/json");

    try {
      if (req.method === "GET" && url.pathname === "/internal/health") {
        res.end(JSON.stringify({ ok: true, service: "yambot-computer-manager" }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/internal/system") {
        const snapshot = await collectSystemSnapshot(docker);
        res.end(JSON.stringify({ ok: true, ...snapshot }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/internal/stop") {
        let body = "";
        for await (const chunk of req) body += chunk;
        let parsed = {};
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, detail: "Invalid JSON" }));
          return;
        }
        const name = String(parsed.name || "").trim();
        if (!name) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, detail: "name required" }));
          return;
        }
        const removeVolume = Boolean(parsed.removeVolume);
        await ensureStopped(name, parsed.agentId ? String(parsed.agentId) : undefined, {
          removeVolume,
        });
        res.end(JSON.stringify({ ok: true, stopped: name, removeVolume }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, detail: "Not found" }));
    } catch (err) {
      console.error("[manager] http error", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, detail: String(err?.message || err) }));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[manager] internal HTTP on :${port}`);
  });
  return server;
}
