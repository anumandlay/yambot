/**
 * @fileoverview Cloud research Phase 1 — Google homepage UI search + SERP scrape.
 * Purpose: Never jump to /search?q=…; type into the search box (xpath) like a human agent,
 * scrape pages, then hand organic URLs to Phase 2 (LLM site visits).
 */

import { serpCaptureInPage, clickNextSerpInPage } from "./serpCapture.js";

/** Google homepage search box — same style locators other agents use. */
export const GOOGLE_SEARCH_XPATH =
  '//textarea[@name="q"] | //input[@name="q"]';

export const GOOGLE_SEARCH_BTN_XPATH =
  '//input[@name="btnK"] | //button[@type="submit" and (@aria-label="Google Search" or contains(., "Google Search") or contains(., "Search"))]';

/**
 * @param {string} goal
 * @param {{ researchMaxPages?: number }} [snapshot]
 * @returns {{ keywords: string[], maxPages: number }}
 */
export function parseResearchGoal(goal, snapshot = {}) {
  let maxPages = Math.min(50, Math.max(1, Number(snapshot.researchMaxPages) || 10));
  let text = String(goal || "").trim();

  const pagesMatch = text.match(/(?:pages|noofpagestoscrape)\s*[:=]\s*(\d+)/i);
  if (pagesMatch) {
    maxPages = Math.min(50, Math.max(1, Number(pagesMatch[1])));
    text = text.replace(pagesMatch[0], " ").trim();
  }

  const kwHeader = text.match(/^\s*keywords?\s*[:=]\s*(.+)$/is);
  if (kwHeader) text = kwHeader[1].trim();

  text = text.replace(/^(?:please\s+)?(?:research|scrape|search(?:\s+for)?)\s*[:=-]?\s*/i, "").trim();

  const keywords = text
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 40);

  return { keywords, maxPages };
}

/**
 * @param {Array<{ keyword: string, pages: object[] }>} jobs
 * @returns {string}
 */
export function formatSerpSummary(jobs) {
  const lines = ["Phase 1 complete — Google SERP results collected."];
  for (const job of jobs) {
    lines.push(`\n## ${job.keyword}`);
    for (const entry of job.pages) {
      const [label, page] = Object.entries(entry)[0] || [];
      if (!page) continue;
      const organic = page.organic_results || [];
      const ads = page.sponsored_results || [];
      const ai = page.ai_overview?.available ? "yes" : "no";
      lines.push(
        `- ${label}: ${organic.length} organic, ${ads.length} ads, AI overview: ${ai}`
      );
      for (const r of organic.slice(0, 8)) {
        lines.push(`  ${r.position}. ${r.title} — ${r.url}`);
      }
      if (organic.length > 8) lines.push(`  … +${organic.length - 8} more`);
    }
  }
  return lines.join("\n");
}

/**
 * Flatten organic URLs for Phase 2 LLM site visits.
 * @param {Array<{ keyword: string, pages: object[] }>} jobs
 * @param {{ maxUrls?: number }} [opts]
 * @returns {Array<{ keyword: string, title: string, url: string, snippet: string }>}
 */
export function collectOrganicUrls(jobs, opts = {}) {
  const maxUrls = Math.min(40, Math.max(1, Number(opts.maxUrls) || 15));
  const out = [];
  const seen = new Set();
  for (const job of jobs) {
    for (const entry of job.pages || []) {
      const page = Object.values(entry)[0];
      for (const r of page?.organic_results || []) {
        const url = String(r?.url || "").trim();
        if (!url || seen.has(url)) continue;
        if (/^https?:\/\/([^/]*\.)?google\./i.test(url)) continue;
        seen.add(url);
        out.push({
          keyword: job.keyword,
          title: String(r.title || "").trim(),
          url,
          snippet: String(r.snippet || "").trim(),
        });
        if (out.length >= maxUrls) return out;
      }
    }
  }
  return out;
}

/**
 * @param {string} originalGoal
 * @param {Array<{ keyword: string, title: string, url: string, snippet: string }>} urls
 * @returns {string}
 */
export function buildDeepResearchGoal(originalGoal, urls) {
  const list = urls
    .map(
      (u, i) =>
        `${i + 1}. ${u.title || "(no title)"}\n   URL: ${u.url}\n   Keyword: ${u.keyword}\n   Snippet: ${u.snippet || ""}`
    )
    .join("\n\n");
  return [
    "PHASE 2 — Deep website research (LLM).",
    "Phase 1 already collected Google results. Do NOT open google.com/search or type a new Google query unless a listed site requires it.",
    `ORIGINAL USER GOAL:\n${originalGoal}`,
    "Visit each site below IN ORDER. On each site: navigate to the URL, extract facts relevant to the goal, then move to the next.",
    "When finished (or if many sites are blocked), call finish with a clear structured research summary covering all visited sites.",
    "SITES TO VISIT:",
    list || "(no organic URLs found — report that Phase 1 found nothing and finish)",
  ].join("\n\n");
}

