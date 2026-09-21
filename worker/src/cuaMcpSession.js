/**
 * @fileoverview Minimal MCP stdio client for cua-driver (Hermes-parity).
 * Purpose: Spawn `cua-driver mcp`, JSON-RPC tools/call, with `cua-driver call` CLI fallback.
 * Downstream: cuaCapture.js / cuaActions.js / computerUse.js activate path.
 *
 * Why: Hermes uses the Python MCP SDK; YamBot stays Node. cua-driver 0.28.x speaks
 * newline-delimited JSON-RPC on stdio (not Content-Length framing) — verified on live boxes.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveCuaDriverBin, runCuaDriverCall } from "./cuaDriver.js";

/**
 * @typedef {{
 *   ok: boolean,
 *   data?: unknown,
 *   structuredContent?: object,
 *   images?: string[],
 *   isError?: boolean,
 *   raw?: object,
 *   via?: "mcp"|"cli",
 *   error?: string,
 * }} CuaToolResult
 */

/**
 * Parses MCP stdout: prefers NDJSON lines; also accepts Content-Length frames.
 */
class McpFramer {
  constructor() {
    this.buf = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {object[]}
   */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    /** @type {object[]} */
    const out = [];

    // Content-Length framed (standard MCP) — only if buffer starts with that header.
    while (this.buf.length) {
      const asText = this.buf.toString("utf8");
      if (/^\s*Content-Length:/i.test(asText)) {
        const headerEnd = this.buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = this.buf.slice(0, headerEnd).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          this.buf = this.buf.slice(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const start = headerEnd + 4;
        if (this.buf.length < start + len) break;
        const body = this.buf.slice(start, start + len).toString("utf8");
        this.buf = this.buf.slice(start + len);
        try {
          out.push(JSON.parse(body));
        } catch {
          /* skip */
        }
        continue;
      }

      // NDJSON (cua-driver 0.28.x)
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) break;
      const line = this.buf.slice(0, nl).toString("utf8").replace(/\r$/, "").trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip non-JSON noise */
      }
    }
    return out;
  }
}

/**
 * @returns {CuaMcpSession}
 */
export function createCuaMcpSession() {
  return new CuaMcpSession();
}

export class CuaMcpSession {
  constructor() {
    /** @type {import('node:child_process').ChildProcess|null} */
    this.proc = null;
    this.framer = new McpFramer();
    /** @type {Map<number|string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.nextId = 1;
    this.started = false;
    this.sessionId = "";
    /** @type {Set<string>} */
    this.toolNames = new Set();
  }

  /**
   * @param {object} msg
   */
  _write(msg) {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error("cua-driver MCP stdin closed");
    }
    // Why: cua-driver mcp expects one JSON object per line (NDJSON), not Content-Length.
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {number} [timeoutMs]
   * @returns {Promise<object>}
   */
  request(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cua-driver MCP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * @param {object} msg
   */
  _onMessage(msg) {
    if (msg.id == null) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(
        new Error(String(msg.error?.message || JSON.stringify(msg.error)))
      );
      return;
    }
    pending.resolve(msg.result);
  }

  /**
   * Opens stdio MCP to cua-driver.
   * @returns {Promise<{ ok: boolean, error?: string, tools?: string[] }>}
   */
  async start() {
    if (this.started && this.proc && !this.proc.killed) {
      return { ok: true, tools: [...this.toolNames] };
    }
    await this.stop().catch(() => {});

    const bin = resolveCuaDriverBin();
    if (!bin) {
      return { ok: false, error: "cua-driver binary not found" };
    }

    this.sessionId = `yambot-${randomUUID().slice(0, 8)}`;
    this.framer = new McpFramer();
    this.proc = spawn(bin, ["mcp"], {
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
        CUA_DRIVER_PERMISSION_MODE:
          process.env.CUA_DRIVER_PERMISSION_MODE || "standard",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.on("data", (chunk) => {
      for (const msg of this.framer.push(chunk)) {
        this._onMessage(msg);
      }
    });
    this.proc.stderr?.on("data", () => {
      /* AT-SPI / doctor noise */
    });
    this.proc.on("exit", () => {
      this.started = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("cua-driver MCP exited"));
      }
      this.pending.clear();
    });

    try {
      await this.request(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "yambot-worker", version: "1.0.0" },
        },
        20000
      );
      this._write({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });

      const listed = await this.request("tools/list", {}, 20000);
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];
      this.toolNames = new Set(
        tools.map((t) => t?.name).filter((n) => typeof n === "string")
      );

      // Why: mark started before start_session so callTool uses MCP, not CLI (CLI needs daemon).
      this.started = true;

      if (this.toolNames.has("start_session")) {
        await this.callTool("start_session", { session: this.sessionId }, 15000).catch(
          () => null
        );
      }

      return { ok: true, tools: [...this.toolNames] };
    } catch (err) {
      await this.stop().catch(() => {});
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.toolNames.has("end_session") && this.started) {
      await this.callTool("end_session", { session: this.sessionId }, 8000).catch(
        () => null
      );
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("cua-driver MCP stopped"));
    }
    this.pending.clear();
    this.started = false;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
  }

  /**
   * @param {string} name
   * @param {object} [args]
   * @param {number} [timeoutMs]
   * @returns {Promise<CuaToolResult>}
   */
  async callTool(name, args = {}, timeoutMs = 30000) {
    const payload = {
      ...args,
      ...(this.sessionId && !args.session ? { session: this.sessionId } : {}),
    };

    if (this.started && this.proc && !this.proc.killed) {
      try {
        const result = await this.request(
          "tools/call",
          { name, arguments: payload },
          timeoutMs
        );
        return normalizeMcpToolResult(result, "mcp");
      } catch (err) {
        const cli = await runCuaDriverCall(name, payload, { timeoutMs });
        if (cli.ok) return { ...cli, via: "cli" };
        return {
          ok: false,
          isError: true,
          error: String(err?.message || err),
          via: "mcp",
        };
      }
    }

    const cli = await runCuaDriverCall(name, payload, { timeoutMs });
    return { ...cli, via: "cli" };
  }
}

/**
 * @param {object} result
 * @param {"mcp"|"cli"} via
 * @returns {CuaToolResult}
 */
export function normalizeMcpToolResult(result, via = "mcp") {
  if (!result || typeof result !== "object") {
    return { ok: false, isError: true, error: "empty MCP result", via };
  }
  const isError = result.isError === true;
  const content = Array.isArray(result.content) ? result.content : [];
  /** @type {string[]} */
  const images = [];
  let text = "";
  for (const block of content) {
    if (block?.type === "text" && block.text) text += String(block.text);
    if (block?.type === "image" && block.data) images.push(String(block.data));
  }
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : {};
  if (structured.screenshot_png_b64) {
    images.push(String(structured.screenshot_png_b64));
  }
  return {
    ok: !isError,
    isError,
    data: text || structured.tree_markdown || null,
    structuredContent: structured,
    images,
    raw: result,
    via,
  };
}
