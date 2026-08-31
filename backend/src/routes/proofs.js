/**
 * @fileoverview BOS proof API — run the five end-to-end scenarios for the signed-in account.
 * Purpose: Prove Workflow + handoff + heal + CEO + pulse without adding product features.
 * Downstream: Command Center “Run BOS proofs”.
 */

import { Router } from "express";
import { runBosProofSuite, cleanupProofFixtures } from "../utils/bosProofs.js";
import { writeAudit } from "../utils/audit.js";

export const proofsRouter = Router();

/**
 * POST /api/proofs/run — execute all five BOS proofs.
 * Body: { cleanup?: boolean }
 */
proofsRouter.post("/run", async (req, res, next) => {
  try {
    const result = await runBosProofSuite(req.userId, {
      cleanup: req.body?.cleanup === true,
    });
    await writeAudit({
      userId: req.userId,
      action: "proofs.bos_run",
      detail: `${result.summary.passed}/${result.summary.total} passed`,
      meta: { proofId: result.proofId, ok: result.ok },
    }).catch(() => {});
    res.status(result.ok ? 200 : 422).json(result);
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
