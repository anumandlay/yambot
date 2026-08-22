/**
 * @fileoverview Accessibility tree capture via Playwright ariaSnapshot.
 * Purpose: Merge perceived UI (a11y) with DOM refs for complex widgets.
 * Downstream: observe.js, format.js LLM projection.
 */

/**
 * Captures a compact accessibility snapshot from the active page.
 * @param {import('playwright').Page} page
 * @param {{ maxChars?: number }} [opts]
 * @returns {Promise<{ yaml: string, truncated: boolean }|null>}
 */
export async function captureA11ySnapshot(page, opts = {}) {
  const maxChars = opts.maxChars ?? 3500;
  if (!page || page.isClosed()) return null;
  try {
    const yaml = await page.locator("body").ariaSnapshot({ timeout: 4000 });
    const text = String(yaml || "").trim();
    if (!text) return null;
    return {
      yaml: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  } catch {
    return null;
  }
}

/**
 * Flattens a11y yaml into short lines for the LLM (first N interactive-looking lines).
 * @param {string} yaml
 * @param {number} [maxLines=35]
 * @returns {string[]}
 */
export function flattenA11yLines(yaml, maxLines = 35) {
  const lines = String(yaml || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const interactive = lines.filter((l) =>
    /button|link|textbox|combobox|checkbox|menuitem|tab |dialog|heading|gridcell/i.test(l)
  );
  const pick = interactive.length >= 8 ? interactive : lines;
  return pick.slice(0, maxLines);
}

/**
 * @param {{ yaml?: string, truncated?: boolean }|null} snap
 * @returns {string}
 */
export function formatA11yBlock(snap) {
  if (!snap?.yaml) return "";
  const lines = flattenA11yLines(snap.yaml);
  if (!lines.length) return "";
  const out = ["ACCESSIBILITY TREE (truncated):"];
  for (const l of lines) out.push(`  ${l}`);
  if (snap.truncated) out.push("  …");
  return out.join("\n");
}
