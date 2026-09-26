/**
 * @fileoverview Computer-use (CUA / Jev Ultrafast) mode parsing for website agents.
 * Purpose: Detect explicit "using cua" / "using jev" in chat goals and strip the phrase
 * from the worker goal while recording computerUseMode on the Task.
 * Downstream: enqueueTask, chats routes; worker reads Task.computerUseMode.
 *
 * Why website agents stay on the Playwright Xvfb box (not full XFCE): CUA here means
 * cua-driver + screenshot/coordinate control of the same live Chrome session.
 * Jev Ultrafast means TypeSafe op+element on the same Chrome (Playwright observe/act).
 */

/** @typedef {"auto"|"cua"|"playwright"|"jev"} ComputerUseMode */

/**
 * Phrases that request CUA for the whole run.
 * @type {RegExp}
 */
const CUA_REQUEST_RE =
  /\b(?:using|with|via)\s+cua\b|\bcua\s+mode\b|(?:^|\s)\/cua(?=\s|$)/i;

/**
 * Phrases that request Jev Ultrafast browser runner.
 * @type {RegExp}
 */
const JEV_REQUEST_RE =
  /\b(?:using|with|via)\s+jev(?:\s+ultrafast)?\b|\bjev\s+mode\b|(?:^|\s)\/jev(?=\s|$)/i;

/**
 * Phrases that force Playwright-only (no auto fallback).
 * @type {RegExp}
 */
const PLAYWRIGHT_ONLY_RE = /\b(?:using|with)\s+playwright\b|\bno\s+cua\b|\bwithout\s+cua\b/i;

/**
 * @param {unknown} value
 * @returns {ComputerUseMode}
 */
export function normalizeComputerUseMode(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "cua" || v === "computer_use" || v === "computer-use") return "cua";
  if (v === "jev" || v === "jev-ultrafast" || v === "ultrafast") return "jev";
  if (v === "playwright" || v === "dom") return "playwright";
  return "auto";
}

/**
 * Parses goal/chat text for an explicit computer-use request.
 * @param {string} text
 * @returns {{
 *   mode: ComputerUseMode,
 *   cleanedGoal: string,
 *   requestedExplicitly: boolean,
 * }}
 */
export function parseComputerUseFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { mode: "auto", cleanedGoal: "", requestedExplicitly: false };
  }

  /** @type {ComputerUseMode} */
  let mode = "auto";
  // Why: jev and cua are mutually exclusive opt-ins; jev checked first when both appear.
  if (JEV_REQUEST_RE.test(raw)) {
    mode = "jev";
  } else if (CUA_REQUEST_RE.test(raw)) {
    mode = "cua";
  } else if (PLAYWRIGHT_ONLY_RE.test(raw)) {
    mode = "playwright";
  }

  const cleanedGoal = raw
    .replace(/\b(?:using|with|via)\s+jev(?:\s+ultrafast)?\b/gi, " ")
    .replace(/\bjev\s+mode\b/gi, " ")
    .replace(/(?:^|\s)\/jev(?=\s|$)/gi, " ")
    .replace(/\b(?:using|with|via)\s+cua\b/gi, " ")
    .replace(/\bcua\s+mode\b/gi, " ")
    .replace(/(?:^|\s)\/cua(?=\s|$)/gi, " ")
    .replace(/\b(?:using|with)\s+playwright\b/gi, " ")
    .replace(/\b(?:no|without)\s+cua\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();

  return {
    mode,
    cleanedGoal: cleanedGoal || raw,
    requestedExplicitly: mode === "cua" || mode === "jev",
  };
}
