/**
 * @fileoverview Bridge between Playwright pages and the YamBot Teach Recorder extension.
 * Purpose: start/stop recording and drain locator-rich steps into demonstrations.
 * Downstream: agent.js pushLiveScreen while activeDemoId is set.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the unpacked MV3 extension (Docker: /app/extension).
 * @returns {string}
 */
export function resolveExtensionDir() {
  const fromEnv = String(process.env.YAMBOT_TEACH_EXTENSION_DIR || "").trim();
  if (fromEnv && fs.existsSync(path.join(fromEnv, "manifest.json"))) return fromEnv;
  const candidates = [
    path.resolve(HERE, "../extension"),
    path.resolve(HERE, "../../extension"),
    "/app/extension",
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  }
  return candidates[0];
}

/**
 * Playwright Chrome args to load the teach extension (headed Chrome only).
 * @param {string} extensionDir
 * @returns {string[]}
 */
export function extensionLaunchArgs(extensionDir) {
  if (!extensionDir || !fs.existsSync(path.join(extensionDir, "manifest.json"))) return [];
  // Why: Chrome requires absolute paths for --load-extension.
  const abs = path.resolve(extensionDir);
  return [`--disable-extensions-except=${abs}`, `--load-extension=${abs}`];
}

/**
 * Same recorder as content.js — injected as init script so SPA navigations still get a bridge
 * even if the extension content script is slow on the first paint.
 */
export const TEACH_RECORDER_INIT_SCRIPT = `
(function () {
  if (window.__yambotTeachRecorderInstalled) return;
  window.__yambotTeachRecorderInstalled = true;
  var steps = [];
  var recording = false;
  var typeTimer = null;
  var pendingType = null;
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
      if (node && node.tagName === "BODY") { parts.unshift("body"); break; }
    }
    return parts.join(" > ");
  }
  function xpathOf(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return '//*[@id=' + JSON.stringify(el.id) + ']';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      var ix = 1;
      var sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) ix++; sib = sib.previousElementSibling; }
      parts.unshift(node.tagName.toLowerCase() + "[" + ix + "]");
      node = node.parentElement;
      if (node && node.tagName === "BODY") { parts.unshift("body"); break; }
    }
    return "/" + parts.join("/");
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return { tag: "", id: "", name: "", role: "", text: "", css: "", xpath: "" };
    var text = String(el.getAttribute("aria-label") || el.getAttribute("placeholder") || ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? "" : (el.innerText || el.textContent || "")) || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    var role = el.getAttribute("role") || (el.tagName === "INPUT" ? (el.getAttribute("type") || "textbox") : "") || el.tagName.toLowerCase();
    return { tag: el.tagName.toLowerCase(), id: el.id || "", name: el.getAttribute("name") || text || "", role: String(role), ariaLabel: el.getAttribute("aria-label") || "", placeholder: el.getAttribute("placeholder") || "", typeAttr: el.getAttribute("type") || "", text: text, css: cssPath(el), xpath: xpathOf(el), href: el.tagName === "A" ? String(el.href || "").slice(0, 300) : "" };
  }
  function actionable(el) {
    if (!el || el.nodeType !== 1) return null;
    return el.closest("a,button,input,select,textarea,summary,label,[role='button'],[role='link'],[role='option'],[role='menuitem'],[role='tab'],[contenteditable='true'],[onclick]") || el;
  }
  function flushPendingType() {
    if (!pendingType) return;
    steps.push(pendingType.step);
    pendingType = null;
    if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
  }
  function pushStep(step) {
    if (!recording) return;
    flushPendingType();
    steps.push(Object.assign({}, step, { url: String(location.href || ""), at: Date.now(), source: "init-script" }));
  }
  window.__yambotTeachRecorder = {
    start: function () { recording = true; steps = []; pendingType = null; return { ok: true }; },
    stop: function () { flushPendingType(); recording = false; return { ok: true, pending: steps.length }; },
    drain: function () { flushPendingType(); var out = steps.slice(); steps = []; return out; },
    isRecording: function () { return recording; },
    peekCount: function () { return steps.length + (pendingType ? 1 : 0); }
  };
  document.addEventListener("click", function (ev) {
    if (!recording) return;
    var d = describe(actionable(ev.target));
    pushStep(Object.assign({ type: "click" }, d));
  }, true);
  document.addEventListener("change", function (ev) {
    if (!recording) return;
    var el = ev.target;
    if (!el) return;
    var d = describe(el);
    if (el.tagName === "SELECT") pushStep(Object.assign({ type: "select", value: el.value }, d));
    else if ("value" in el) pushStep(Object.assign({ type: "type", text: String(el.value || "") }, d));
  }, true);
  document.addEventListener("input", function (ev) {
    if (!recording) return;
    var el = ev.target;
    if (!el || !("value" in el)) return;
    var d = describe(el);
    var step = Object.assign({ type: "type", text: String(el.value || ""), url: String(location.href || ""), at: Date.now(), source: "init-script" }, d);
    if (pendingType && pendingType.el === el) pendingType.step = step;
    else { flushPendingType(); pendingType = { el: el, step: step }; }
    if (typeTimer) clearTimeout(typeTimer);
    typeTimer = setTimeout(flushPendingType, 450);
  }, true);
  document.addEventListener("keydown", function (ev) {
    if (!recording) return;
    var special = ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (special.indexOf(ev.key) < 0) return;
    pushStep(Object.assign({ type: "key", key: ev.key }, describe(actionable(ev.target))));
  }, true);
})();
`;

