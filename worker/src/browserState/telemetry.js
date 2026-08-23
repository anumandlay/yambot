/**
 * @fileoverview Browser event telemetry — navigation, popups, downloads.
 * Purpose: Compact event log outside the LLM conversation for state transitions.
 * Downstream: agent.js attaches to Playwright context; format.js projection.
 */

import { enforceTabLimit, MAX_TABS } from "./tabs.js";

/**
 * Creates a telemetry collector bound to a Playwright browser context.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} initialPage
 * @param {{ log?: Function, downloadsDir?: string }} [opts]
 * @returns {{ events: object[], getSummary: Function, attach: Function, reset: Function }}
 */
export function createBrowserTelemetry(context, initialPage, opts = {}) {
  const log = opts.log || (() => {});
  const events = [];
  const maxEvents = 40;
  let activePage = initialPage;

  /**
   * @param {object} evt
   */
  function push(evt) {
    events.push({ ...evt, at: new Date().toISOString() });
    if (events.length > maxEvents) events.shift();
  }

  /**
   * @param {import('playwright').Page} pg
   */
  function wirePage(pg) {
    if (!pg || pg.isClosed()) return;
    pg.on("framenavigated", (frame) => {
      if (frame !== pg.mainFrame()) return;
      push({
        type: "navigation",
        url: frame.url(),
        name: pg.url(),
      });
    });
    pg.on("popup", (popup) => {
      push({ type: "popup", url: popup.url() });
      wirePage(popup);
      void enforceTabLimit(context, activePage, MAX_TABS);
    });
    pg.on("download", async (download) => {
      const suggested = download.suggestedFilename();
      push({ type: "download_started", filename: suggested });
      try {
        const dir = opts.downloadsDir;
        if (dir) {
          const fs = await import("node:fs");
          fs.mkdirSync(dir, { recursive: true });
          const dest = `${dir}/${suggested}`;
          await download.saveAs(dest);
          push({ type: "download_completed", filename: suggested, path: dest });
        } else {
          await download.path().catch(() => null);
          push({ type: "download_completed", filename: suggested });
        }
      } catch (err) {
        push({
          type: "download_failed",
          filename: suggested,
          error: String(err?.message || err),
        });
      }
    });
  }

  function attach() {
    context.on("page", (pg) => {
      push({ type: "new_tab", url: pg.url() });
      wirePage(pg);
      void enforceTabLimit(context, activePage, MAX_TABS);
    });
    wirePage(activePage);
  }

  /**
   * @returns {object}
   */
  function getSummary() {
    const pages = context.pages().map((p, index) => ({
      index,
      active: p === activePage,
      url: safeUrl(p),
      title: "",
    }));
    return {
      tabs: pages,
      tab_count: pages.length,
      active_tab: pages.findIndex((t) => t.active),
      recent_events: events.slice(-12),
      last_navigation: [...events].reverse().find((e) => e.type === "navigation") || null,
    };
  }

  /**
   * @param {import('playwright').Page} pg
   */
  function setActivePage(pg) {
    activePage = pg;
  }

  function reset() {
    events.length = 0;
  }

  return {
    events,
    attach,
    getSummary,
    setActivePage,
    reset,
  };
}

/**
 * @param {import('playwright').Page} pg
 * @returns {string}
 */
function safeUrl(pg) {
  try {
    return pg.url();
  } catch {
    return "";
  }
}

/**
 * @param {object|null} summary
 * @returns {string}
 */
export function formatTelemetryBlock(summary) {
  if (!summary) return "";
  const lines = ["BROWSER SESSION:"];
  if (summary.tabs?.length) {
    lines.push(`  tabs (${summary.tab_count}):`);
    for (const tab of summary.tabs.slice(0, 8)) {
      lines.push(`    ${tab.active ? "*" : " "} [${tab.index}] ${tab.url?.slice(0, 100) || ""}`);
    }
  }
  if (summary.last_navigation?.url) {
    lines.push(`  last_navigation: ${summary.last_navigation.url.slice(0, 120)}`);
  }
  const recent = summary.recent_events || [];
  if (recent.length) {
    lines.push("  recent_events:");
    for (const e of recent.slice(-6)) {
      if (e.type === "navigation") lines.push(`    - navigated → ${String(e.url).slice(0, 80)}`);
      else if (e.type === "download_completed") lines.push(`    - download: ${e.filename}`);
      else if (e.type === "download_started") lines.push(`    - download started: ${e.filename}`);
      else if (e.type === "new_tab") lines.push(`    - new tab: ${String(e.url).slice(0, 60)}`);
      else if (e.type === "popup") lines.push(`    - popup: ${String(e.url).slice(0, 60)}`);
      else lines.push(`    - ${e.type}`);
    }
  }
  return lines.join("\n");
}
