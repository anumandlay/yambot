/**
 * @fileoverview In-page Google SERP extractors for the cloud worker.
 * Purpose: In-page Google SERP extractors evaluated by Playwright on the cloud worker.
 */

/**
 * Runs inside the browser page.
 * @returns {object}
 */
export function serpCaptureInPage() {
  function extractSponsoredResults() {
    const sponsored = [];
    let position = 0;

    function processAdBlock(block) {
      const link = block.querySelector("a[href]");
      if (!link) return;
      let url = link.getAttribute("href") || "";
      if (!(url.startsWith("/aclk") || url.startsWith("http"))) return;
      position += 1;

      const titleTag =
        [...block.querySelectorAll("div, span")].find((el) =>
          /CCgQ5/.test(el.className || "")
        ) ||
        block.querySelector('[role="heading"]') ||
        link;
      const title = (titleTag?.innerText || "").trim();

      const cite =
        block.querySelector("cite") ||
        [...block.querySelectorAll("span")].find((el) => /VuuXrf/.test(el.className || ""));
      const displayUrl = (cite?.innerText || "").trim();

      const snippetTag = [...block.querySelectorAll("div")].find((el) =>
        /MUxGbd|yDYNvb/.test(el.className || "")
      );
      const snippet = (snippetTag?.innerText || "").replace(/\s+/g, " ").trim();

      if (url.startsWith("/aclk")) {
        try {
          const u = new URL(url, location.origin);
          url = u.searchParams.get("adurl") || url;
        } catch {
          /* keep */
        }
      }

      sponsored.push({
        position,
        title,
        url,
        site_name: displayUrl.split(/\s+/)[0] || "",
        display_url: displayUrl,
        snippet,
      });
    }

    const tads = document.querySelector("#tads");
    if (tads) {
      const blocks = [...tads.querySelectorAll("div")].filter((el) =>
        /uEierd/.test(el.className || "")
      );
      const list = blocks.length
        ? blocks
        : [...tads.children].filter((n) => n.tagName === "DIV");
      for (const block of list) processAdBlock(block);
    }

    const tadsb = document.querySelector("#tadsb");
    if (tadsb) {
      for (const block of [...tadsb.children].filter((n) => n.tagName === "DIV")) {
        processAdBlock(block);
      }
    }

    return sponsored;
  }

  function extractAiOverview() {
    const aiData = { available: false, heading: "", sections: [], sources: [] };
    const notAvailable = document.querySelector('span[jsname="lGsj1"]');
    if (notAvailable && !/display:\s*none/i.test(notAvailable.getAttribute("style") || "")) {
      return aiData;
    }

    let aiContainer =
      document.querySelector('[id^="B2Jtyd"]') ||
      [...document.querySelectorAll("div")].find((el) => /EyBRub/.test(el.className || ""));

    if (!aiContainer) return aiData;

    const headingTag = aiContainer.querySelector(".cUzNTd, .Fzsovc");
    if (headingTag) aiData.heading = headingTag.innerText.trim();

    if (!aiData.heading) {
      for (const tag of aiContainer.querySelectorAll("div, span")) {
        const txt = tag.innerText.trim();
        if (/^ai overviews?$/i.test(txt)) {
          aiData.heading = txt;
          break;
        }
      }
    }
    if (!aiData.heading) return aiData;
    aiData.available = true;

    for (const block of aiContainer.querySelectorAll("div.n6owBd")) {
      const text = block.innerText.replace(/\s+/g, " ").trim();
      if (text) aiData.sections.push({ type: "text", content: text });
    }

    const seen = new Set();
    for (const link of aiContainer.querySelectorAll("a.muU3oe")) {
      const href = link.getAttribute("href") || "";
      if (href && !seen.has(href)) {
        seen.add(href);
        aiData.sources.push(href);
      }
    }
    return aiData;
  }

  function extractPeopleAlsoSearchFor() {
    const pasf = { available: false, heading: "", results: [] };
    const bres = document.querySelector("#bres");
    if (!bres) return pasf;
    const headingTag = [...bres.querySelectorAll("span, div")].find((el) =>
      /mgAbYb/.test(el.className || "")
    );
    if (headingTag) pasf.heading = headingTag.innerText.replace(/\s+/g, " ").trim();
    const seen = new Set();
    let position = 0;
    for (const card of [...bres.querySelectorAll("a")].filter((a) =>
      /ngTNl/.test(a.className || "")
    )) {
      const href = card.getAttribute("href") || "";
      if (!href) continue;
      const textTag = [...card.querySelectorAll("span")].find((el) =>
        /dg6jd/.test(el.className || "")
      );
      const query = (textTag?.innerText || "").replace(/\s+/g, " ").trim();
      if (!query || seen.has(query)) continue;
      seen.add(query);
      position += 1;
      pasf.results.push({
        position,
        query,
        url: href.startsWith("http") ? href : `https://www.google.com${href}`,
      });
    }
    if (pasf.results.length) pasf.available = true;
    return pasf;
  }

  function extractOrganicResults() {
    const allData = [];
    const results = [...document.querySelectorAll("div")].filter((el) =>
      /tF2Cxc/.test(el.className || "")
    );
    for (let idx = 0; idx < results.length && allData.length < 50; idx++) {
      const result = results[idx];
      const linkTag = result.querySelector("a[href]");
      let url = linkTag?.getAttribute("href") || "";
      if (url.startsWith("/url?")) {
        try {
          url = new URL(url, location.origin).searchParams.get("q") || url;
        } catch {
          /* keep */
        }
      }
      const title = (result.querySelector("h3")?.innerText || "").trim();
      const siteTag = [...result.querySelectorAll("span")].find((el) =>
        /VuuXrf/.test(el.className || "")
      );
      const citeTag = result.querySelector("cite");
      const snippetTag = result.querySelector("div.VwiC3b");
      let snippet = "";
      if (snippetTag) {
        const clone = snippetTag.cloneNode(true);
        clone.querySelectorAll("a").forEach((a) => a.remove());
        snippet = clone.innerText.replace(/\s+/g, " ").trim();
      }
      if (title && url) {
        allData.push({
          position: allData.length + 1,
          url,
          title,
          site_name: (siteTag?.innerText || "").trim(),
          display_url: (citeTag?.innerText || "").replace(/\s+/g, " ").trim(),
          snippet,
        });
      }
    }
    return allData;
  }

  return {
    url: location.href,
    title: document.title,
    ai_overview: extractAiOverview(),
    sponsored_results: extractSponsoredResults(),
    organic_results: extractOrganicResults(),
    people_also_search_for: extractPeopleAlsoSearchFor(),
    via: "worker",
  };
}

/**
 * Runs inside the browser page.
 * @returns {{ clicked: boolean }}
 */
export function clickNextSerpInPage() {
  const next =
    document.querySelector("#pnnext") ||
    document.querySelector('a[aria-label="Next page"]') ||
    document.querySelector('a[aria-label="Next"]');
  if (!next) return { clicked: false };
  next.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  next.click();
  return { clicked: true };
}
