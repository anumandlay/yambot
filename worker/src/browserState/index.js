/**
 * @fileoverview Browser State Engine — Phase 1–5 exports for the cloud worker agent loop.
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
export {
  evaluateBlockedSubgoal,
  buildPartialResultSummary,
  BLOCKED_SUBGOAL_WARN_AFTER,
  BLOCKED_SUBGOAL_FINISH_AFTER,
} from "./blockedSubgoal.js";
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
export {
  listTabs,
  switchTab,
  openTab,
  closeTab,
  enforceTabLimit,
  consolidateTabs,
  pickBestActivePage,
  selectBestPageAfterHandoff,
  pruneBlankTabsIfProductive,
  mergeBestTabIntoMain,
  waitForPageHttpUrl,
  enforceSinglePage,
  navigateInPlace,
  scorePageUrl,
  safePageUrl,
  MAX_TABS,
} from "./tabs.js";
export { observePageFull, parseFrameRef, getPlaywrightFrame } from "./observe.js";
export { runFillForm, runDismissDialog, runChooseMenuItem } from "./macros.js";
export {
  detectSkill,
  formatSkillBlock,
  formatSkillsCatalogBlock,
  computeSkillProgress,
  formatSkillProgressBlock,
  detectDbSkill,
  detectDbSkillMatch,
  formatDbSkillBlock,
  computeDbSkillProgress,
  evaluateSkillVerification,
  normalizeSkillSteps,
  SKILL_TEMPLATES,
} from "./skills.js";
export { runSkillReplay, describeReplayStep, extractReplayableSteps } from "./skillReplay.js";
export {
  extractDomain,
  buildTrajectory,
  formatSiteHintsBlock,
  loadSiteProfile,
  deriveSiteHint,
  recordSiteLearning,
  summarizeSessionContext,
  sessionCredentialsForAsk,
} from "./learn.js";