/**
 * Ensures the recorder is present and optionally recording on a page (+ frames).
 * @param {import('playwright').Page} page
 * @param {boolean} shouldRecord
 */
export async function syncTeachRecorderOnPage(page, shouldRecord) {
  if (!page || page.isClosed()) return;
  const frames = page.frames();
  for (const frame of frames) {
    try {
      await frame.evaluate(
        ({ record, script }) => {
          if (!window.__yambotTeachRecorder) {
            // eslint-disable-next-line no-eval
            eval(script);
          }
          if (!window.__yambotTeachRecorder) return;
          if (record && !window.__yambotTeachRecorder.isRecording()) {
            window.__yambotTeachRecorder.start();
          } else if (!record && window.__yambotTeachRecorder.isRecording()) {
            window.__yambotTeachRecorder.stop();
          }
        },
        { record: shouldRecord, script: TEACH_RECORDER_INIT_SCRIPT }
      );
    } catch {
      /* cross-origin frame */
    }
  }
}

/**
 * Drains recorded steps from all frames.
 * @param {import('playwright').Page} page
 * @returns {Promise<object[]>}
 */
export async function drainTeachRecorderSteps(page) {
  if (!page || page.isClosed()) return [];
  /** @type {object[]} */
  const all = [];
  for (const frame of page.frames()) {
    try {
      const batch = await frame.evaluate(() => {
        if (!window.__yambotTeachRecorder) return [];
        return window.__yambotTeachRecorder.drain();
      });
      if (Array.isArray(batch) && batch.length) all.push(...batch);
    } catch {
      /* ignore */
    }
  }
  return all;
}

/**
 * Maps extension step → demonstration action object for Mongo / replay.
 * @param {object} raw
 * @returns {object|null}
 */
export function extensionStepToDemoAction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").trim();
  if (!type || type === "session") return null;
  /** @type {Record<string, unknown>} */
  const action = { type, source: raw.source || "extension" };
  if (raw.css) action.css = String(raw.css);
  if (raw.xpath) action.xpath = String(raw.xpath);
  if (raw.id) action.id = String(raw.id);
  if (raw.name) action.name = String(raw.name);
  if (raw.role) action.role = String(raw.role);
  if (raw.text) action.textLabel = String(raw.text);
  if (raw.ariaLabel) action.ariaLabel = String(raw.ariaLabel);
  if (raw.placeholder) action.placeholder = String(raw.placeholder);
  if (raw.href) action.href = String(raw.href);
  if (raw.tag) action.tag = String(raw.tag);
  if (type === "type") action.text = String(raw.text ?? raw.value ?? "");
  if (type === "select") action.value = String(raw.value ?? raw.text ?? "");
  if (type === "key") action.key = String(raw.key || "Enter");
  if (type === "navigate" && raw.url) action.url = String(raw.url);
  // Why: keep URL on the step observation, not as navigate unless explicit.
  return action;
}
