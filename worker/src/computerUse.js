/**
 * @fileoverview Per-run computer-use (CUA) mode — Hermes path via Python cua-driver MCP.
 * Purpose: When CUA is on, desktop capture/input matches Hermes (Python sidecar → cua-driver).
 * When CUA is off, this controller stays inactive and YamBot uses Playwright as before.
 * Downstream: agent.js runTask; cuaHermesBridge / Capture / Actions.
 */

import { ensureCuaDriverReady } from "./cuaDriver.js";
import { createCuaHermesBridge } from "./cuaHermesBridge.js";
import { createHermesCuaCapture } from "./cuaHermesCapture.js";
import { createHermesCuaActions } from "./cuaHermesActions.js";

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
  /** @type {ReturnType<typeof createCuaHermesBridge>|null} */
  let hermesBridge = null;
  /** @type {ReturnType<typeof createHermesCuaCapture>|null} */
  let captureApi = null;
  /** @type {ReturnType<typeof createHermesCuaActions>|null} */
  let actionsApi = null;
  /** @type {object|null} */
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
        hermesOk: Boolean(hermesBridge?.started),
        path: active ? "hermes_python" : "playwright",
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
     * Activates Hermes CUA: ensure driver binary, start Python MCP sidecar.
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
        if (!hermesBridge) hermesBridge = createCuaHermesBridge();
        const started = await hermesBridge.start();
        if (started.ok) {
          captureApi = createHermesCuaCapture(hermesBridge);
          actionsApi = createHermesCuaActions(hermesBridge);
          const resolved = await captureApi.resolveTarget().catch(() => ({ ok: false }));
          lastDriver = {
            ...lastDriver,
            ok: Boolean(lastDriver?.ok) || started.ok,
            hermes: true,
            tools: started.tools,
            target: resolved.ok ? resolved.sticky : null,
            targetError: resolved.ok ? undefined : resolved.error,
            path: "hermes_python",
          };
        } else {
          lastDriver = {
            ...lastDriver,
            hermes: false,
            hermesError: started.error,
            path: "hermes_python_failed",
          };
        }
      } catch (err) {
        lastDriver = {
          ...lastDriver,
          hermes: false,
          hermesError: String(err?.message || err),
        };
      }

      return {
        activated: !wasActive,
        driver: lastDriver,
        reason: activatedReason,
      };
    },

    async shutdown() {
      if (hermesBridge) {
        await hermesBridge.stop().catch(() => {});
        hermesBridge = null;
      }
      captureApi = null;
      actionsApi = null;
      lastCapture = null;
    },

    promptBlock() {
      if (!active) return "";
      return [
        "COMPUTER USE (CUA) MODE — Hermes path (Python → cua-driver MCP):",
        "- REQUIRED loop: read CUA CAPTURE elements, then computer_use { action:\"click\", element:N }.",
        "- Also: computer_use { action:\"type\", text:\"...\" }, { action:\"key\", keys:\"Enter\" }, { action:\"scroll\", direction:\"down\" }, { action:\"capture\", mode:\"som\" }.",
        "- Clicks/types go through cua-driver (same as Hermes). Do NOT use DOM click/type refs while CUA is active.",
        "- Typing is allowed. NEVER ask_user about CUA permission policy / text-entry authorization — click the field then computer_use type. If type fails, retry once after click; do NOT human_handoff for permission.",
        "- Coords: computer_use { action:\"click\", x, y } are screen/window coords for the driver (not Playwright CSS).",
        "- navigate / open_tab / finish / ask_user / extract / CRM / send_email still use the normal YamBot path.",
        activatedReason === "fallback_after_fails"
          ? `- Activated after ${CUA_ACTIVATE_AFTER_FAILS} failed Playwright locator attempts.`
          : "- Activated because the human asked for CUA (e.g. “using cua”).",
      ].join("\n");
    },
  };
}
