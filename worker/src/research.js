/**
 * @fileoverview Research Phase 1 via YamBot Research API + Python Chrome scraper.
 * Purpose: Queue a job (like api.py /keywords); cloud research-scraper (real Chrome + CDP)
 * scrapes google.com by typing into the search box; we poll until done, then Phase 2 LLM.
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
 */
export function formatSerpSummary(jobs) {
  const lines = ["Phase 1 complete — Google SERP results (Python Chrome scraper)."];
  for (const job of jobs) {
    lines.push(`\n## ${job.keyword}`);
    for (const entry of job.pages || []) {
      const [label, page] = Object.entries(entry)[0] || [];
      if (!page) continue;
      const organic = page.organic_results || [];
      const ads = page.sponsored_results || [];
      lines.push(
        `- ${label}: ${organic.length} organic, ${ads.length} ads, AI overview: ${
          page.ai_overview?.available ? "yes" : "no"
        }`
      );
      for (const r of organic.slice(0, 8)) {
        lines.push(`  ${r.position}. ${r.title} — ${r.url}`);
      }
    }
  }
  return lines.join("\n");
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
    "Phase 1 already collected Google results via the cloud Chrome research scraper. Do NOT search Google again unless needed.",
    `ORIGINAL USER GOAL:\n${originalGoal}`,
    "Visit each site below IN ORDER. Extract facts relevant to the goal, then move on.",
    "When finished, call finish with a structured research summary.",
    "SITES TO VISIT:",
    list || "(no organic URLs — report that and finish)",
  ].join("\n\n");
}

/**
 * Queue + wait for Python Chrome scraper (api.py-style).
 * @param {object} opts
 * @param {(path: string, init?: RequestInit) => Promise<any>} opts.api
 * @param {string} opts.goal
 * @param {object|null} opts.agentSnapshot
 * @param {string} [opts.taskId]
 * @param {() => Promise<boolean>|boolean} opts.shouldStop
 * @param {(msg: string, payload?: object) => void | Promise<void>} opts.onProgress
 */
export async function runCloudResearchPhase1(opts) {
  const { api, goal, agentSnapshot, taskId, shouldStop, onProgress } = opts;
  const { keywords, maxPages } = parseResearchGoal(goal, agentSnapshot || {});
  if (!keywords.length) {
    throw Object.assign(new Error("No keywords in goal"), {
      title: "Research needs keywords",
      detail:
        "Send keywords in the chat goal, e.g. `visa for canada` or `keywords: a, b pages:5`.",
    });
  }

  await onProgress(
    `Phase 1: queueing ${keywords.length} keyword(s) for cloud Chrome scraper (real Chrome, like your api.py)…`
  );

  const created = await api("/api/research/jobs", {
    method: "POST",
    body: JSON.stringify({
      keywords,
      maxPages,
      goal,
      taskId: taskId || undefined,
      agentId: agentSnapshot?.id || undefined,
    }),
  });
  const jobId = created?.job?.id;
  if (!jobId) throw new Error("Research job create failed (no id)");

  await onProgress(`Research job ${jobId} queued — waiting for Chrome scraper…`);

  const started = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  let lastStatus = "";

  while (Date.now() - started < timeoutMs) {
    if (await shouldStop()) {
      throw Object.assign(new Error("Stopped by user"), { cancelled: true });
    }
    await sleep(4000);
    const data = await api(`/api/research/jobs/${jobId}`);
    const job = data?.job;
    if (!job) throw new Error("Research job disappeared");

    if (job.status !== lastStatus) {
      lastStatus = job.status;
      const doneKw = (job.keywords || []).filter((k) => k.status === "completed").length;
      await onProgress(
        `Chrome scraper: ${job.status} (${doneKw}/${(job.keywords || []).length} keywords done)`
      );
    }

    if (job.status === "completed") {
      const jobs = data.jobs || [];
      const urls = data.urls || [];
      const summary = formatSerpSummary(jobs);
      await onProgress(
        `Phase 1 done via Python Chrome. ${urls.length} URL(s) for Phase 2.`
      );
      return { jobs, summary, urls, jobId };
    }
    if (job.status === "failed") {
      throw new Error(job.error || "Research scrape failed");
    }
  }

  throw new Error("Research scrape timed out waiting for Chrome scraper");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
