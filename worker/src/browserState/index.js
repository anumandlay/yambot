/**
 * @fileoverview Browser State Engine — Phase 1–3 exports for the cloud worker agent loop.
 * Purpose: Observe → plan → state → diff → act → verify → recover pipeline outside the LLM.
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
export { scoreInteractives, filterByRelevance } from "./relevance.js";
export { formatStructuresBlock, buildStructuresFromObs } from "./structures.js";
export { computeGoalProgress, formatProgressBlock } from "./progress.js";
export {
  createGoalPlan,
  defaultPlan,
  formatPlanBlock,
  getCurrentSubgoalTitle,
  updatePlanFromObservation,
} from "./planner.js";
export { createBrowserTelemetry, formatTelemetryBlock } from "./telemetry.js";
export { captureA11ySnapshot, formatA11yBlock, flattenA11yLines } from "./a11y.js";
export {
  shouldAttachVision,
  captureViewportBase64,
  buildVisionUserContent,
} from "./vision.js";
export { listTabs, switchTab, openTab } from "./tabs.js";
export { observePageFull, parseFrameRef, getPlaywrightFrame } from "./observe.js";
