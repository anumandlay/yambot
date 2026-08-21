/**
 * @fileoverview Extension research Phase 1 — queue YamBot Research API (Python Chrome).
 * Same cloud Chrome scraper as api.py; laptop extension only waits for results then Phase 2.
 */

/**
 * @param {string} goal
 * @param {{ researchMaxPages?: number }} [snapshot]
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

export function formatSerpSummary(jobs) {
  const lines = ["Phase 1 complete — Google SERP results (Python Chrome scraper)."];
  for (const job of jobs) {
    lines.push(`\n## ${job.keyword}`);
    for (const entry of job.pages || []) {
      const [label, page] = Object.entries(entry)[0] || [];
      if (!page) continue;
      const organic = page.organic_results || [];
      lines.push(`- ${label}: ${organic.length} organic`);
      for (const r of organic.slice(0, 8)) {
        lines.push(`  ${r.position}. ${r.title} — ${r.url}`);
      }
    }
  }
  return lines.join("\n");
}

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
 * @param {object} opts
 * @param {(path: string, init?: object) => Promise<any>} opts.api
 */
export async function runResearchPhase1(opts) {
  const { api, goal, agentSnapshot, taskId, shouldStop, onProgress } = opts;
  const { keywords, maxPages } = parseResearchGoal(goal, agentSnapshot || {});
  if (!keywords.length) {
    throw Object.assign(new Error("No keywords in goal"), {
      title: "Research needs keywords",
      detail: "Send keywords in the chat goal.",
    });
  }

  await onProgress(
    `Phase 1: queueing ${keywords.length} keyword(s) for cloud Chrome scraper (api.py-style)…`
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
  if (!jobId) throw new Error("Research job create failed");

  await onProgress(`Research job ${jobId} queued — waiting for Chrome scraper…`);

  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < 45 * 60 * 1000) {
    if (shouldStop()) throw Object.assign(new Error("Stopped"), { cancelled: true });
    await sleep(4000);
    const data = await api(`/api/research/jobs/${jobId}`);
    const job = data?.job;
    if (!job) throw new Error("Research job disappeared");
    if (job.status !== lastStatus) {
      lastStatus = job.status;
      await onProgress(`Chrome scraper: ${job.status}`);
    }
    if (job.status === "completed") {
      const jobs = data.jobs || [];
      const urls = data.urls || [];
      await onProgress(`Phase 1 done. ${urls.length} URL(s) for Phase 2.`);
      return { jobs, summary: formatSerpSummary(jobs), urls, jobId };
    }
    if (job.status === "failed") throw new Error(job.error || "Research scrape failed");
  }
  throw new Error("Research scrape timed out");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
