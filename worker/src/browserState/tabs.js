/**
 * @fileoverview Tab/window management helpers for Playwright cloud worker.
 * Purpose: switch_tab / list tabs / active page tracking; cap tab count to avoid OOM crashes.
 * Downstream: agent.js executeAction.
 */

/** Why: each extra tab is a Chromium renderer — unbounded tabs OOM the 1.5–2GB worker container. */
export const MAX_TABS = 5;

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
 * Closes oldest non-active tabs when over the limit.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} activePage
 * @param {number} [maxTabs]
 * @returns {Promise<number>} number of tabs closed
 */
export async function enforceTabLimit(context, activePage, maxTabs = MAX_TABS) {
  const pages = context.pages().filter((p) => !p.isClosed());
  let closed = 0;
  while (pages.length > maxTabs) {
    const victim = pages.find((p) => p !== activePage) || pages[0];
    if (!victim) break;
    const idx = pages.indexOf(victim);
    try {
      await victim.close();
      closed += 1;
    } catch {
      /* ignore */
    }
    pages.splice(idx, 1);
    if (victim === activePage) break;
  }
  return closed;
}

/**
 * Lists open tabs in the browser context.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} activePage
 * @returns {Promise<object[]>}
 */
export async function listTabs(context, activePage) {
  const pages = context.pages().filter((p) => !p.isClosed());
  const out = [];
  for (let index = 0; index < pages.length; index += 1) {
    const p = pages[index];
    let title = "";
    let url = "";
    try {
      title = await p.title();
      url = p.url();
    } catch {
      /* ignore */
    }
    out.push({
      index,
      active: p === activePage,
      url,
      title: title.slice(0, 120),
    });
  }
  return out;
}

/**
 * Switches active page by index or url substring.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} currentPage
 * @param {{ index?: number, url_contains?: string }} action
 * @returns {Promise<{ page: import('playwright').Page, tab: object }>}
 */
export async function switchTab(context, currentPage, action) {
  const pages = context.pages().filter((p) => !p.isClosed());
  if (!pages.length) throw new Error("No tabs open");

  let target = currentPage;
  if (action.index != null && pages[action.index]) {
    target = pages[action.index];
  } else if (action.url_contains) {
    const needle = String(action.url_contains).toLowerCase();
    target = pages.find((p) => safeUrl(p).toLowerCase().includes(needle)) || currentPage;
  }

  await target.bringToFront();
  return {
    page: target,
    tab: {
      index: pages.indexOf(target),
      url: safeUrl(target),
      title: await target.title().catch(() => ""),
    },
  };
}

/**
 * Opens a new tab optionally navigating to URL; enforces tab cap afterward.
 * @param {import('playwright').BrowserContext} context
 * @param {string} [url]
 * @param {import('playwright').Page} [activePage]
 * @returns {Promise<import('playwright').Page>}
 */
export async function openTab(context, url = "", activePage = null) {
  const pg = await context.newPage();
  if (url && /^https?:\/\//i.test(url)) {
    await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await enforceTabLimit(context, activePage || pg);
  return pg;
}

/**
 * Closes a tab by index (cannot close the only remaining tab).
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} currentPage
 * @param {{ index?: number }} action
 * @returns {Promise<{ page: import('playwright').Page, closed: number }>}
 */
export async function closeTab(context, currentPage, action) {
  const pages = context.pages().filter((p) => !p.isClosed());
  if (pages.length <= 1) {
    return { page: currentPage, closed: 0 };
  }
  const idx = Number(action.index);
  const target = Number.isFinite(idx) && pages[idx] ? pages[idx] : null;
  if (!target) throw new Error("close_tab: invalid index");
  const wasActive = target === currentPage;
  await target.close();
  const remaining = context.pages().filter((p) => !p.isClosed());
  const next = wasActive ? remaining[remaining.length - 1] || remaining[0] : currentPage;
  if (next) await next.bringToFront();
  return { page: next || currentPage, closed: 1 };
}
