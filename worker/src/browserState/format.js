/**
 * @fileoverview Compact LLM projection of browser state (not full 6k text dump).
 * Purpose: Layered observation — plan, progress, structures, a11y, tabs, ranked interactives.
 * Downstream: agent.js replaces formatObservation for LLM prompts.
 */

import { scoreInteractives } from "./relevance.js";
import { formatStructuresBlock, buildStructuresFromObs } from "./structures.js";
import { formatProgressBlock } from "./progress.js";
import { formatPlanBlock } from "./planner.js";
import { formatA11yBlock } from "./a11y.js";
import { formatTelemetryBlock } from "./telemetry.js";

/**
 * Formats page state block for the LLM.
 * @param {object} pageState
 * @returns {string}
 */
function formatStateBlock(pageState) {
  if (!pageState) return "";
  const lines = ["PAGE STATE:"];
  lines.push(`  url: ${pageState.page?.url || ""}`);
  lines.push(`  title: ${pageState.page?.title || ""}`);
  lines.push(
    `  ui: modal=${pageState.ui?.modal_open} menu=${pageState.ui?.menu_open} loading=${pageState.ui?.loading} dropdown=${pageState.ui?.dropdown_open}`
  );
  if (pageState.auth?.state && pageState.auth.state !== "unknown") {
    lines.push(`  auth: ${pageState.auth.state} (confidence ${pageState.auth.confidence})`);
  }
  if (pageState.captcha?.present) {
    lines.push(`  captcha: ${(pageState.captcha.signals || []).join(",")}`);
  }
  if (pageState.errors?.length) {
    lines.push("  errors:");
    for (const err of pageState.errors.slice(0, 5)) {
      lines.push(`    - ${err.field ? `${err.field}: ` : ""}${err.message}`);
    }
  }
  lines.push(`  interactives: ${pageState.interactive_count ?? 0}`);
  return lines.join("\n");
}

/**
 * Formats observation diff since last step.
 * @param {object|null} stateDiff
 * @returns {string}
 */
function formatDiffBlock(stateDiff) {
  if (!stateDiff) return "";
  const lines = ["CHANGES SINCE LAST STEP:"];
  if (stateDiff.url_changed) lines.push(`  url_changed: true`);
  if (stateDiff.dom_changed) {
    lines.push(`  dom_changed: true`);
    if (stateDiff.added_refs?.length) {
      lines.push(`  added_refs: ${stateDiff.added_refs.slice(0, 15).join(", ")}`);
    }
    if (stateDiff.removed_refs?.length) {
      lines.push(`  removed_refs: ${stateDiff.removed_refs.slice(0, 15).join(", ")}`);
    }
    if (stateDiff.modified_refs?.length) {
      for (const m of stateDiff.modified_refs.slice(0, 5)) {
        lines.push(`  modified ${m.ref}.${m.field}: ${m.from} → ${m.to}`);
      }
    }
  }
  if (stateDiff.menu_count_changed) {
    lines.push(
      `  menus: ${stateDiff.open_menus_before} → ${stateDiff.open_menus_after}`
    );
  }
  if (lines.length === 1) lines.push("  (no significant changes)");
  return lines.join("\n");
}

/**
 * @param {object} obs
 * @returns {string}
 */
function formatFramesBlock(obs) {
  const parts = [];
  if (obs.iframes?.length) {
    parts.push("IFRAMES (may be cross-origin):");
    for (const f of obs.iframes.slice(0, 6)) {
      parts.push(`  - [${f.index}] ${f.title || f.name || "iframe"} ${f.src || ""}`);
    }
  }
  if (obs.frames?.length) {
    parts.push("ACCESSIBLE FRAMES:");
    for (const f of obs.frames.slice(0, 6)) {
      if (f.cross_origin) {
        parts.push(`  - ${f.frameId}: cross-origin ${f.url || ""}`);
      } else {
        parts.push(`  - ${f.frameId}: ${f.interactive_count ?? 0} refs ${f.url || ""}`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Builds the compact observation string for the LLM.
 * @param {object} params
 * @returns {string}
 */
export function formatStateProjection({
  obs,
  pageState,
  stateDiff = null,
  goal = "",
  plan = null,
  progress = null,
  currentSubgoal = "",
  telemetry = null,
  maxInteractives = 65,
  maxText = 1800,
}) {
  const lines = [];

  const planBlock = formatPlanBlock(plan);
  if (planBlock) lines.push(planBlock);

  const progressBlock = formatProgressBlock(progress);
  if (progressBlock) lines.push("", progressBlock);

  const telBlock = formatTelemetryBlock(telemetry);
  if (telBlock) lines.push("", telBlock);

  lines.push("", formatStateBlock(pageState));
  const diffBlock = formatDiffBlock(stateDiff);
  if (diffBlock) lines.push("", diffBlock);

  const structures = buildStructuresFromObs(obs);
  const structuresBlock = formatStructuresBlock(structures);
  if (structuresBlock) lines.push("", structuresBlock);

  const framesBlock = formatFramesBlock(obs);
  if (framesBlock) lines.push("", framesBlock);

  const a11yBlock = formatA11yBlock(obs.a11y);
  if (a11yBlock) lines.push("", a11yBlock);

  if (Array.isArray(obs.openMenus) && obs.openMenus.length) {
    lines.push("", "Open menus (use overlay refs; [submenu] first):");
    for (const menu of obs.openMenus) {
      lines.push(`Menu ${menu.menuIndex + 1}:`);
      for (const item of menu.items || []) {
        const flags = [
          item.hasSubmenu ? "submenu" : "",
          item.checked ? `checked=${item.checked}` : "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`  - "${item.name}"${flags ? ` [${flags}]` : ""}`);
      }
    }
  }

  const subgoal = currentSubgoal || "";
  const ranked = scoreInteractives(obs.interactives || [], goal, subgoal).slice(0, maxInteractives);
  lines.push("", `Interactive elements (top ${ranked.length} by goal relevance):`);
  for (const el of ranked) {
    const rel = el.relevance != null ? ` score=${el.relevance}` : "";
    const ctx = el.nearbyText ? ` context="${String(el.nearbyText).slice(0, 50)}"` : "";
    const frame = el.frameId && el.frameId !== "main" ? ` frame=${el.frameId}` : "";
    const shadow = el.shadowHost ? ` shadow=${el.shadowHost}` : "";
    lines.push(
      `- ${el.ref}: <${el.tag}${el.type ? ` type=${el.type}` : ""}${
        el.role ? ` role=${el.role}` : ""
      }> "${el.name}"${rel}${frame}${shadow}${ctx}${el.cssHint ? ` css=${el.cssHint}` : ""}${
        el.overlay ? " [overlay]" : ""
      }${el.hasSubmenu ? " [submenu]" : ""}${el.href ? ` href=${el.href}` : ""}${
        el.value ? ` value=${el.value}` : ""
      }${el.disabled ? " [disabled]" : ""}`
    );
  }

  const text = String(obs.text || "").slice(0, maxText);
  if (text) {
    lines.push("", "Page text (truncated):", text);
  }

  return lines.join("\n");
}
