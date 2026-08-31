/**
 * @fileoverview BOS proof API — run end-to-end + hardening + LIVE_BOS scenarios.
 * Purpose: Prove Workflow + handoff + heal + CEO + pulse; harden waits/events/guards; live probes.
 * Downstream: Command Center proof buttons.
 */

import { Router } from "express";
import { runBosProofSuite, cleanupProofFixtures } from "../utils/bosProofs.js";
import { runHardenProofSuite } from "../utils/hardenProofs.js";
import { runLiveBosSuite, formatLiveBosReportText } from "../utils/liveBos.js";
import { writeAudit } from "../utils/audit.js";

export const proofsRouter = Router();

/**
 * POST /api/proofs/run — execute BOS, harden, and/or LIVE_BOS proofs.
 * Body: { cleanup?: boolean, suite?: "bos"|"harden"|"live"|"all" }
 * Note: suite=all runs bos+harden only (sandbox). Use suite=live for LIVE_BOS scaffold/probes.
 */
proofsRouter.post("/run", async (req, res, next) => {
  try {
    const suite = String(req.body?.suite || "all").toLowerCase();
    const cleanup = req.body?.cleanup === true;
    /** @type {object[]} */
    const results = [];
    let ok = true;
    let proofId = "";

    if (suite === "live") {
      const liveReport = await runLiveBosSuite(req.userId);
      await writeAudit({
        userId: req.userId,
        action: "proofs.live_bos_run",
        detail: formatLiveBosReportText(liveReport).slice(0, 500),
        meta: {
          proofId: liveReport.proofId,
          ok: liveReport.ok,
          summary: liveReport.summary,
          enabled: liveReport.enabled,
        },
      }).catch(() => {});
      res.status(liveReport.ok ? 200 : 422).json(liveReport);
      return;
    }

    if (suite === "bos" || suite === "all") {
      const bos = await runBosProofSuite(req.userId, { cleanup: false });
      results.push(...(bos.results || []));
      ok = ok && bos.ok;
      proofId = bos.proofId || proofId;
    }
    if (suite === "harden" || suite === "all") {
      const harden = await runHardenProofSuite(req.userId, { cleanup: false });
      results.push(...(harden.results || []));
      ok = ok && harden.ok;
      proofId = proofId || harden.proofId;
    }

    if (cleanup) {
      await cleanupProofFixtures(req.userId).catch(() => {});
      const { WorkflowDefinition } = await import("../models/WorkflowDefinition.js");
      const { Goal } = await import("../models/Goal.js");
      await WorkflowDefinition.deleteMany({ user: req.userId, name: { $regex: "bos_harden" } });
      await Goal.deleteMany({ user: req.userId, title: { $regex: "bos_harden" } });
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const payload = {
      ok,
      proofId,
      suite,
      summary: { passed, failed, total: results.length },
      results,
      auditedAt: new Date().toISOString(),
    };

    await writeAudit({
      userId: req.userId,
      action: "proofs.bos_run",
      detail: `${passed}/${results.length} passed (${suite})`,
      meta: { proofId, ok, suite },
    }).catch(() => {});

    res.status(ok ? 200 : 422).json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/proofs/cleanup — remove bos_proof fixtures.
 */
proofsRouter.post("/cleanup", async (req, res, next) => {
  try {
    const result = await cleanupProofFixtures(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
