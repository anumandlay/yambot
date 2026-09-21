/**
 * @fileoverview Per-run computer-use (CUA) mode — Hermes-parity via cua-driver MCP.
 * Purpose: Activate on “using cua” or after N Playwright failures; expose MCP capture/actions
 * and prompt contract (SOM → element click) while keeping YamBot as the orchestrator.
 * Downstream: agent.js runTask; cuaMcpSession / cuaCapture / cuaActions; xCursor for visible demo.
 */

import { ensureCuaDriverReady } from "./cuaDriver.js";
import { createCuaMcpSession } from "./cuaMcpSession.js";
import { createCuaCapture } from "./cuaCapture.js";
import { createCuaActions } from "./cuaActions.js";

/** Failures (after recovery) before auto-activating CUA. */
export const CUA_ACTIVATE_AFTER_FAILS = 2;

/**
 * @param {unknown} value
 * @returns {"auto"|"cua"|"playwright"}
 */
export function normalizeComputerUseMode(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "cua" || v === "computer_use" || v === "computer-use") return "cua";
  if (v === "playwright" || v === "dom") return "playwright";
  return "auto";
}

/**
 * Detects mid-run operator text that asks to switch to CUA.
 * @param {string} text
 * @returns {boolean}
 */
export function textRequestsCua(text) {
  return /\b(?:using|with|via)\s+cua\b|\bcua\s+mode\b|(?:^|\s)\/cua(?=\s|$)/i.test(
    String(text || "")
  );
}

/**
 * Creates a mutable controller for one task run.
 * @param {string} [initialMode]
 */
export function createComputerUseController(initialMode) {
  const configured = normalizeComputerUseMode(initialMode);
  let active = configured === "cua";
  let consecutiveFails = 0;
  let activatedReason = active ? "explicit" : "";
  /** @type {object|null} */
  let lastDriver = null;
  /** @type {import('./cuaMcpSession.js').CuaMcpSession|null} */
  let mcpSession = null;
  /** @type {ReturnType<typeof createCuaCapture>|null} */
  let captureApi = null;
  /** @type {ReturnType<typeof createCuaActions>|null} */
  let actionsApi = null;
  /** @type {import('./cuaCapture.js').CuaCaptureResult|null} */
  let lastCapture = null;

  return {
    isActive() {
      return active;
    },
    getMode() {
      return active ? "cua" : configured;
    },
    getState() {
      return {
        configured,
        active,
        consecutiveFails,
        activatedReason,
        driverOk: Boolean(lastDriver?.ok),
        mcpOk: Boolean(mcpSession?.started),
        sticky: captureApi?.getSticky?.() || null,
      };
    },
    getCaptureApi() {
      return captureApi;
    },
    getActionsApi() {
      return actionsApi;
    },
    getLastCapture() {
      return lastCapture;
    },
    setLastCapture(cap) {
      lastCapture = cap;
    },

    noteRecoverableFailure() {
      if (active || configured === "playwright") {
        return { activated: false, fails: consecutiveFails };
      }
      consecutiveFails += 1;
      if (consecutiveFails >= CUA_ACTIVATE_AFTER_FAILS) {
        active = true;
        activatedReason = "fallback_after_fails";
        return {
          activated: true,
          fails: consecutiveFails,
          reason: activatedReason,
        };
      }
      return { activated: false, fails: consecutiveFails };
    },
    noteSuccess() {
      consecutiveFails = 0;
    },

    /**
     * Activates CUA: ensure driver, open MCP, resolve Chrome window.
     * @param {string} [reason]
     */
    async activate(reason = "manual") {
      const wasActive = active;
      active = true;
      activatedReason = reason || activatedReason || "manual";
      try {
        lastDriver = await ensureCuaDriverReady();
      } catch (err) {
        lastDriver = { ok: false, error: String(err?.message || err) };
      }

      try {
        if (!mcpSession) mcpSession = createCuaMcpSession();
        const started = await mcpSession.start();
        if (started.ok) {
          captureApi = createCuaCapture(mcpSession);
          actionsApi = createCuaActions(mcpSession, captureApi);
          const resolved = await captureApi.resolveTarget();
          lastDriver = {
            ...lastDriver,
            ok: Boolean(lastDriver?.ok) || started.ok,
            mcp: true,
            tools: started.tools,
            target: resolved.ok ? resolved.sticky : null,
            targetError: resolved.ok ? undefined : resolved.error,
          };
        } else {
          lastDriver = {
            ...lastDriver,
            mcp: false,
            mcpError: started.error,
          };
        }
      } catch (err) {
        lastDriver = {
          ...lastDriver,
          mcp: false,
          mcpError: String(err?.message || err),
        };
      }

      return {
        activated: !wasActive,
        driver: lastDriver,
        reason: activatedReason,
      };
    },

    async shutdown() {
      if (mcpSession) {
        await mcpSession.stop().catch(() => {});
        mcpSession = null;
      }
      captureApi = null;
      actionsApi = null;
      lastCapture = null;
    },

    promptBlock() {
      if (!active) return "";
      return [
        "COMPUTER USE (CUA) MODE — Hermes-parity via cua-driver MCP:",
        "- REQUIRED loop: read CUA CAPTURE elements, then computer_use { action:\"click\", element:N } (preferred).",
        "- Coords: computer_use { action:\"click\", x, y } uses Playwright viewport CSS from the attached screenshot (not AT-SPI desktop pixels).",
        "- Also: computer_use { action:\"type\", text:\"...\" }, { action:\"key\", keys:\"Enter\" }, { action:\"scroll\", direction:\"down\" }, { action:\"capture\", mode:\"som\" }.",
        "- Do NOT use DOM click/type refs while CUA is active unless computer_use failed — prefer element indices from the capture list.",
        "- navigate / open_tab / finish / ask_user / extract / CRM tools still use the normal YamBot path.",
        "- The live screen shows an X cursor glide after clicks (YamBot demo overlay).",
        activatedReason === "fallback_after_fails"
          ? `- Activated after ${CUA_ACTIVATE_AFTER_FAILS} failed Playwright locator attempts.`
          : "- Activated because the human asked for CUA (e.g. “using cua”).",
      ].join("\n");
    },
  };
}
