/**
 * @fileoverview Optional Playwright route filters to drop analytics/ads noise.
 * Purpose: Faster navigations in FAST_MODE by aborting known tracker requests.
 * Downstream: agent.js launchPersistentContext — does not block first-party app assets.
 *
 * Why: External “CDN optimization” advice suggested this; we only abort clear trackers
 * (not all images/fonts) so login/CAPTCHA/Google assets keep working.
 */

/**
 * Host substrings aborted when resource blocking is on.
 * Keep conservative — never match bare `google.com` / `gstatic` (CAPTCHA / OAuth).
 */
const DEFAULT_BLOCK_SNIPPETS = [
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com/tr",
  "connect.facebook.net",
  "hotjar.com",
  "static.hotjar.com",
  "segment.io",
  "segment.com",
  "cdn.segment.com",
  "mixpanel.com",
  "amplitude.com",
  "fullstory.com",
  "mouseflow.com",
  "clarity.ms",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",
  "adservice.google.",
  "pagead2.googlesyndication.com",
];

/**
 * @returns {boolean}
 */
export function shouldBlockAnalytics() {
  const explicit = String(process.env.YAMBOT_BLOCK_ANALYTICS || "").trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "off") return false;
  if (explicit === "1" || explicit === "true" || explicit === "on") return true;
  const fast = String(process.env.YAMBOT_FAST_MODE || "").trim().toLowerCase();
  return fast === "1" || fast === "true" || fast === "yes" || fast === "on";
}

/**
 * Installs a context-wide request abort filter for tracker hosts.
 * @param {import('playwright').BrowserContext} context
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<boolean>} true if installed
 */
export async function installAnalyticsBlocker(context, opts = {}) {
  if (!shouldBlockAnalytics() || !context) return false;
  const extra = String(process.env.YAMBOT_BLOCK_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const snippets = [...DEFAULT_BLOCK_SNIPPETS, ...extra];

  await context.route("**/*", (route) => {
    const url = route.request().url().toLowerCase();
    if (snippets.some((s) => url.includes(s))) {
      return route.abort();
    }
    return route.continue();
  });

  opts.log?.(`[resources] analytics/tracker blocking on (${snippets.length} rules)`);
  return true;
}
