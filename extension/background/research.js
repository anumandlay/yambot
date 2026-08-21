/**
 * @fileoverview Extension research Phase 1 — Google homepage UI search + SERP scrape.
 * Purpose: Open google.com (not /search?q=), type into the search box via xpath EXECUTE,
 * scrape pages, then hand URLs to Phase 2 LLM deep research.
 */

/** Google homepage search box xpath (same contract as cloud worker). */
export const GOOGLE_SEARCH_XPATH =
  '//textarea[@name="q"] | //input[@name="q"]';

export const GOOGLE_SEARCH_BTN_XPATH =
  '//input[@name="btnK"] | //button[@type="submit"]';

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
 * @param {Array<{ keyword: string, pages: object[] }>} jobs
 * @param {{ maxUrls?: number }} [opts]
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
 * @param {object} opts
 * @returns {Promise<{ jobs: object[], summary: string, urls: object[] }>}
 */
export async function runResearchPhase1(opts) {
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
    `Phase 1: open google.com → type into search box (xpath) → Search → scrape (up to ${maxPages} page(s) × ${keywords.length} keyword(s)).`
  );

  const jobs = [];

  for (const keyword of keywords) {
    if (shouldStop()) break;

    await onProgress(`Opening google.com for “${keyword}”…`);
    await chrome.tabs.update(tabId, { url: "https://www.google.com/", active: true });
    await waitForTabLoad(tabId);
    await sleep(1500);
    await dismissConsent(sendToContent, tabId);

    await onProgress(`Typing “${keyword}” into Google search box…`);
    await sendToContent(tabId, "EXECUTE", {
      action: {
        type: "type",
        xpath: GOOGLE_SEARCH_XPATH,
        text: keyword,
      },
    });
    await sleep(400);

    await onProgress(`Submitting Google search for “${keyword}”…`);
    try {
      await sendToContent(tabId, "EXECUTE", {
        action: { type: "press_key", key: "Enter" },
      });
    } catch {
      await sendToContent(tabId, "EXECUTE", {
        action: { type: "click", xpath: GOOGLE_SEARCH_BTN_XPATH },
      });
    }
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
        `Scraped “${keyword}” ${pageLabel}: ${organic} organic, ${ads} ads` +
          (serp?.ai_overview?.available ? ", AI overview" : ""),
        {
          keyword,
          page: pageNum,
          counts: {
            organic,
            ads,
            ai: Boolean(serp?.ai_overview?.available),
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

  const urls = collectOrganicUrls(jobs, {
    maxUrls: Math.min(30, Math.max(8, keywords.length * 5)),
  });
  const summary = formatSerpSummary(jobs);
  await onProgress(
    `Phase 1 done. ${urls.length} organic URL(s) queued for Phase 2 (LLM visits each site).`
  );
  return { jobs, summary, urls };
}

async function dismissConsent(sendToContent, tabId) {
  try {
    await sendToContent(tabId, "EXECUTE", {
      action: { type: "click", css: "button#L2AGLb" },
    });
    await sleep(500);
  } catch {
    /* no consent banner */
  }
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