/**
 * Phase 1 only: homepage → type keyword → search → scrape pages.
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.goal
 * @param {object|null} opts.agentSnapshot
 * @param {() => Promise<boolean>|boolean} opts.shouldStop
 * @param {(msg: string, payload?: object) => void | Promise<void>} opts.onProgress
 * @param {() => Promise<void>} [opts.onLive]
 * @returns {Promise<{ jobs: object[], summary: string, urls: object[] }>}
 */
export async function runCloudResearchPhase1(opts) {
  const { page, goal, agentSnapshot, shouldStop, onProgress, onLive } = opts;
  const { keywords, maxPages } = parseResearchGoal(goal, agentSnapshot || {});
  if (!keywords.length) {
    throw Object.assign(new Error("No keywords in goal"), {
      title: "Research needs keywords",
      detail:
        "Send keywords in the chat goal, e.g. `visa for canada, schengen visa` or `keywords: a, b` with optional `pages:5`.",
    });
  }

  await onProgress(
    `Phase 1: open google.com → type into search box → Search → scrape (up to ${maxPages} page(s) × ${keywords.length} keyword(s)).`
  );

  const jobs = [];

  for (const keyword of keywords) {
    if (await shouldStop()) break;

    await onProgress(`Opening google.com for “${keyword}”…`);
    await page.goto("https://www.google.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(1200);
    await dismissGoogleConsent(page);
    await onLive?.();

    await onProgress(`Typing “${keyword}” into Google search box (xpath)…`);
    await typeGoogleQuery(page, keyword);
    await onLive?.();

    await onProgress(`Clicking Search for “${keyword}”…`);
    await submitGoogleSearch(page);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await sleep(2500);
    await onLive?.();

    const pages = [];
    let pageNum = 1;

    while (pageNum <= maxPages) {
      if (await shouldStop()) break;

      await humanScroll(page);
      const serp = await page.evaluate(serpCaptureInPage);
      const pageLabel = `page ${pageNum}`;
      pages.push({ [pageLabel]: serp });

      const organic = serp?.organic_results?.length || 0;
      const ads = serp?.sponsored_results?.length || 0;
      await onProgress(
        `Scraped “${keyword}” ${pageLabel}: ${organic} organic, ${ads} ads` +
          (serp?.ai_overview?.available ? ", AI overview" : ""),
        {
          keyword,
          page: pageNum,
          counts: { organic, ads, ai: Boolean(serp?.ai_overview?.available) },
        }
      );
      await onLive?.();

      if (pageNum >= maxPages) break;

      const next = await page.evaluate(clickNextSerpInPage);
      if (!next?.clicked) {
        await onProgress(`No more Google pages for “${keyword}” after ${pageLabel}.`);
        break;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await sleep(2500);
      pageNum += 1;
    }

    jobs.push({ keyword, pages });
  }

  const urls = collectOrganicUrls(jobs, {
    maxUrls: Math.min(30, Math.max(8, keywords.length * 5)),
  });
  const summary = formatSerpSummary(jobs);
  await onProgress(
    `Phase 1 done. ${urls.length} organic URL(s) queued for Phase 2 (LLM visits each site).`
  );
  return { jobs, summary, urls };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} keyword
 */
async function typeGoogleQuery(page, keyword) {
  const box = page.locator(`xpath=${GOOGLE_SEARCH_XPATH}`).first();
  await box.waitFor({ state: "visible", timeout: 20000 });
  await box.click({ timeout: 10000 });
  await sleep(200);
  // Why: clear any leftover query from a previous keyword in the same profile.
  await box.fill("");
  await box.type(keyword, { delay: 25 });
}

/**
 * @param {import('playwright').Page} page
 */
async function submitGoogleSearch(page) {
  // Prefer Enter — Google often hides btnK until suggestion UI settles.
  try {
    await page.keyboard.press("Enter");
    await sleep(800);
    if (/\/search\?/i.test(page.url())) return;
  } catch {
    /* try button */
  }
  const btn = page.locator(`xpath=${GOOGLE_SEARCH_BTN_XPATH}`).first();
  try {
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click({ timeout: 10000 });
      return;
    }
  } catch {
    /* fall through */
  }
  await page.keyboard.press("Enter");
}

/**
 * @param {import('playwright').Page} page
 */
async function dismissGoogleConsent(page) {
  const candidates = [
    'button#L2AGLb',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
  ];
  for (const sel of candidates) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 })) {
        await b.click({ timeout: 5000 });
        await sleep(600);
        return;
      }
    } catch {
      /* try next */
    }
  }
}

async function humanScroll(page) {
  const times = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < times; i++) {
    try {
      await page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: "instant" });
      }, 400 + Math.floor(Math.random() * 500));
    } catch {
      /* ignore */
    }
    await sleep(400 + Math.floor(Math.random() * 800));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
