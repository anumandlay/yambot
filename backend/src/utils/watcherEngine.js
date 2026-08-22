/**
 * @fileoverview Watcher engine — continuous perception polling.
 * Purpose: Check URLs/HTTP endpoints on interval; emit change events when state shifts.
 * Downstream: eventBus, change triggers.
 */

import { Watcher } from "../models/Watcher.js";
import { emitEvent } from "./eventBus.js";
import { fireChangeTriggers } from "./triggerEngine.js";

/**
 * @param {import('mongoose').Document} watcher
 */
async function checkWatcher(watcher) {
  const now = Date.now();
  const intervalMs = Math.max(5, Number(watcher.intervalMinutes) || 30) * 60_000;
  if (watcher.lastCheckedAt && now - new Date(watcher.lastCheckedAt).getTime() < intervalMs) {
    return { changed: false, skipped: true };
  }

  let snapshot = null;
  try {
    if (watcher.targetType === "url" || watcher.targetType === "http") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(watcher.target, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "YamBot-Watcher/1.0" },
      });
      clearTimeout(timer);
      const text = await res.text();
      snapshot = {
        status: res.status,
        hash: simpleHash(text.slice(0, 50_000)),
        length: text.length,
        checkedAt: new Date().toISOString(),
      };
    } else {
      snapshot = { checkedAt: new Date().toISOString(), target: watcher.target };
    }
  } catch (err) {
    snapshot = { error: String(err?.message || err), checkedAt: new Date().toISOString() };
  }

  const prev = watcher.lastSnapshot;
  const changed =
    prev &&
    JSON.stringify(prev) !== JSON.stringify(snapshot) &&
    !snapshot.error;

  watcher.lastSnapshot = snapshot;
  watcher.lastCheckedAt = new Date();
  if (changed) {
    watcher.lastChangeAt = new Date();
    watcher.changeCount = (watcher.changeCount || 0) + 1;
  }
  await watcher.save();

  if (changed) {
    const payload = { watcherId: String(watcher._id), before: prev, after: snapshot };
    await emitEvent({
      userId: watcher.user,
      type: "watcher.change",
      source: "watcher",
      significance: watcher.significance || "medium",
      agentId: watcher.agent,
      summary: `Watcher "${watcher.name}" detected a change`,
      payload,
    });
    await fireChangeTriggers(watcher, payload);
  }

  return { changed: Boolean(changed), skipped: false };
}

/**
 * @param {string} s
 * @returns {number}
 */
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * @returns {Promise<{ checked: number, changed: number }>}
 */
export async function tickWatchers() {
  const watchers = await Watcher.find({ enabled: true }).limit(50);
  let changed = 0;
  for (const watcher of watchers) {
    try {
      const result = await checkWatcher(watcher);
      if (result.changed) changed += 1;
    } catch (err) {
      console.error(`[watcher] ${watcher._id}:`, err?.message || err);
    }
  }
  return { checked: watchers.length, changed };
}
