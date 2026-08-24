/**
 * @fileoverview Tab/window management helpers for Playwright cloud worker.
 * Purpose: switch_tab / list tabs / active page tracking; cap tab count to avoid OOM crashes.
 * Downstream: agent.js executeAction.
 */

/** Why: one headed Chromium window on the live screen — all automation uses a single tab. */
export const MAX_TABS = 1;

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
 * @param {import('playwright').Page} pg
 * @returns {string}
 */
export function safePageUrl(pg) {
  return safeUrl(pg);
}

/**
 * Higher score = more likely the tab the user/agent should keep after human handoff.
 * @param {string} url
 * @returns {number}
 */
export function scorePageUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u || u === "about:blank" || u.startsWith("chrome://") || u.startsWith("chrome-error://")) {
    return 0;
  }
  if (/accounts\.google\.com|signin|login|oauth|authuser|myaccount\.google/i.test(u)) return 4;
  if (/docs\.google\.com|sheets\.google\.com|drive\.google\.com|office\.com|excel|spreadsheet/i.test(u)) {
    return 10;
  }
  if (/\.google\.com|workspace\.google/i.test(u)) return 7;
  if (/^https?:\/\//i.test(u)) return 6;
  return 1;
}

/**
 * Picks the tab with the most useful URL (e.g. open spreadsheet, not about:blank).
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page|null} [currentPage]
 * @returns {import('playwright').Page|null}
 */
