/**
 * @fileoverview Tab/window management helpers for Playwright cloud worker.
 * Purpose: switch_tab / list tabs / active page tracking.
 * Downstream: agent.js executeAction.
 */

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
 * Opens a new tab optionally navigating to URL.
 * @param {import('playwright').BrowserContext} context
 * @param {string} [url]
 * @returns {Promise<import('playwright').Page>}
 */
export async function openTab(context, url = "") {
  const pg = await context.newPage();
  if (url && /^https?:\/\//i.test(url)) {
    await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  return pg;
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
