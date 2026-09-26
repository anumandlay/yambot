/**
 * @fileoverview Playwright observe/act for Jev Ultrafast (no Browser Harness).
 * Purpose: Run upstream snapshot.js + execute chosen actions on the live YamBot Chrome.
 * Downstream: run.js.
 */

import { createHash } from "node:crypto";
import { SNAPSHOT_JS } from "./snapshot.js";

/**
 * @param {object} state
 * @returns {string}
 */
export function fingerprint(state) {
  const content = {
    url: state.url,
    text: state.text,
    actions: state.actions,
    scroll: state.scroll,
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<object>}
 */
export async function observe(page) {
  const info = await page.evaluate(SNAPSHOT_JS);
  if (!info) {
    throw Object.assign(new Error("Document is navigating"), { code: "stale_page" });
  }
  info.fingerprint = fingerprint(info);
  return info;
}

/**
 * @param {import('playwright').Page} page
 * @param {object} pageState
 * @param {number|null} [node]
 * @returns {Promise<boolean>}
 */
export async function isFresh(page, pageState, node = null) {
  if (node != null) {
    const current = await page.evaluate((n) => {
      const c = window.__jevFast;
      return c ? [c.pageKey(), c.guard(c.nodes.get(n))] : null;
    }, node);
    const expected = [pageState.page_key, pageState.guards?.[String(node)]];
    return JSON.stringify(current) === JSON.stringify(expected);
  }
  const marker = await page.evaluate(() => {
    const state = (() => {
      /* re-check marker only */
      return window.__jevFast ? true : false;
    })();
    void state;
    // Why: re-run full snapshot marker compare via cached pageKey + title/text length.
    const c = window.__jevFast;
    if (!c?.pageKey) return null;
    return JSON.stringify([
      performance.timeOrigin,
      location.href,
      scrollX,
      scrollY,
      innerWidth,
      innerHeight,
      document.title,
    ]);
  });
  // Lightweight freshness: URL + scroll + title must match last observe marker prefix.
  const expected = JSON.stringify([
    pageState.marker?.[0],
    pageState.marker?.[1],
    pageState.marker?.[2],
    pageState.marker?.[3],
    pageState.marker?.[4],
    pageState.marker?.[5],
    pageState.marker?.[6],
  ]);
  return marker === expected;
}

/**
 * Execute one observed action on the live page.
 * @param {import('playwright').Page} page
 * @param {object} action
 * @param {object} pageState
 * @param {string|null} [text]
 */
export async function act(page, action, pageState, text = null) {
  const kind = action.kind;
  if (kind === "wait") {
    await page.waitForTimeout(100);
    return { executed: action.id };
  }
  if (kind === "scroll") {
    await page.mouse.wheel(0, Number(action.delta) || 560);
    await page.waitForTimeout(50);
    return { executed: action.id };
  }

  const fresh = await isFresh(page, pageState, action.node);
  if (!fresh) {
    throw Object.assign(new Error("Page changed since this decision. Observe again."), {
      code: "stale_page",
    });
  }

  const hit = await page.evaluate(
    ({ node, kind: k, value }) => {
      const e = window.__jevFast?.nodes.get(node);
      if (
        !e?.isConnected ||
        e.matches(":disabled") ||
        e.closest('[aria-disabled="true"],[inert]') ||
        !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      ) {
        return null;
      }
      if (k === "fill" && (e.readOnly || e.getAttribute("aria-readonly") === "true")) {
        return null;
      }
      const r = e.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        return null;
      }
      if (!e.contains(document.elementFromPoint(x, y))) return null;
      if (k === "select") {
        if (
          e.tagName !== "SELECT" ||
          ![...e.options].some(
            (o) =>
              o.value === value && !o.disabled && !o.closest("optgroup[disabled]")
          )
        ) {
          return null;
        }
        e.value = value;
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
        return { x, y, selected: true };
      }
      return { x, y, selected: false };
    },
    { node: action.node, kind, value: action.value }
  );

  if (!hit) {
    throw Object.assign(new Error("Target changed or is covered. Observe again."), {
      code: "stale_page",
    });
  }

  if (kind === "select") {
    return { executed: action.id };
  }

  await page.mouse.click(hit.x, hit.y);
  if (kind === "fill") {
    // Select-all then insert (parity with upstream Input.insertText path).
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(mod);
    await page.keyboard.press("a");
    await page.keyboard.up(mod);
    await page.keyboard.insertText(String(text || ""));
    // Why: combobox suggestions need a short settle; other fills ~50ms.
    const isCombo = String(action.role || "") === "combobox";
    await page.waitForTimeout(isCombo ? 200 : 50);
  } else {
    await page.waitForTimeout(50);
  }
  return { executed: action.id };
}
