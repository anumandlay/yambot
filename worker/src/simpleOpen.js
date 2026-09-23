/**
 * @fileoverview Detect “just open this URL” goals for a no-LLM worker fast path.
 * Purpose: Skip multi-turn observe/think loops when the user only asked to open/visit a site.
 * Downstream: worker agent.js runTask — navigate once, report title, complete.
 */

/**
 * Strip trailing punctuation from a matched URL/domain.
 * @param {string} raw
 * @returns {string}
 */
function stripTrailingUrlJunk(raw) {
  return String(raw || "").replace(/[.,);:!?\]]+$/g, "");
}

/**
 * Extract http(s) URL or bare domain from goal text (allows example.com for explicit open).
 * @param {string} goal
 * @returns {string} Absolute https URL or ""
 */
export function extractOpenUrlFromGoal(goal) {
  const text = String(goal || "").trim();
  if (!text) return "";

  const full = text.match(/https?:\/\/[^\s<>"'）\]|,]+/i);
  if (full) {
    try {
      const u = new URL(stripTrailingUrlJunk(full[0]));
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {
      /* ignore */
    }
  }

  const bareRe =
    /(?:^|[\s("'`])((?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s<>"'）\]|,]*)?)/gi;
  let m;
  while ((m = bareRe.exec(text))) {
    const raw = stripTrailingUrlJunk(m[1]);
    const domainStart = text.indexOf(m[1], m.index);
    if (domainStart > 0 && text[domainStart - 1] === "@") continue;
    if (!/\.[a-z]{2,}(\/|$)/i.test(raw)) continue;
    // Why: skip “e.g.” / “etc” — not example.com when the user said open example.com.
    if (/^(?:e\.g|eg|etc)$/i.test(raw)) continue;
    return `https://${raw}`;
  }
  return "";
}

/**
 * True when the goal asks for more than loading a page (click/fill/login/research/etc.).
 * @param {string} goal
 * @returns {boolean}
 */
export function goalHasExtraComputerWork(goal) {
  const g = String(goal || "").toLowerCase();
  if (!g) return true;
  return (
    /\b(click|fill|type|submit|login|log\s*in|sign\s*in|sign\s*up|register|download|upload|scrape|extract|filter|search for|buy|book|checkout|message_agent|fan-?out|send (mail|email)|compose)\b/i.test(
      g
    ) ||
    /\b(and then|then |after that|also |find (the |today'?s )?top|list (all|the)|compare|monitor)\b/i.test(
      g
    )
  );
}

/**
 * Match a simple open/go-to/visit goal → absolute URL, or null.
 * Allowed soft extras: “tell me the title”, “stop once it loads”, “confirm it loads”.
 * @param {string} goal
 * @returns {{ url: string, reason: string }|null}
 */
export function matchSimpleOpenGoal(goal) {
  const text = String(goal || "").trim();
  if (!text || text.length > 280) return null;

  const url = extractOpenUrlFromGoal(text);
  if (!url) return null;

  // Must look like an open/navigate intent (not “remember that example.com is …”).
  if (
    !/\b(open|go\s+to|navigate(\s+to)?|visit|browse|load|pull\s+up)\b/i.test(text) &&
    !/^https?:\/\//i.test(text)
  ) {
    return null;
  }

  if (/\bmessage_agent\b/i.test(text) || /\b(ask|tell|message)\b.+\b(agent|peer)\b/i.test(text)) {
    return null;
  }

  if (goalHasExtraComputerWork(text)) return null;

  return { url, reason: "simple_open_fast_path" };
}
