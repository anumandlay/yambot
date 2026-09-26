/**
 * @fileoverview Vendored DOM snapshot expression from browser-use/jev-ultrafast (MIT).
 * Purpose: Atomic indexed controls for the TypeSafe operation/target policy.
 * Source: https://github.com/browser-use/jev-ultrafast/blob/main/jev_ultrafast/snapshot.js
 * Downstream: jevUltrafast/browser.js observe().
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, "snapshot.raw.js");

/** @type {string} */
export const SNAPSHOT_JS = fs.readFileSync(rawPath, "utf8").trim();
