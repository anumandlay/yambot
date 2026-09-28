/**
 * @fileoverview Facts already true on this browser run.
 * Purpose: The next model step should extract a table that is already open instead of logging in again.
 * Downstream: worker/src/agent.js step prompt.
 */

/**
 * Read URL, selected country, and table size from the current observation.
 * @param {object|null|undefined} obs
 * @returns {{ url: string, title: string, country: string, rows: string }}
 */
export function captureRunVerified(obs) {
  const url = String(obs?.url || "");
  const title = String(obs?.title || "");
  const text = String(obs?.text || "");
  const controls = Array.isArray(obs?.interactives) ? obs.interactives : [];
  let country = "";
  for (const el of controls) {
    const name = String(el?.name || "").toLowerCase();
    const value = String(el?.value || "").trim();
    if (!value) continue;
    if (/^(select|choose|all|country)$/i.test(value)) continue;
    if (/country|nation/.test(name) || /country|nation/.test(String(el?.role || ""))) {
      country = value;
      break;
    }
  }
  if (!country) {
    const named = text.match(/\bcountry\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{1,40})/i);
    if (named) country = named[1].trim();
  }
  let rows = "";
  const ofMatch = text.match(/\b(\d{1,6})\s+of\s+(\d{1,6})\b/i);
  if (ofMatch) rows = `${ofMatch[1]} of ${ofMatch[2]}`;
  return { url, title, country, rows };
}

/**
 * Prompt block telling the model which steps are already done.
 * @param {{ url?: string, title?: string, country?: string, rows?: string }} verified
 * @returns {string}
 */
export function formatVerifiedBlock(verified) {
  if (!verified?.url) return "";
  const lines = ["VERIFIED THIS RUN (do not repeat these steps):", `- URL: ${verified.url}`];
  if (verified.title) lines.push(`- Title: ${verified.title}`);
  if (verified.country) lines.push(`- Country filter: ${verified.country} (already selected)`);
  if (verified.rows) lines.push(`- Table size on page: ${verified.rows}`);
  if (verified.country || /trial-expir|admin/i.test(verified.url)) {
    lines.push("Next: read the table with extract. Do not log in again and do not open this page again.");
  }
  return lines.join("\n");
}
