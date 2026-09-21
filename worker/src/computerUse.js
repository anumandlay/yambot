/**
 * @fileoverview Per-run computer-use (CUA) mode controller for website agents.
 * Purpose: Start in CUA when the task asks for it, or activate after N failed
 * Playwright locator attempts; expose prompt blocks for screenshot/coordinate control.
 * Downstream: agent.js runTask loop; cuaDriver.js for optional host-driver bootstrap.
 *
 * Why: Same live Chrome session — CUA is a control strategy, not an XFCE container swap.
 */

import { ensureCuaDriverReady } from "./cuaDriver.js";

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
 * @returns {{
 *   isActive: () => boolean,
 *   getMode: () => string,
 *   getState: () => object,
 *   noteRecoverableFailure: () => { activated: boolean, fails: number, reason?: string },
 *   noteSuccess: () => void,
 *   activate: (reason?: string) => Promise<{ activated: boolean, driver?: object, reason: string }>,
 *   promptBlock: () => string,
 * }}
 */
export function createComputerUseController(initialMode) {
  const configured = normalizeComputerUseMode(initialMode);
  let active = configured === "cua";
  let consecutiveFails = 0;
  let activatedReason = active ? "explicit" : "";
  /** @type {object|null} */
  let lastDriver = null;

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
      };
    },
    /**
     * Call after a recoverable locator action fails recovery.
     * @returns {{ activated: boolean, fails: number, reason?: string }}
     */
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
     * Activates CUA and best-effort starts cua-driver on this display.
     * @param {string} [reason]
     * @returns {Promise<{ activated: boolean, driver?: object, reason: string }>}
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
      return {
        activated: !wasActive,
        driver: lastDriver,
        reason: activatedReason,
      };
    },
    /**
     * Extra system/user guidance while CUA is active.
     * @returns {string}
     */
    promptBlock() {
      if (!active) return "";
      return [
        "COMPUTER USE (CUA) MODE — active for this website session:",
        "- Prefer screenshot-grounded actions: click_at {x,y} (viewport CSS pixels) and type_at {x,y,text}.",
        "- DOM refs (click/type with ref) are still allowed when clearly correct, but if refs keep failing use click_at from the viewport screenshot.",
        "- Origin is top-left of the viewport; do not invent coordinates — read them from the attached screenshot layout.",
        "- Keep working in the same browser tab; do not ask for a different desktop/engine.",
        activatedReason === "fallback_after_fails"
          ? `- Activated after ${CUA_ACTIVATE_AFTER_FAILS} failed Playwright locator attempts.`
          : "- Activated because the human asked for CUA (e.g. “using cua”).",
      ].join("\n");
    },
  };
}
