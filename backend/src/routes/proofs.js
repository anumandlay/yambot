/**
 * @fileoverview BOS proof API — run end-to-end + hardening scenarios for the signed-in account.
 * Purpose: Prove Workflow + handoff + heal + CEO + pulse; harden waits/events/guards/security.
 * Downstream: Command Center “Run BOS proofs”.
 */

import { Router } from "express";
import { runBosProofSuite, cleanupProofFixtures } from "../utils/bosProofs.js";
import { runHardenProofSuite } from "../utils/hardenProofs.js";
import { writeAudit } from "../utils/audit.js";

export const proofsRouter = Router();

/**
 * POST /api/proofs/run — execute BOS and/or harden proofs.
 * Body: { cleanup?: boolean, suite?: "bos"|"harden"|"all" }
 */
proofsRouter.post("/run", async (req, res, next) => {
  try {
    const suite = String(req.body?.suite || "all").toLowerCase();
    const cleanup = req.body?.cleanup === true;
    /** @type {object[]} */
    const results = [];
    let ok = true;
    let proofId = "";

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
