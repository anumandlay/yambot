/**
 * @fileoverview Personal VPS manager — isolated from YamBot product logic.
 * Purpose: Super-admin personal Linux containers on the YamBot VPS via Docker socket.
 * Inputs: MongoDB, Docker socket, internal HTTP on Compose network.
 * Downstream: YamBot API proxies `/api/admin/personal-vps/*` to this service.
 *
 * Env: MONGODB_URI, SETTINGS_CRYPTO_KEY, PERSONAL_VPS_SSH_HOST, PERSONAL_VPS_HTTP_PORT
 */

import http from "node:http";
import Docker from "dockerode";
import mongoose from "mongoose";
import { catalogPublic } from "./osCatalog.js";
import {
  createInstance,
  listInstances,
  stopInstance,
  startInstance,
  deleteInstance,
  revealPassword,
} from "./dockerOps.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://mongo:27017/yambot";
const CRYPTO_KEY = process.env.SETTINGS_CRYPTO_KEY || "dev-settings-crypto-key-change-me-32";
const SSH_HOST =
  process.env.PERSONAL_VPS_SSH_HOST ||
  process.env.PUBLIC_VPS_HOST ||
  "your-vps-hostname";
const PORT = Number(process.env.PERSONAL_VPS_HTTP_PORT) || 4060;

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body.trim()) return {};
  return JSON.parse(body);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} code
 * @param {object} payload
 */
function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

await mongoose.connect(MONGODB_URI);
console.log("[personal-vps] Mongo connected");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://personal-vps.local");

  try {
    if (req.method === "GET" && url.pathname === "/internal/health") {
      sendJson(res, 200, { ok: true, service: "personal-vps-manager" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/os-catalog") {
      sendJson(res, 200, { ok: true, catalog: catalogPublic(), sshHost: SSH_HOST });
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/instances") {
      const reveal = url.searchParams.get("revealPasswords") === "1";
      const instances = await listInstances(docker, CRYPTO_KEY, reveal);
      sendJson(res, 200, { ok: true, sshHost: SSH_HOST, instances });
      return;
    }

    if (req.method === "POST" && url.pathname === "/internal/instances") {
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim();
      const osId = String(body.osId || "").trim();
      const createdBy = String(body.createdBy || "").trim();
      if (!name || !osId || !createdBy) {
        sendJson(res, 400, { ok: false, detail: "name, osId, and createdBy are required" });
        return;
      }
      const instance = await createInstance(docker, {
        name,
        osId,
        createdBy,
        sshHost: SSH_HOST,
        cryptoKey: CRYPTO_KEY,
      });
      sendJson(res, 201, { ok: true, instance, sshHost: SSH_HOST });
      return;
    }

    const stopMatch = url.pathname.match(/^\/internal\/instances\/([^/]+)\/stop$/);
    if (req.method === "POST" && stopMatch) {
      const instance = await stopInstance(docker, stopMatch[1]);
      sendJson(res, 200, { ok: true, instance });
      return;
    }

    const startMatch = url.pathname.match(/^\/internal\/instances\/([^/]+)\/start$/);
    if (req.method === "POST" && startMatch) {
      const instance = await startInstance(docker, startMatch[1]);
      sendJson(res, 200, { ok: true, instance });
      return;
    }

    const pwMatch = url.pathname.match(/^\/internal\/instances\/([^/]+)\/password$/);
    if (req.method === "GET" && pwMatch) {
      const data = await revealPassword(docker, pwMatch[1], CRYPTO_KEY);
      sendJson(res, 200, data);
      return;
    }

    const deleteMatch = url.pathname.match(/^\/internal\/instances\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const data = await deleteInstance(docker, deleteMatch[1]);
      sendJson(res, 200, data);
      return;
    }

    sendJson(res, 404, { ok: false, detail: "Not found" });
  } catch (err) {
    console.error("[personal-vps] error", err);
    sendJson(res, 500, { ok: false, detail: String(err?.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[personal-vps] internal HTTP on :${PORT} (ssh host hint: ${SSH_HOST})`);
});
