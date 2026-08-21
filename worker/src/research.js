/**
 * @fileoverview Cloud Google SERP research runner (Playwright + bundled extension).
 * Purpose: Mirror extension research.js so research agents can run on VPS computers.
 */

import { serpCaptureInPage, clickNextSerpInPage } from "./serpCapture.js";

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
export function formatResearchSummary(jobs) {
  const lines = ["Research complete (cloud computer)."];
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
      for (const r of organic.slice(0, 5)) {
        lines.push(`  ${r.position}. ${r.title} — ${r.url}`);
      }
      if (organic.length > 5) lines.push(`  … +${organic.length - 5} more`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.goal
 * @param {object|null} opts.agentSnapshot
 * @param {() => Promise<boolean>|boolean} opts.shouldStop
 * @param {(msg: string, payload?: object) => void | Promise<void>} opts.onProgress
 * @param {() => Promise<void>} [opts.onLive]
 * @returns {Promise<{ jobs: object[], summary: string }>}
 */
export async function runCloudResearchJob(opts) {
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
    `Research mode (cloud + YamBot extension): ${keywords.length} keyword(s), up to ${maxPages} page(s) each.`
  );

  const jobs = [];

  for (const keyword of keywords) {
    if (await shouldStop()) break;

    await onProgress(`Searching Google for “${keyword}”…`);
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
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
        `Captured “${keyword}” ${pageLabel}: ${organic} organic, ${ads} ads` +
          (serp?.ai_overview?.available ? ", AI overview" : "") +
          (serp?.via === "worker-fallback" ? " (worker parser)" : " (extension)"),
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

  return { jobs, summary: formatResearchSummary(jobs) };
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
