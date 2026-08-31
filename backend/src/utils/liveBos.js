/**
 * @fileoverview LIVE_BOS controlled real end-to-end validation harness.
 * Purpose: Prove YamBot runtime against a TEST_ONLY tenant — not sandbox remaps labeled as live.
 * Downstream: `npm run test:live-bos`, POST /api/proofs/run suite=live, Command Center.
 *
 * Status vocabulary (strict):
 *   PASS | FAIL | BLOCKED | NOT_IMPLEMENTED
 * Sandbox BOS/harden suites remain separate (unchanged 14 proofs).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceBag, redactSecrets } from "./liveBosEvidence.js";
import {
  assertTestOnlyMode,
  ensureLiveBosUser,
  provisionLiveTenant,
  cleanupLiveFixtures,
  LIVE_TAG,
} from "./liveBosTenant.js";
import * as scenarios from "./liveBosScenarios.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} filePath
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

/**
 * @returns {object}
 */
export function loadLiveBosConfig() {
  const backendRoot = path.resolve(__dirname, "../..");
  loadEnvFile(path.join(backendRoot, ".live-bos.env"));
  loadEnvFile(path.join(backendRoot, ".env.local"));

  const enabled =
    String(process.env.LIVE_BOS || "").trim() === "1" ||
    String(process.env.LIVE_BOS || "").toLowerCase() === "true";

  const testOnly =
    process.env.LIVE_BOS_TEST_ONLY == null ||
    process.env.LIVE_BOS_TEST_ONLY === "" ||
    String(process.env.LIVE_BOS_TEST_ONLY).trim() === "1" ||
    String(process.env.LIVE_BOS_TEST_ONLY).toLowerCase() === "true";

  const allowProduction =
    String(process.env.LIVE_BOS_ALLOW_PRODUCTION || "").trim() === "1";

  const api = {
    baseUrl: String(process.env.LIVE_BOS_API_BASE_URL || "").replace(/\/$/, ""),
    key: String(process.env.LIVE_BOS_API_KEY || ""),
    getPath: String(process.env.LIVE_BOS_API_GET_PATH || "/users"),
    postPath: String(process.env.LIVE_BOS_API_POST_PATH || "/posts"),
  };
  const mail = {
    imapHost: String(process.env.LIVE_BOS_IMAP_HOST || ""),
    imapPort: Number(process.env.LIVE_BOS_IMAP_PORT) || 993,
    user: String(process.env.LIVE_BOS_IMAP_USER || ""),
    pass: String(process.env.LIVE_BOS_IMAP_PASS || ""),
    smtpHost: String(process.env.LIVE_BOS_SMTP_HOST || process.env.LIVE_BOS_IMAP_HOST || ""),
    smtpPort: Number(process.env.LIVE_BOS_SMTP_PORT) || 587,
  };
  const browser = {
    url: String(process.env.LIVE_BOS_BROWSER_URL || ""),
    user: String(process.env.LIVE_BOS_BROWSER_USER || ""),
    pass: String(process.env.LIVE_BOS_BROWSER_PASS || ""),
  };
  const allowCrash =
    String(process.env.LIVE_BOS_ALLOW_CRASH || "").trim() === "1" ||
    String(process.env.LIVE_BOS_ALLOW_CRASH || "").toLowerCase() === "true";
  const allowMailMutation =
    String(process.env.LIVE_BOS_ALLOW_MAIL_MUTATION || "").trim() === "1" ||
    String(process.env.LIVE_BOS_ALLOW_MAIL_MUTATION || "").toLowerCase() === "true";
  const customerEmail = String(
    process.env.LIVE_BOS_CUSTOMER_EMAIL || mail.user || ""
  )
    .trim()
    .toLowerCase();
  const browserWaitMs = Number(process.env.LIVE_BOS_BROWSER_WAIT_MS) || 12_000;

  /** @type {string[]} */
  const missing = [];
  if (!enabled) missing.push("LIVE_BOS=1");
  if (!api.baseUrl) missing.push("LIVE_BOS_API_BASE_URL");
  if (!mail.imapHost || !mail.user || !mail.pass) missing.push("LIVE_BOS_IMAP_HOST/USER/PASS");

  return {
    enabled,
    testOnly,
    allowProduction,
    api,
    mail,
    browser,
    allowCrash,
    allowMailMutation,
    customerEmail,
    browserWaitMs,
    missing,
  };
}

