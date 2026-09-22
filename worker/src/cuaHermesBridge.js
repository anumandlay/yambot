/**
 * @fileoverview Node bridge to the Hermes-style Python cua-driver MCP sidecar.
 * Purpose: When CUA is active, all capture/click/type/key/scroll go through Python
 * (same ownership model as Hermes). Non-CUA runs never touch this module.
 * Downstream: computerUse.js activate path; cuaCapture / cuaActions thin wrappers.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @returns {string}
 */
export function resolveHermesSidecarPath() {
  const fromEnv = String(process.env.YAMBOT_CUA_HERMES_SIDECAR || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(__dirname, "..", "cua_hermes", "sidecar.py"),
    "/app/cua_hermes/sidecar.py",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "";
}

/**
 * @returns {string}
 */
function resolvePythonBin() {
  const fromEnv = String(process.env.YAMBOT_CUA_PYTHON || "").trim();
  if (fromEnv) return fromEnv;
  return "python3";
}

/**
 * Creates a long-lived bridge to the Python Hermes CUA sidecar.
 */
export function createCuaHermesBridge() {
  /** @type {import('node:child_process').ChildProcess|null} */
  let proc = null;
  /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
  const pending = new Map();
  let buf = "";
  let started = false;

  function rejectAll(err) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  /**
   * @param {object} msg
   */
  function onMessage(msg) {
    const id = msg?.id;
    if (id == null) return;
    const p = pending.get(String(id));
    if (!p) return;
    pending.delete(String(id));
    clearTimeout(p.timer);
    p.resolve(msg);
  }

  /**
   * @param {string} chunk
   */
  function onStdout(chunk) {
    buf += chunk;
    while (buf.includes("\n")) {
      const nl = buf.indexOf("\n");
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
  }

  return {
    get started() {
      return started && Boolean(proc && proc.exitCode == null);
    },

    /**
     * Spawns Python sidecar and runs op:start (opens cua-driver mcp).
     * @returns {Promise<{ ok: boolean, error?: string, tools?: string[] }>}
     */
    async start() {
      if (this.started) {
        return { ok: true, already: true };
      }
      const script = resolveHermesSidecarPath();
      if (!script) {
        return { ok: false, error: "Hermes CUA sidecar.py not found" };
      }
      const py = resolvePythonBin();
      proc = spawn(py, ["-u", script], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ":99",
          PYTHONUNBUFFERED: "1",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
        },
      });
      proc.stdout?.setEncoding("utf8");
      proc.stderr?.setEncoding("utf8");
      proc.stdout?.on("data", onStdout);
      proc.stderr?.on("data", (chunk) => {
        const t = String(chunk || "").trim();
        if (t) console.warn("[cua-hermes]", t.slice(0, 400));
      });
      proc.on("exit", () => {
        started = false;
        rejectAll(new Error("Hermes CUA sidecar exited"));
        proc = null;
      });

      const boot = await this.call("start", {}, 45000);
      if (!boot?.ok) {
        await this.stop();
        return { ok: false, error: boot?.error || "sidecar start failed" };
      }
      started = true;
      return {
        ok: true,
        tools: boot.tools || [],
        bin: boot.bin,
        via: "hermes_python",
      };
    },

    /**
     * @param {string} op
     * @param {object} [args]
     * @param {number} [timeoutMs]
     */
    async call(op, args = {}, timeoutMs = 35000) {
      if (!proc || !proc.stdin || proc.exitCode != null) {
        return { ok: false, error: "Hermes CUA sidecar not running" };
      }
      const id = randomUUID();
      const payload = { id, op, ...(args || {}) };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, id, error: `sidecar timeout: ${op}` });
        }, Math.max(3000, timeoutMs));
        pending.set(id, { resolve, reject, timer });
        try {
          proc.stdin.write(`${JSON.stringify(payload)}\n`);
        } catch (err) {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ ok: false, error: String(err?.message || err) });
        }
      });
    },

    async stop() {
      if (proc && proc.exitCode == null) {
        try {
          await this.call("shutdown", {}, 5000);
        } catch {
          /* ignore */
        }
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      proc = null;
      started = false;
      rejectAll(new Error("stopped"));
    },
  };
}
