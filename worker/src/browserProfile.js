/**
 * @fileoverview Chromium persistent-profile repair helpers for cloud worker containers.
 * Purpose: Clear singleton locks, kill orphan processes, reset corrupted user-data dirs.
 * Downstream: worker agent.js ensureBrowser/recoverBrowser, entrypoint.sh boot reset.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LOCK_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];

/**
 * @param {string} profileDir
 */
export function clearChromiumLocks(profileDir) {
  for (const name of LOCK_FILES) {
    try {
      fs.unlinkSync(path.join(profileDir, name));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Kills headed Chromium processes still bound to this profile (orphans after crash/OOM).
 * Why: launchPersistentContext fails with "opening in existing browser session" and stacks windows on Xvfb.
 * @param {string} profileDir
 */
export async function killChromiumForProfile(profileDir) {
  const dir = String(profileDir || "").trim();
  if (!dir) return;
  // Why: never `pkill -f ${dir}` alone — our boot scripts mention the profile path in argv.
  const patterns = [
    ["pkill", ["-9", "-f", `user-data-dir=${dir}`]],
    ["pkill", ["-9", "-f", `chromium.*user-data-dir=${dir}`]],
    ["pkill", ["-9", "-f", `chrome.*user-data-dir=${dir}`]],
  ];
  for (const [cmd, args] of patterns) {
    try {
      await execFileAsync(cmd, args);
    } catch {
      /* exit 1 when no match */
    }
  }
  clearChromiumLocks(dir);
}

/**
 * Wipes Chromium user-data while keeping agent uploads/downloads.
 * Why: "Something went wrong when opening your profile" needs a clean Default/ tree.
 * @param {string} profileDir
 */
export function resetChromiumUserData(profileDir) {
  const keep = new Set(["uploads", "downloads"]);
  fs.mkdirSync(profileDir, { recursive: true });
  let entries = [];
  try {
    entries = fs.readdirSync(profileDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    try {
      fs.rmSync(path.join(profileDir, entry), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(path.join(profileDir, "Default"), { recursive: true });
  clearChromiumLocks(profileDir);
}

/**
 * Clears session-restore / crash UI state so headed Chromium boots cleanly on Xvfb.
 * @param {string} profileDir
 */
export function repairChromiumProfile(profileDir, opts = {}) {
  const { aggressive = false } = opts;
  clearChromiumLocks(profileDir);

  const defaultDir = path.join(profileDir, "Default");
  const removable = [
    path.join(defaultDir, "Sessions"),
    path.join(defaultDir, "Session Storage"),
    path.join(defaultDir, "Current Session"),
    path.join(defaultDir, "Last Session"),
    path.join(defaultDir, "Current Tabs"),
    path.join(defaultDir, "Last Tabs"),
    path.join(profileDir, "ShaderCache"),
    path.join(profileDir, "GrShaderCache"),
    path.join(profileDir, "Crashpad"),
  ];
  for (const p of removable) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const prefsPath = path.join(defaultDir, "Preferences");
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    /* ignore — fresh profile will be created */
  }

  if (!aggressive) return;
  resetChromiumUserData(profileDir);
}

/**
 * Clears cookies, HTTP caches, and agent downloads without wiping the whole profile
 * (keeps extensions settings, bookmarks if any, and uploads/).
 * Why: Must run while Chromium is stopped — SQLite cookie DBs are locked when open.
 * @param {string} profileDir
 * @returns {{ removed: string[] }}
 */
export function clearCookiesCacheDownloads(profileDir) {
  const removed = [];
  const defaultDir = path.join(profileDir, "Default");
  const fileTargets = [
    path.join(defaultDir, "Cookies"),
    path.join(defaultDir, "Cookies-journal"),
    path.join(defaultDir, "Network", "Cookies"),
    path.join(defaultDir, "Network", "Cookies-journal"),
    path.join(defaultDir, "Network Action Predictor"),
    path.join(defaultDir, "Network Persistent State"),
    path.join(defaultDir, "History"),
    path.join(defaultDir, "History-journal"),
    path.join(defaultDir, "Visited Links"),
  ];
  const dirTargets = [
    path.join(defaultDir, "Cache"),
    path.join(defaultDir, "Code Cache"),
    path.join(defaultDir, "GPUCache"),
    path.join(defaultDir, "Service Worker"),
    path.join(defaultDir, "DawnCache"),
    path.join(profileDir, "ShaderCache"),
    path.join(profileDir, "GrShaderCache"),
    path.join(profileDir, "Component Extension Crx Cache"),
  ];

  for (const p of fileTargets) {
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        removed.push(path.basename(p));
      }
    } catch {
      /* ignore locked/missing */
    }
  }
  for (const p of dirTargets) {
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(path.basename(p));
      }
    } catch {
      /* ignore */
    }
  }

  const downloadsDir = path.join(profileDir, "downloads");
  try {
    if (fs.existsSync(downloadsDir)) {
      for (const entry of fs.readdirSync(downloadsDir)) {
        try {
          fs.rmSync(path.join(downloadsDir, entry), { recursive: true, force: true });
          removed.push(`downloads/${entry}`);
        } catch {
          /* ignore */
        }
      }
    } else {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
  } catch {
    /* ignore */
  }

  clearChromiumLocks(profileDir);
  return { removed };
}

/**
 * Boot-time profile prep: fresh user-data dir (no pkill — nothing is running yet).
 * @param {string} profileDir
 */
export function prepareChromiumProfileForBoot(profileDir) {
  resetChromiumUserData(profileDir);
}
