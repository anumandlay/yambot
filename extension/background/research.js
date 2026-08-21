/**
 * @fileoverview Google SERP research runner for the Chrome extension.
 * Purpose: Parse keywords from a chat goal, open Google in a real tab, capture each
 * results page via the content script, paginate, and return structured data to YamBot.
 * Why: Extension Chrome avoids the captchas that hit headless cloud Chromium.
 */

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

  // Strip common instructional prefixes so "Research: foo, bar" still works.
  text = text.replace(/^(?:please\s+)?(?:research|scrape|search(?:\s+for)?)\s*[:=-]?\s*/i, "").trim();

  const keywords = text
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 40);

  return { keywords, maxPages };
}

/**
 * Compact chat-friendly summary from full research payload.
 * @param {Array<{ keyword: string, pages: object[] }>} jobs
 * @returns {string}
 */
export function formatResearchSummary(jobs) {
  const lines = ["Research complete."];
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
 * @param {number} opts.tabId
 * @param {string} opts.goal
 * @param {object|null} opts.agentSnapshot
 * @param {() => boolean} opts.shouldStop
 * @param {(msg: string, payload?: object) => void | Promise<void>} opts.onProgress
 * @param {(tabId: number, type: string, payload?: object) => Promise<any>} opts.sendToContent
 * @param {(tabId: number) => Promise<void>} opts.waitForTabLoad
 * @returns {Promise<{ jobs: object[], summary: string }>}
 */
export async function runResearchJob(opts) {
  const {
    tabId,
    goal,
    agentSnapshot,
    shouldStop,
    onProgress,
    sendToContent,
    waitForTabLoad,
  } = opts;

  const { keywords, maxPages } = parseResearchGoal(goal, agentSnapshot || {});
  if (!keywords.length) {
    throw Object.assign(new Error("No keywords in goal"), {
      title: "Research needs keywords",
      detail:
        "Send keywords in the chat goal, e.g. `visa for canada, schengen visa` or `keywords: a, b` with optional `pages:5`.",
    });
  }

  await onProgress(
    `Research mode: ${keywords.length} keyword(s), up to ${maxPages} page(s) each. Extension will capture Google SERPs.`
  );

  const jobs = [];

  for (const keyword of keywords) {
    if (shouldStop()) break;

    await onProgress(`Searching Google for “${keyword}”…`);
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en`;
    await chrome.tabs.update(tabId, { url: searchUrl, active: true });
    await waitForTabLoad(tabId);
    await sleep(2500);

    const pages = [];
    let pageNum = 1;

    while (pageNum <= maxPages) {
      if (shouldStop()) break;

      await humanScroll(sendToContent, tabId);
      const serp = await sendToContent(tabId, "CAPTURE_SERP");
      const pageLabel = `page ${pageNum}`;
      pages.push({ [pageLabel]: serp });

      const organic = serp?.organic_results?.length || 0;
      const ads = serp?.sponsored_results?.length || 0;
      await onProgress(
        `Captured “${keyword}” ${pageLabel}: ${organic} organic, ${ads} ads` +
          (serp?.ai_overview?.available ? ", AI overview" : ""),
        {
          keyword,
          page: pageNum,
          counts: {
            organic,
            ads,
            ai: Boolean(serp?.ai_overview?.available),
            pasf: serp?.people_also_search_for?.results?.length || 0,
          },
        }
      );

      if (pageNum >= maxPages) break;

      const next = await sendToContent(tabId, "CLICK_NEXT_SERP");
      if (!next?.clicked) {
        await onProgress(`No more Google pages for “${keyword}” after ${pageLabel}.`);
        break;
      }
      await waitForTabLoad(tabId);
      await sleep(2500);
      pageNum += 1;
    }

    jobs.push({ keyword, pages });
  }

  const summary = formatResearchSummary(jobs);
  return { jobs, summary };
}

async function humanScroll(sendToContent, tabId) {
  const times = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < times; i++) {
    try {
      await sendToContent(tabId, "EXECUTE", {
        action: { type: "scroll", amount: 400 + Math.floor(Math.random() * 500) },
      });
    } catch {
      /* ignore */
    }
    await sleep(400 + Math.floor(Math.random() * 800));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
