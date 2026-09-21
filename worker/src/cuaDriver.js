/**
 * @fileoverview cua-driver binary resolve, serve bootstrap, and CLI `call` fallback.
 * Purpose: Shared entry for MCP session + Hermes-style tool invocations on the live Xvfb box.
 * Downstream: cuaMcpSession.js, computerUse.js activate().
 */

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
export async function runDriver(bin, args, opts = {}) {
  const timeoutMs = Math.max(2000, Number(opts.timeoutMs) || 15000);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      },
      maxBuffer: 8 * 1024 * 1024,
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
 * Hermes CLI fallback: `cua-driver call <tool> '<json-args>'`.
 * @param {string} toolName
 * @param {object} [args]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<import('./cuaMcpSession.js').CuaToolResult>}
 */
export async function runCuaDriverCall(toolName, args = {}, opts = {}) {
  const bin = resolveCuaDriverBin();
  if (!bin) {
    return { ok: false, isError: true, error: "cua-driver binary not found", via: "cli" };
  }
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 30000);
  const jsonArgs = JSON.stringify(args || {});
  // Prefer writing args to a temp file when large (screenshots); small payloads inline.
  let runArgs = ["call", toolName, jsonArgs];
  let tmpFile = "";
  if (jsonArgs.length > 8000) {
    tmpFile = path.join(os.tmpdir(), `yambot-cua-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, jsonArgs, "utf8");
    runArgs = ["call", toolName, `--args-file=${tmpFile}`];
  }
  const res = await runDriver(bin, runArgs, { timeoutMs });
  if (tmpFile) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
  const blob = `${res.stdout}\n${res.stderr}`;
  if (/daemon is not running/i.test(blob)) {
    return {
      ok: false,
      isError: true,
      error: "cua-driver CLI needs machine daemon; use MCP transport instead",
      via: "cli",
    };
  }
  const start = Math.min(
    ...[blob.indexOf("{"), blob.indexOf("[")].filter((i) => i >= 0),
    Number.POSITIVE_INFINITY
  );
  if (!Number.isFinite(start) || start < 0) {
    return {
      ok: false,
      isError: true,
      error: res.stderr || res.stdout || "cua-driver call returned no JSON",
      via: "cli",
    };
  }
  try {
    const parsed = JSON.parse(blob.slice(start));
    const isError = parsed?.isError === true || parsed?.is_error === true || !res.ok;
    /** @type {string[]} */
    const images = [];
    if (parsed?.screenshot_png_b64) images.push(String(parsed.screenshot_png_b64));
    return {
      ok: !isError,
      isError,
      data: parsed?.tree_markdown || parsed?.message || null,
      structuredContent: parsed,
      images,
      raw: parsed,
      via: "cli",
    };
  } catch (err) {
    return {
      ok: false,
      isError: true,
      error: String(err?.message || err),
      via: "cli",
    };
  }
}

/**
 * Starts `cua-driver serve` once per worker process (lazy) — helps CLI fallback.
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

    if (!serveProc || serveProc.killed || serveProc.exitCode != null) {
      serveProc = spawn(bin, ["serve"], {
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ":99",
          CUA_DRIVER_PERMISSION_MODE:
            process.env.CUA_DRIVER_PERMISSION_MODE || "standard",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
        },
        stdio: ["ignore", "ignore", "ignore"],
        detached: false,
      });
      serveProc.on("error", () => {});
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
