/**
 * @fileoverview Browser State Engine — Phase 1–2 exports for the cloud worker agent loop.
 * Purpose: Observe → state → diff → act → verify → recover pipeline outside the LLM.
 * Downstream: worker/src/agent.js
 */

export { buildFingerprint, fingerprintScore, findByFingerprint } from "./fingerprints.js";
export { buildPageState, computeStateChange } from "./pageState.js";
export { diffObservations } from "./diff.js";
export { verifyAction, enrichActionResult } from "./verify.js";
export { checkPreconditions, attachFingerprints } from "./preconditions.js";
export { formatStateProjection } from "./format.js";
export { classifyFailure, attachFailureClass, FAILURE_CLASSES } from "./failureClass.js";
export { detectActionLoop, actionKey } from "./loops.js";
export { evaluateStopConditions, formatStopHints } from "./stopConditions.js";
export { runRecoveryLadder, isRecoverableAction } from "./recovery.js";
export { waitForDomSettle, waitForSemantic, executeWaitFor, pollUntilCondition } from "./semanticWait.js";
