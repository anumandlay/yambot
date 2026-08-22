/**
 * @fileoverview Compact LLM projection of browser state (not full 6k text dump).
 * Purpose: Layered observation — state, diff, top interactives, truncated text.
 * Downstream: agent.js replaces formatObservation for LLM prompts.
 */

/**
 * Ranks interactives by simple goal keyword overlap.
 * @param {object[]} interactives
 * @param {string} goal
 * @returns {object[]}
 */
function rankInteractives(interactives, goal) {
  const words = String(goal || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  if (!words.length) return interactives;

  return [...interactives].sort((a, b) => {
    const score = (item) => {
      const blob = `${item.name || ""} ${item.role || ""} ${item.tag || ""}`.toLowerCase();
      let s = 0;
      if (item.overlay) s += 2;
      if (item.hasSubmenu) s += 1;
      for (const w of words) {
        if (blob.includes(w)) s += 3;
      }
      return s;
    };
    return score(b) - score(a);
  });
}

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
  if (pageState.forms?.length) {
    lines.push("  forms:");
    for (const form of pageState.forms.slice(0, 3)) {
      const fields = (form.fields || []).map((f) => f.name || f.ref).join(", ");
      const actions = (form.actions || []).map((a) => a.name || a.ref).join(", ");
      lines.push(`    - ${form.name}: fields=[${fields}] actions=[${actions}]`);
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
 * Builds the compact observation string for the LLM.
 * @param {{ obs: object, pageState: object, stateDiff?: object|null, goal?: string, maxInteractives?: number, maxText?: number }} params
 * @returns {string}
 */
export function formatStateProjection({
  obs,
  pageState,
  stateDiff = null,
  goal = "",
  maxInteractives = 70,
  maxText = 2500,
}) {
  const lines = [formatStateBlock(pageState)];
  const diffBlock = formatDiffBlock(stateDiff);
  if (diffBlock) lines.push("", diffBlock);

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

  const ranked = rankInteractives(obs.interactives || [], goal).slice(0, maxInteractives);
  lines.push("", `Interactive elements (top ${ranked.length} by relevance):`);
  for (const el of ranked) {
    lines.push(
      `- ${el.ref}: <${el.tag}${el.type ? ` type=${el.type}` : ""}${
        el.role ? ` role=${el.role}` : ""
      }> "${el.name}"${el.cssHint ? ` css=${el.cssHint}` : ""}${
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
