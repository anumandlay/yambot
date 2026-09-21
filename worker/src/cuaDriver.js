/**
 * @fileoverview Best-effort cua-driver bootstrap on the live Playwright desktop.
 * Purpose: Install path detection + lazy `cua-driver serve` when CUA mode activates.
 * Downstream: computerUse.js activate(); entrypoint may also warm the binary.
 *
 * Why website agents: drive the same Xvfb DISPLAY as Chrome (not a separate XFCE box).
 * Action clicks still go through Playwright page.mouse so the CDP session stays coherent;
 * the driver is ready for desktop-state / future MCP tooling.
 */

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

/** @type {import('node:child_process').ChildProcess|null} */
let serveProc = null;
/** @type {Promise<object>|null} */
let readyPromise = null;

/**
 * Resolves the cua-driver binary path if present.
 * @returns {string}
 */
export function resolveCuaDriverBin() {
  const fromEnv = String(process.env.YAMBOT_CUA_DRIVER_BIN || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    "/usr/local/bin/cua-driver",
    "/root/.local/bin/cua-driver",
    `${process.env.HOME || ""}/.local/bin/cua-driver`,
    "cua-driver",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "cua-driver") return c;
    if (fs.existsSync(c)) return c;
  }
  return "";
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number|null }>}
 */
async function runDriver(bin, args, opts = {}) {
  const timeoutMs = Math.max(2000, Number(opts.timeoutMs) || 15000);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
      },
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      code: 0,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout || ""),
      stderr: String(err?.stderr || err?.message || err),
      code: typeof err?.code === "number" ? err.code : null,
    };
  }
}

/**
 * Starts `cua-driver serve` once per worker process (lazy).
 * @returns {Promise<{ ok: boolean, bin?: string, version?: string, serve?: boolean, error?: string }>}
 */
export async function ensureCuaDriverReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const bin = resolveCuaDriverBin();
    if (!bin) {
      return {
        ok: false,
        error: "cua-driver binary not found (rebuild worker image with installer)",
      };
    }

    const ver = await runDriver(bin, ["--version"], { timeoutMs: 8000 });
    const version = String(ver.stdout || ver.stderr || "")
      .trim()
      .slice(0, 120);
    if (!ver.ok && !version) {
      return { ok: false, bin, error: ver.stderr || "cua-driver --version failed" };
    }

    // Why: serve owns the Linux runtime; keep one long-lived process for this box.
    if (!serveProc || serveProc.killed || serveProc.exitCode != null) {
      serveProc = spawn(bin, ["serve"], {
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ":99",
          CUA_DRIVER_PERMISSION_MODE:
            process.env.CUA_DRIVER_PERMISSION_MODE || "standard",
        },
        stdio: ["ignore", "ignore", "ignore"],
        detached: false,
      });
      serveProc.on("error", () => {
        /* doctor / status will report */
      });
      // Brief settle so the first call is less likely to race a cold start.
      await new Promise((r) => setTimeout(r, 800));
    }

    return {
      ok: true,
      bin,
      version: version || "unknown",
      serve: true,
    };
  })();

  try {
    return await readyPromise;
  } catch (err) {
    readyPromise = null;
    return { ok: false, error: String(err?.message || err) };
  }
}