const LIVE_CASES = [
  { id: "live_real_email", name: "REAL EMAIL send→IMAP→email.replied", run: scenarios.scenarioRealEmail },
  {
    id: "live_real_handoff",
    name: "REAL multi-agent handoff (email.replied→Agent B)",
    run: scenarios.scenarioRealHandoff,
  },
  {
    id: "live_real_api_workflow",
    name: "REAL API WorkflowRunner GET→map→POST→verify",
    run: scenarios.scenarioRealApiWorkflow,
  },
  { id: "live_real_scheduler", name: "REAL scheduler → Task enqueue", run: scenarios.scenarioRealScheduler },
  {
    id: "live_real_browser",
    name: "REAL browser worker claim/run",
    run: scenarios.scenarioRealBrowser,
  },
  {
    id: "live_real_crash_recovery",
    name: "REAL durable crash/resume (wakeAt)",
    run: scenarios.scenarioRealCrashRecovery,
  },
  { id: "live_real_approval", name: "REAL approval→resume", run: scenarios.scenarioRealApproval },
  {
    id: "live_real_events",
    name: "REAL event dedupe+DLQ+replay",
    run: scenarios.scenarioRealEvents,
  },
  {
    id: "live_real_attribution",
    name: "REAL attribution + causal memory",
    run: scenarios.scenarioRealAttribution,
  },
];

/**
 * @param {string|null} _userIdIgnored — LIVE_BOS uses dedicated TEST_ONLY tenant
 * @param {{ cleanup?: boolean }} [opts]
 */
export async function runLiveBosSuite(_userIdIgnored = null, opts = {}) {
  const cfg = loadLiveBosConfig();
  const proofId = Date.now().toString(36);
  const bag = createEvidenceBag();
  /** @type {object[]} */
  const results = [];

  if (!cfg.enabled) {
    for (const c of LIVE_CASES) {
      results.push({
        id: c.id,
        name: c.name,
        status: "BLOCKED",
        detail: "LIVE_BOS disabled — set LIVE_BOS=1 in backend/.live-bos.env",
        passed: false,
        ms: 0,
      });
    }
    return formatReport(proofId, results, cfg, bag, {
      reason: "Enable LIVE_BOS=1 with TEST_ONLY tenant credentials.",
    });
  }

  try {
    assertTestOnlyMode(cfg);
  } catch (err) {
    for (const c of LIVE_CASES) {
      results.push({
        id: c.id,
        name: c.name,
        status: "FAIL",
        detail: err.message,
        passed: false,
        ms: 0,
      });
    }
    return formatReport(proofId, results, cfg, bag, { reason: err.message });
  }

  const user = await ensureLiveBosUser();
  const userId = String(user._id);
  let tenant;
  try {
    tenant = await provisionLiveTenant(userId, cfg);
  } catch (err) {
    for (const c of LIVE_CASES) {
      results.push({
        id: c.id,
        name: c.name,
        status: "FAIL",
        detail: `Tenant provision failed: ${err.message}`,
        passed: false,
        ms: 0,
      });
    }
    return formatReport(proofId, results, cfg, bag, { reason: err.message });
  }

  const ctx = { cfg, tenant, proofId, userId };

  for (const c of LIVE_CASES) {
    const row = bag.start(c.id, c.name);
    const started = Date.now();
    try {
      const out = await c.run(ctx);
      bag.finish(row, out.status, out.detail, out.evidence || {});
      results.push({
        id: c.id,
        name: c.name,
        status: out.status,
        detail: out.detail,
        passed: out.status === "PASS",
        ms: Date.now() - started,
        evidence: redactSecrets(out.evidence || {}),
      });
    } catch (err) {
      bag.finish(row, "FAIL", err?.message || String(err));
      results.push({
        id: c.id,
        name: c.name,
        status: "FAIL",
        detail: err?.message || String(err),
        passed: false,
        ms: Date.now() - started,
      });
    }
  }

  if (opts.cleanup) {
    await cleanupLiveFixtures(userId).catch(() => {});
  }

  return formatReport(proofId, results, cfg, bag, {});
}