export function pickBestActivePage(context, currentPage = null) {
  const pages = context.pages().filter((p) => !p.isClosed());
  if (!pages.length) return null;
  let best = currentPage && pages.includes(currentPage) ? currentPage : pages[0];
  let bestScore = scorePageUrl(safeUrl(best));
  for (const p of pages) {
    const s = scorePageUrl(safeUrl(p));
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Closes blank/low-value tabs when over the cap; never drops the best authenticated tab.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page|null} activePage
 * @param {number} [maxTabs]
 * @returns {Promise<import('playwright').Page|null>}
 */
export async function consolidateTabs(context, activePage, maxTabs = MAX_TABS) {
  let pages = context.pages().filter((p) => !p.isClosed());
  let active = pickBestActivePage(context, activePage);
  if (!active) return activePage;

  for (const p of [...pages]) {
    if (p === active) continue;
    if (scorePageUrl(safeUrl(p)) === 0) {
      try {
        await p.close();
      } catch {
        /* ignore */
      }
    }
  }

  pages = context.pages().filter((p) => !p.isClosed());
  active = pickBestActivePage(context, active) || active;

  while (pages.length > maxTabs) {
    let victim = null;
    let victimScore = Infinity;
    for (const p of pages) {
      if (p === active) continue;
      const s = scorePageUrl(safeUrl(p));
      if (s < victimScore) {
        victim = p;
        victimScore = s;
      }
    }
    if (!victim) break;
    try {
      await victim.close();
    } catch {
      /* ignore */
    }
    pages = pages.filter((p) => p !== victim);
  }

  try {
    await active.bringToFront();
  } catch {
    /* ignore */
  }
  return active;
}

/**
 * After human Take control, wait for OAuth redirect (popup closes → opener navigates to Sheets).
 * Why: closing about:blank tabs too early kills the opener before Google redirects it.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page|null} hintPage
 * @param {number} [waitMs]
 * @returns {Promise<import('playwright').Page|null>}
 */
export async function selectBestPageAfterHandoff(context, hintPage = null, waitMs = 5000) {
  const deadline = Date.now() + waitMs;
  let best = hintPage;

  while (Date.now() < deadline) {
    best = pickBestActivePage(context, best || hintPage);
    if (!best) break;
    const score = scorePageUrl(safeUrl(best));
    if (score >= 10) break;
    if (score >= 4) {
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    if (score >= 6) break;
    await new Promise((r) => setTimeout(r, 450));
  }

  best = pickBestActivePage(context, best || hintPage);
  if (best) {
    try {
      await best.bringToFront();
    } catch {
      /* ignore */
    }
  }
  return best;
}

/**
 * Removes empty tabs only when a productive tab is already active (safe after OAuth settles).
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page|null} activePage
 * @returns {Promise<import('playwright').Page|null>}
 */
export async function pruneBlankTabsIfProductive(context, activePage) {
  if (!activePage) return activePage;
  const activeScore = scorePageUrl(safeUrl(activePage));
  if (activeScore < 6) return activePage;
  for (const p of context.pages().filter((pg) => !pg.isClosed())) {
    if (p === activePage) continue;
    if (scorePageUrl(safeUrl(p)) === 0) {
      try {
        await p.close();
      } catch {
        /* ignore */
      }
    }
  }
  return pickBestActivePage(context, activePage) || activePage;
}

/**
 * Copies the best tab's URL into mainPage before closing extras — preserves Google OAuth sessions.
 * Why: OAuth often opens a popup; the opener stays on about:blank until we merge manually.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} mainPage
 * @returns {Promise<import('playwright').Page>}
 */
export async function mergeBestTabIntoMain(context, mainPage) {
  if (!context || !mainPage || mainPage.isClosed()) return mainPage;
  const pages = context.pages().filter((p) => !p.isClosed());
  if (pages.length <= 1) return mainPage;
  const best = pickBestActivePage(context, mainPage);
  if (!best) return mainPage;
  const bestUrl = safeUrl(best);
  const mainUrl = safeUrl(mainPage);
  if (scorePageUrl(bestUrl) <= scorePageUrl(mainUrl)) return mainPage;
  if (!/^https?:\/\//i.test(bestUrl)) return best;
  try {
    await mainPage.goto(bestUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    return mainPage;
  } catch {
    return best;
  }
}

/**
 * Keeps exactly one Playwright page (one Chromium window on the live screen).
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page|null} mainPage
 * @param {{ allowExtra?: boolean }} [opts]
 * @returns {Promise<import('playwright').Page|null>}
 */
export async function enforceSinglePage(context, mainPage, opts = {}) {
  const { allowExtra = false } = opts;
  if (!context) return mainPage;
  const pages = context.pages().filter((p) => !p.isClosed());
  if (!pages.length) return mainPage;
  if (allowExtra && pages.length <= 2) {
    const best = pickBestActivePage(context, mainPage) || mainPage;
    if (best) {
      try {
        await best.bringToFront();
      } catch {
        /* ignore */
      }
    }
    return best;
  }
  let best = pickBestActivePage(context, mainPage) || pages[0];
  if (mainPage && pages.length > 1) {
    best = await mergeBestTabIntoMain(context, mainPage);
  }
  for (const p of context.pages().filter((pg) => !pg.isClosed())) {
    if (p === best) continue;
    try {
      await p.close();
    } catch {
      /* ignore */
    }
  }
  try {
    await best.bringToFront();
  } catch {
    /* ignore */
  }
  return best;
}

/**
 * Navigates the sole automation tab (open_tab must not spawn new windows).
 * @param {import('playwright').Page} page
 * @param {string} [url]
 */
export async function navigateInPlace(page, url = "") {
  if (!page || page.isClosed()) throw new Error("No page to navigate");
  if (url && /^https?:\/\//i.test(url)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  return page;
}

/**
 * Closes oldest non-active tabs when over the limit.
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} activePage
 * @param {number} [maxTabs]
 * @returns {Promise<number>} number of tabs closed
 */
export async function enforceTabLimit(context, activePage, maxTabs = MAX_TABS) {
  if (maxTabs <= 1) {
    await enforceSinglePage(context, activePage);
    return 0;
  }
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
  const pg = activePage || context.pages().find((p) => !p.isClosed()) || (await context.newPage());
  await navigateInPlace(pg, url);
  await enforceSinglePage(context, pg);
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
