/**
 * @fileoverview Unified observation pipeline — DOM + frames + a11y + telemetry.
 * Purpose: Single observe call for the agent loop (Phase 4 platform layer).
 * Downstream: worker/src/agent.js
 */

import { attachFingerprints } from "./preconditions.js";
import { captureA11ySnapshot } from "./a11y.js";

/**
 * @param {string} ref
 * @returns {{ frameId: string, localRef: string }}
 */
export function parseFrameRef(ref) {
  const m = /^(frame_\d+)_(e\d+)$/.exec(String(ref || ""));
  if (m) return { frameId: m[1], localRef: m[2] };
  return { frameId: "main", localRef: String(ref || "") };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} [frameId]
 * @returns {import('playwright').Frame}
 */
export function getPlaywrightFrame(page, frameId) {
  if (!frameId || frameId === "main") return page.mainFrame();
  const n = Number(String(frameId).replace("frame_", ""));
  const children = page.frames().filter((f) => f !== page.mainFrame());
  if (Number.isFinite(n) && n > 0 && children[n - 1]) return children[n - 1];
  return page.mainFrame();
}

/**
 * Full page observation: main DOM, child frames, and a11y snapshot.
 * @param {import('playwright').Page} page
 * @param {Function} observeFn - Serialized observeInPage.
 * @returns {Promise<object>}
 */
export async function observePageFull(page, observeFn) {
  const main = attachFingerprints(await page.evaluate(observeFn));
  main.frameId = "main";

  const frames = [];
  const frameInteractives = [...(main.interactives || [])];

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameUrl = safeFrameUrl(frame);
    let frameId = `frame_${frames.length + 1}`;
    try {
      const partial = attachFingerprints(await frame.evaluate(observeFn));
      frameId = partial.frameId || frameId;
      const prefixed = (partial.interactives || []).map((item, i) => ({
        ...item,
        ref: `${frameId}_${item.ref}`,
        frameId,
        frameUrl,
      }));
      frameInteractives.push(...prefixed);
      frames.push({
        frameId,
        url: frameUrl,
        title: partial.title,
        interactive_count: prefixed.length,
        cross_origin: false,
      });
    } catch {
      frames.push({
        frameId,
        url: frameUrl,
        cross_origin: true,
        note: "Cannot access DOM — use frame selector if payment iframe",
      });
    }
  }

  const a11y = await captureA11ySnapshot(page);

  return {
    ...main,
    interactives: frameInteractives,
    interactiveCount: frameInteractives.length,
    frames,
    a11y,
  };
}

/**
 * @param {import('playwright').Frame} frame
 * @returns {string}
 */
function safeFrameUrl(frame) {
  try {
    return frame.url();
  } catch {
    return "";
  }
}