/**
 * @param {string} proofId
 * @param {object[]} results
 * @param {object} cfg
 * @param {ReturnType<typeof createEvidenceBag>} bag
 * @param {object} meta
 */
function formatReport(proofId, results, cfg, bag, meta = {}) {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const notImplemented = results.filter((r) => r.status === "NOT_IMPLEMENTED").length;
  const ok = failed === 0;
  return {
    ok,
    suite: "live",
    proofId,
    liveTag: LIVE_TAG,
    enabled: cfg.enabled,
    testOnly: cfg.testOnly,
    reason: meta.reason || "",
    configHint: redactSecrets({
      hasApi: Boolean(cfg.api.baseUrl),
      hasMail: Boolean(cfg.mail.imapHost && cfg.mail.user),
      hasBrowser: Boolean(cfg.browser.url),
      allowMailMutation: cfg.allowMailMutation,
      allowCrash: cfg.allowCrash,
      missing: cfg.missing,
    }),
    summary: {
      passed,
      failed,
      blocked,
      notImplemented,
      total: results.length,
      // legacy fields for UI
      skipped: blocked + notImplemented,
    },
    results,
    evidence: bag.all(),
    matrix: {
      api: statusOf(results, "live_real_api_workflow"),
      mailbox: statusOf(results, "live_real_email"),
      browser: statusOf(results, "live_real_browser"),
      scheduler: statusOf(results, "live_real_scheduler"),
      trigger_handoff: statusOf(results, "live_real_handoff"),
      approval: statusOf(results, "live_real_approval"),
      crash_recovery: statusOf(results, "live_real_crash_recovery"),
      events: statusOf(results, "live_real_events"),
      attribution: statusOf(results, "live_real_attribution"),
    },
    sandboxBosNote: "Sandbox BOS+harden remain at npm run test:bos (14 proofs) — separate from LIVE_BOS.",
    auditedAt: new Date().toISOString(),
  };
}

/**
 * @param {object[]} results
 * @param {string} id
 */
function statusOf(results, id) {
  return results.find((r) => r.id === id)?.status || "NOT_IMPLEMENTED";
}

/**
 * @param {Awaited<ReturnType<typeof runLiveBosSuite>>} report
 */
export function formatLiveBosReportText(report) {
  const lines = [
    `LIVE_BOS ${report.enabled ? "ENABLED" : "DISABLED"} TEST_ONLY=${report.testOnly} — ${
      report.ok ? "OK(no FAIL)" : "HAS FAILURES"
    }`,
    `PASS=${report.summary.passed} FAIL=${report.summary.failed} BLOCKED=${report.summary.blocked} NOT_IMPLEMENTED=${report.summary.notImplemented} total=${report.summary.total}`,
    report.sandboxBosNote || "",
  ];
  if (report.reason) lines.push(report.reason);
  if (report.matrix) {
    lines.push("MATRIX:");
    for (const [k, v] of Object.entries(report.matrix)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  for (const r of report.results || []) {
    lines.push(`  ${r.status} ${r.id}: ${r.detail || ""}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** Re-export cleanup for tests */
export { cleanupLiveFixtures, ensureLiveBosUser };
