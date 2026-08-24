/**
 * @fileoverview Container boot hook — repair Chromium user-data before worker starts.
 * Why: full profile wipe on every boot forces Google/Sheets re-login; reset only when requested.
 */

import { repairChromiumProfile, resetChromiumUserData } from "./browserProfile.js";

const dir = process.env.YAMBOT_PROFILE_DIR || "/data/browser-profile";
if (process.env.YAMBOT_RESET_PROFILE === "1") {
  resetChromiumUserData(dir);
  console.log("[desktop] profile reset (YAMBOT_RESET_PROFILE=1):", dir);
} else {
  repairChromiumProfile(dir);
  console.log("[desktop] profile repaired:", dir);
}
