# PROMPT_LOG.md

## [2026-08-24 09:30] Fix about:blank resets during page navigation

- **Prompt Provided:** Page resets to about:blank most of the time when changing pages — why?
- **Architectural Flow:** Treat mid-navigation errors as transient (no full Chromium relaunch); skip heavy health checks while agent task is running; restore lastKnownPageUrl after relaunch; wait for popup URLs before single-tab merge
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/browserState/tabs.js`

## [2026-08-24 08:50] Fix ask_user loop after login confirmation STOP

- **Prompt Provided:** Step 2 ask_user for Vughy login, then repeated "Looking at: Vughy…" instead of waiting for user answer
- **Architectural Flow:** Handoff auto-continue only for handoff-style prompts; skip LOGIN_CONFIRMATION STOP when credentials in goal; main-loop guard when task is waiting_user; restore agent memory in system prompt
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/browserState/stopConditions.js`

## [2026-08-24 08:35] Reduce per-step delay (skip planning LLM, reuse observation)

- **Prompt Provided:** ~30s between "Looking at" and each step on login page; why so slow?
- **Architectural Flow:** Skip createGoalPlan LLM for login/short goals; reuse prev observation when URL unchanged; skip post-action settle on immediate failures; shorter semantic wait
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`

## [2026-08-24 08:30] Fix STARTING forever — restore missing browserGate

- **Prompt Provided:** Live screen stuck on STARTING…, nothing happening
- **Architectural Flow:** Restored `browserGate` (accidentally removed — worker crashed on startup); early presence heartbeat before Chromium boot
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/index.js`

## [2026-08-24 08:20] Stop crash recovery from wiping Google login profile

- **Prompt Provided:** Keeps seeing "Browser was relaunched after crash"
- **Architectural Flow:** recoverBrowser/safeGoto no longer call aggressive profile wipe (cookies preserved); stale tab ref retry before relaunch; restore last URL after reconnect; profile wipe only when YAMBOT_RESET_PROFILE=1
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `computer-manager/src/index.js`

## [2026-08-24 01:05] Fix page.goto closed during Sheets navigation

- **Prompt Provided:** `page.goto: Target page, context or browser has been closed` navigating to sheets.google.com/create
- **Architectural Flow:** `safeGoto` holds browser lock + retries after relaunch; screen heartbeat skips recovery/screenshots during active task; popup handler paused while navigating; `enforceSinglePage` refreshes tab list after merge
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/index.js`, `worker/src/browserState/tabs.js`

## [2026-08-24 01:00] Fix Google login handoff — merge OAuth popup into main tab

- **Prompt Provided:** After login via Take control, browser goes to about:blank and asks to log in again; user asked about extension vs cloud
- **Architectural Flow:** `mergeBestTabIntoMain` copies authenticated popup URL into main tab before single-tab enforcement; longer OAuth handoff wait; track OAuth popup during human control
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/tabs.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`

## [2026-08-24 00:50] Auto-resume after Take control handoff (no answer box)

- **Prompt Provided:** After Take control and Give control back, do not show answer text box — agent should continue to next step
- **Architectural Flow:** `human_handoff` events keep task `running`; CAPTCHA waits on control release not `ask_user`; `waitForUserAnswer` auto-continues when human had control; backend clears `waiting_user` on handoff-style give-back
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `backend/src/routes/worker.js`, `backend/src/routes/agents.js`

## [2026-08-24 00:45] Revert default home to about:blank (not Google Sheets)

- **Prompt Provided:** Keep default blank page only — do not open Google Sheets for all agents on boot
- **Architectural Flow:** Remove DEFAULT_HOME_URL/sheets fallback on boot and handoff; navigate only via YAMBOT_START_URL, agent startUrl, or goal inference when a task runs
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`

## [2026-08-24 00:35] Single Chromium window + fix frozen about:blank idle screen

- **Prompt Provided:** Frozen at about:blank; want only one Chrome window for automation, no extra windows
- **Architectural Flow:** MAX_TABS=1; enforceSinglePage; popups redirect into main tab; open_tab navigates in place; default home sheets.google.com; infer Sheets URL from spreadsheet goals; shorter OAuth handoff wait
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/tabs.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `worker/src/actions.js`

## [2026-08-24 00:15] Fix about:blank after Google OAuth login handoff

- **Prompt Provided:** After entering email/password during Take control, browser moves to about:blank
- **Architectural Flow:** Wait up to 15s for OAuth redirect before tab cleanup; track best tab during human control; never close opener tabs during handoff; prune blanks only after productive tab confirmed
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/tabs.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`

## [2026-08-24 00:00] Preserve spreadsheet tab after human login handoff

- **Prompt Provided:** After Take control login to Google Sheets + reply continue, agent opens new window asking for email/password again
- **Architectural Flow:** Removed pruneExtraPages on every ensureBrowser (was keeping about:blank, closing Sheets tab); pickBestActivePage/consolidateTabs; resync after human control + user_answer; boot profile repair only (not full wipe unless YAMBOT_RESET_PROFILE=1)
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/tabs.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `worker/src/bootProfile.js`

## [2026-08-23 23:45] Fix profile error + multiple Chromium windows on live screen

- **Prompt Provided:** "Something went wrong when opening your profile" still on live screen; many Chromium windows opening
- **Architectural Flow:** Boot-time profile reset via bootProfile.js (no self-killing pkill); targeted orphan kill on relaunch only; browser lifecycle mutex; prune extra Playwright pages
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserProfile.js`, `worker/src/bootProfile.js`, `worker/src/agent.js`, `worker/src/index.js`, `worker/entrypoint.sh`

## [2026-08-23 23:30] Fix worker freezes, entity-too-large, profile crash, max_steps

- **Prompt Provided:** request entity too large; Chromium shutdown/profile errors on live screen; Stopped max_steps; freeze after Stop then new goal
- **Architectural Flow:** nginx+Caddy+Express 10MB body limits; Chromium profile repair module + crash-restore flags; remove 120-step cap; cancel running tasks + release humanControl on stop/new goal; poll only blocks humanControl during active run; smaller screenshots; LLM timeout
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/nginx.conf`, `deploy/patch-caddy-body.sh`, `deploy/remote-deploy.py`, `backend/src/index.js`, `backend/src/models/Agent.js`, `backend/src/routes/chats.js`, `worker/src/agent.js`, `worker/src/browserProfile.js`, `worker/src/index.js`, `worker/src/llm.js`, `worker/entrypoint.sh`

## [2026-08-23 17:10] Fix post-login crash — missing useHelp import in AppSidebar

- **Prompt Provided:** Still stuck on "Loading session" after login at bot.vughy.com
- **Architectural Flow:** AppSidebar called `useHelp()` without import → ReferenceError after auth; ProtectedLayout now only blocks on `loading && !user` so logged-in users are not stuck
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/App.jsx`

## [2026-08-23 14:10] Fix infinite "Loading session" after login

- **Prompt Provided:** After login at bot.vughy.com, UI stuck on "Loading session…"
- **Architectural Flow:** Race between initial `refresh()` and `login()` left `loading=true`; session epoch ignores stale `/me` responses; login/register clear loading; API fetch timeout
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/context/AuthContext.jsx`, `frontend/src/lib/api.js`, `frontend/src/App.jsx`

## [2026-08-23 12:40] Fix worker browser crashes, false CAPTCHA, stuck pending tasks

- **Prompt Provided:** page.evaluate Target crashed; tasks stuck pending; browser dies after 3 tabs; launchPersistentContext profile-in-use; false CAPTCHA detection; live screen stuck starting
- **Architectural Flow:** ensureBrowser teardown+lock cleanup+health check; safeEvaluate wrapper; tab limit (5) with auto-close; tightened captcha heuristics (no bare data-sitekey, visible-only iframes); poll/screen loops recover dead browser; entrypoint YAMBOT_PROFILE_DIR
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/index.js`, `worker/src/pageDom.js`, `worker/src/browserState/tabs.js`, `worker/src/browserState/telemetry.js`, `worker/src/browserState/index.js`, `worker/entrypoint.sh`

## [2026-08-22 19:05] User toggle for help tooltips and How To

- **Prompt Provided:** Toggle button for users — when enabled show tooltips/How To everywhere; when disabled hide them
- **Architectural Flow:** HelpContext + localStorage + User.settings.helpEnabled sync; HelpTooltip/PageGuideBanner gate on helpEnabled; HelpToggle in sidebar/mobile header; How To nav hidden when off; backend settings GET/PUT
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/context/HelpContext.jsx`, `frontend/src/components/{HelpTooltip,FieldLabel,HelpToggle,AppSidebar}.jsx`, `frontend/src/pages/{HowToPage,LoginPage}.jsx`, `frontend/src/App.jsx`, `frontend/src/help/helpContent.js`, `backend/src/models/User.js`, `backend/src/routes/settings.js`

## [2026-08-22 18:00] Super-admin bootstrap credentials on production

- **Prompt Provided:** Set super-admin to ayamunesh@gmail.com / 123456 on production
- **Architectural Flow:** SUPERADMIN_BOOTSTRAP_* in deploy/.env; API boot `ensureSuperAdminAccounts` creates/promotes account; remote-deploy preserves SUPERADMIN_* across deploys; bootstrap min password aligned with auth (6 chars)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/superAdmin.js`, `deploy/remote-deploy.py`, VPS `deploy/.env`

## [2026-08-22 17:30] SaaS wallet — Stripe top-up, agent pricing, admin credits

- **Prompt Provided:** Per-user wallet with Stripe load; super-admin sets price per agent (deduct on create); super-admin can grant free credits
- **Architectural Flow:** User.walletBalanceCents + WalletTransaction ledger; PlatformSettings.agentPriceCents; debit on POST /api/agents; Stripe Checkout + webhook credit; admin PUT pricing + POST grant credits; WalletPage + admin UI
- **Impacted Files:** `PROMPT_LOG.md`, `backend/package.json`, `backend/src/models/{User,WalletTransaction,PlatformSettings}.js`, `backend/src/utils/{wallet,stripeClient,env}.js`, `backend/src/routes/{wallet,admin,agents,auth}.js`, `backend/src/index.js`, `frontend/src/pages/{WalletPage,AdminUsersPage,AgentEditPage}.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`, `frontend/src/help/helpContent.js`, `deploy/.env.example`

## [2026-08-22 17:15] SaaS super-admin — all users dashboard

- **Prompt Provided:** Create super admin login to see all registered users (SaaS platform operator)
- **Architectural Flow:** User.role superadmin + env SUPERADMIN_BOOTSTRAP_* / SUPERADMIN_EMAILS; boot promotes admins; `/api/admin/users` + `/api/admin/overview` behind authRequired+superAdminRequired; `/admin/login` and `/admin/users` UI with tenant table and stats
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/User.js`, `backend/src/utils/{env,superAdmin,userPublic,db}.js`, `backend/src/middleware/superAdmin.js`, `backend/src/routes/{auth,admin}.js`, `backend/src/index.js`, `frontend/src/pages/{AdminLoginPage,AdminUsersPage}.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`, `frontend/src/help/helpContent.js`, `deploy/.env.example`

## [2026-08-22 17:00] Project-wide help tooltips + How To manual

- **Prompt Provided:** Very detailed tooltip (?) on every button, text box, and control across the whole project; How To menu explaining agents, skills, goals, and all features in depth
- **Architectural Flow:** `help/helpContent.js` centralizes ~120 HELP entries + HOW_TO_SECTIONS manual; `HelpTooltip` modal popover; `FieldLabel`/`SectionTitle`/`ButtonWithHelp`/`PageGuideBanner` wrappers; `/how-to` page with TOC; sidebar How To nav + per-nav-item help; all pages wired to helpIds
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/help/helpContent.js`, `frontend/src/components/{HelpTooltip,FieldLabel}.jsx`, `frontend/src/pages/HowToPage.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`, all `frontend/src/pages/*.jsx`, `frontend/src/components/{AgentTaskQueue,LiveScreen,PageSnapshotPanel,TrajectoryPanel}.jsx`

## [2026-08-22 16:45] Help tooltips across all remaining pages

- **Prompt Provided:** Add help tooltips on ALL form fields and buttons across 14 page files using FieldLabel, SectionTitle, ButtonWithHelp, PageGuideBanner from FieldLabel.jsx; map helpIds from helpContent.js; LoginPage link to /how-to; append PROMPT_LOG entry
- **Architectural Flow:** Import help UI components from `FieldLabel.jsx`; add PageGuideBanner per page; replace plain labels/section titles with FieldLabel/SectionTitle; wrap action buttons with ButtonWithHelp — no business logic or API changes
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/{GoalEditPage,GoalsPage,ChatsPage,SettingsPage,PoliciesPage,GovernancePage,WorkforcePage,OperationsPage,CompanyPage,SkillsPage,LiveWallPage,SystemPage,LoginPage,RegisterPage}.jsx`

## [2026-08-22 16:35] Chat detail page help tooltips

- **Prompt Provided:** Add help tooltips to ChatDetailPage — PageGuideBanner, FieldLabel, ButtonWithHelp, SectionTitle for goal/send/stop/answer inputs, section titles, and take control
- **Architectural Flow:** Chat detail UI surfaces contextual help via `FieldLabel.jsx` helpers and `helpContent.js` chat.* / chats.page keys; child panels (queue, snapshot, trajectory, live screen) get SectionTitle/ButtonWithHelp — no API or polling logic changes
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/{AgentTaskQueue,LiveScreen,PageSnapshotPanel,TrajectoryPanel}.jsx`

## [2026-08-22 16:30] Agent editor contextual help tooltips

- **Prompt Provided:** Add contextual help on every form field and button in AgentEditPage using FieldLabel, SectionTitle, ButtonWithHelp, and PageGuideBanner with agent.* helpId mappings
- **Architectural Flow:** Import help components from FieldLabel.jsx; PageGuideBanner after page title; replace plain labels/legends/section titles with help-aware components; wrap action buttons with ButtonWithHelp — no form logic changes
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/AgentEditPage.jsx`

## [2026-08-22 16:00] AI Workforce OS (vision items 1–19, 24–31; exclude 20, 21–23)

- **Prompt Provided:** implement full AI workforce vision except certification/sandbox (#20) and synthetic companies/chaos testing (#21–23)
- **Architectural Flow:** Event bus + triggers + watchers; world model (entities, company memory, processes); skills/demos/training; goal autonomy + manager autonomy; anomaly baselines, investigation, priority arbitration, economic stop; performance reviews + improvement loop; scheduler tick runs all engines; worker `investigate`/`request_training` + demo capture routes; Operations/Company/Skills UI + goal SLA/autonomy + policy budgets
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/{CompanyEvent,Trigger,Watcher,Entity,Process,Skill,Demonstration,TrainingRequest,ImprovementProposal,PerformanceReview,CompanyMemory,MetricBaseline,Task,Goal,Agent,User}.js`, `backend/src/utils/{enqueueTask,eventBus,triggerEngine,watcherEngine,goalAutonomy,managerAutonomy,anomaly,investigation,performanceReview,improvementLoop,priorityArbitrator,economicDecision,policy,scheduler}.js`, `backend/src/routes/{events,triggers,watchers,entities,processes,companyMemory,skills,improvements,worker,goals,governance,policies,agents}.js`, `backend/src/index.js`, `worker/src/{actions,agent,investigation,economicDecision}.js`, `frontend/src/pages/{OperationsPage,CompanyPage,SkillsPage,GoalEditPage,PoliciesPage,AgentEditPage,GovernancePage}.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`

## [2026-08-22 15:45] Remove research (Google SERP) agent mode

- **Prompt Provided:** remove research agent mode, all related functionality, containers, and orphans
- **Architectural Flow:** Deleted `research-scraper` service, Python scraper, `ResearchJob` model, `/api/research`, worker SERP phase; agents are browser-only; boot migration sets legacy `mode=research` → `browser` and drops `researchjobs` collection; deploy removes orphan container/volume
- **Impacted Files:** `PROMPT_LOG.md`, deleted `research-scraper/*`, `deploy/Dockerfile.research`, `backend/src/models/ResearchJob.js`, `backend/src/routes/research.js`, `worker/src/{research,serpCapture}.js`, `backend/src/{models/Agent,routes/agents,index,utils/db}.js`, `worker/src/agent.js`, `frontend/src/pages/{AgentEditPage,AgentsPage,SystemPage}.jsx`, `deploy/{docker-compose.yml,.env.example,remote-deploy.py}`

## [2026-08-22 15:35] Phases 2–4: Policies, workforce, HTTP tool, evaluation

- **Prompt Provided:** "lets go with phase 2, 3, and 4" — complete governance (Layer 2), manager delegation (Layer 3), integrations + quality scoring (Layer 4)
- **Architectural Flow:** `Approval` model + worker approval poll loop; `policy.js` merged user/agent policy in runtime-config; escalation scheduler bumps long `waiting_user` tasks; `http_request` action via `/api/worker/tools/http`; `evaluateTaskRun` on complete; manager `role`/`managedAgents` + `/api/workforce` delegate; Policies/Workforce/Governance approvals UI
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/{Approval,User,Agent,Task}.js`, `backend/src/utils/{policy,evaluateTask,scheduler}.js`, `backend/src/routes/{policies,approvals,workforce,worker,governance,agents}.js`, `backend/src/index.js`, `worker/src/{actions,agent}.js`, `frontend/src/pages/{PoliciesPage,WorkforcePage,GovernancePage,AgentEditPage}.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`

## [2026-08-22 15:20] Phase 1: Employee OS goals + governance (Layers 1, 2, 5)

- **Prompt Provided:** "lets go" — start building five-layer architecture around cloud execution
- **Architectural Flow:** `Goal` model (title, KPIs, priority, parentGoal delegation seed, stats) + `/api/goals` CRUD/run; `AuditEvent` + `writeAudit` on goal/task lifecycle; `Task.goalRef`, `priorityRank`, `llmUsage`; worker `llmUsage.js` tracker on complete; claim sorts by priority; Goals + Governance UI pages
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/{Goal,AuditEvent,Task}.js`, `backend/src/utils/audit.js`, `backend/src/routes/{goals,governance,worker}.js`, `backend/src/index.js`, `worker/src/{llm.js,llmUsage.js,agent.js}`, `frontend/src/pages/{GoalsPage,GoalEditPage,GovernancePage}.jsx`, `frontend/src/{App.jsx,components/AppSidebar.jsx}`

## [2026-08-22 15:10] Remove Chrome extension — cloud-only product

- **Prompt Provided:** remove all Chrome extension related code; user only uses cloud
- **Architectural Flow:** Deleted `extension/` tree; `/api/extension` renamed to `/api/worker`; claim filter is cloud-only (agentId); runner UI removed — always `cloud`; worker no longer loads MV3 in Chromium; Dockerfile.worker drops extension COPY; frontend/docs updated for cloud-only
- **Impacted Files:** `PROMPT_LOG.md`, deleted `extension/*`, `backend/src/routes/{worker.js,index.js}`, `backend/src/models/{Agent,Task}.js`, `backend/src/routes/{agents,chats}.js`, `worker/src/{api,agent,config,index}.js`, `deploy/Dockerfile.worker`, `computer-manager/src/index.js`, `frontend/src/pages/{AgentEditPage,AgentsPage,ChatsPage,SettingsPage,LoginPage}.jsx`, `README.md`, `.cursorrules`

## [2026-08-22 15:00] Feature: Vision LLM settings + per-agent vision toggle

- **Prompt Provided:** where to set image model API key; per-agent enable/disable for vision screenshot error recovery
- **Architectural Flow:** User.settings stores optional `visionApiKeyEnc` / `visionBaseUrl` / `visionModel` (fallback to main LLM); `/api/extension/runtime-config` exposes decrypted vision creds; cloud worker uses vision creds only when attaching screenshots; `Agent.autonomy.visionEnabled` gates `shouldAttachVision`; Settings page Vision LLM section; Agent edit Autonomy checkbox
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/{User,Agent}.js`, `backend/src/routes/{settings,extension,agents}.js`, `worker/src/agent.js`, `frontend/src/pages/{SettingsPage,AgentEditPage}.jsx`

## [2026-08-22 14:50] Feature: Extension Phase 1–5 parity (learn, skills, loops, wait_for, tabs)

- **Prompt Provided:** complete remaining requirements across all phases — extension parity with cloud worker learn layer and missing actions
- **Architectural Flow:** extension `shared/{learn,loops,skills}.js` mirrors worker; agent loop injects SITE MEMORY + SKILL PROGRESS + LOOP DETECTED; trajectory + site learning on cloud task complete; content script adds structures, wait_for polling; switch_tab/open_tab via chrome.tabs; upload_file cloud-only
- **Impacted Files:** `PROMPT_LOG.md`, `extension/shared/{learn,loops,skills,pageObservation}.js`, `extension/background/agent.js`, `extension/content/content.js`, `extension/manifest.json`

## [2026-08-22 14:40] Feature: Phase 5 UI + extension macro parity + skill progress

- **Prompt Provided:** continue Phase 5 — site profile UI, trajectory replay, skill step progress, extension macro execution
- **Architectural Flow:** `/api/agents/:id/site-profiles` CRUD for dashboard; `SiteProfilesPanel` on agent edit; `TrajectoryPanel` in chat rail (stored trajectory or live step events); `computeSkillProgress` in LLM prompt; extension `content.js` implements fill_form/dismiss_dialog/choose_menu_item
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `frontend/src/components/{SiteProfilesPanel,TrajectoryPanel}.jsx`, `frontend/src/pages/{AgentEditPage,ChatDetailPage}.jsx`, `worker/src/browserState/skills.js`, `worker/src/agent.js`, `extension/content/content.js`, `extension/background/agent.js`

## [2026-08-22 14:35] Feature: Phase 4 macros + Phase 5 learn layer (site memory, trajectories, skills)

- **Prompt Provided:** complete Phase 4 leftovers (fill_form, dismiss_dialog, choose_menu_item) and start Phase 5 (site memory, trajectories, skill templates)
- **Architectural Flow:** `macros.js` runs composite form/dialog/menu actions; `skills.js` detects goal type and injects flow hints; `learn.js` loads `SiteProfile` per domain into LLM prompt, records trajectories on task complete, derives site hints; `SiteProfile` Mongo model + extension API; `Task.trajectory` stores compact step chains
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/{macros,skills,learn}.js`, `worker/src/browserState/index.js`, `worker/src/pageDom.js`, `worker/src/agent.js`, `worker/src/actions.js`, `extension/shared/actions.js`, `backend/src/models/{SiteProfile,Task}.js`, `backend/src/routes/extension.js`

## [2026-08-22 14:25] Feature: Browser State Engine Phase 4 (vision, a11y, telemetry, tabs, frames)

- **Prompt Provided:** implement Phase 4 — vision + a11y + navigation telemetry + tabs/downloads/uploads + iframes/shadow DOM
- **Architectural Flow:** `observePageFull` merges main DOM + child frames + `ariaSnapshot`; `createBrowserTelemetry` logs navigation/popups/downloads; `shouldAttachVision` attaches viewport JPEG on failures/intervals; new actions `switch_tab`/`open_tab`/`upload_file`; frame-prefixed refs (`frame_N_eM`) route click/type via `getPlaywrightFrame`; shadow DOM pierced in `collectInteractives`; LLM projection adds TABS/A11Y/FRAMES blocks
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/{telemetry,a11y,vision,tabs,observe,format,recovery}.js`, `worker/src/browserState/index.js`, `worker/src/pageDom.js`, `worker/src/agent.js`, `worker/src/actions.js`, `extension/shared/actions.js`, `frontend/src/components/PageSnapshotPanel.jsx`

## [2026-08-22 14:10] Feature: Browser State Engine Phase 3 (structures, planner, progress, relevance)

- **Prompt Provided:** implement Phase 3 — forms/tables/dialogs, proximity context, goal-aware ranking, subgoal planner, progress scoring
- **Architectural Flow:** observeInPage collects `structures`; upfront `createGoalPlan` LLM call; each step updates subgoals + `computeGoalProgress`; `formatStateProjection` shows PLAN/PROGRESS/STRUCTURES + scored interactives with nearby context
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/{planner,progress,relevance,structures,format}.js`, `worker/src/pageDom.js`, `worker/src/agent.js`, `worker/src/browserState/index.js`, `frontend/src/components/PageSnapshotPanel.jsx`

## [2026-08-22 14:00] Feature: Browser State Engine Phase 2 (semantic waits, recovery, loops, stops)

- **Prompt Provided:** implement Phase 2 — semantic waits, failure classification, recovery ladder, loop detection, stop conditions
- **Architectural Flow:** `wait_for` action + `waitForSemantic`/`waitForConditionInPage`; `failureClass.js` taxonomy; `recovery.js` ladder (resolve, wait, scroll, keyboard, overlay); `loops.js` + `stopConditions.js` injected into LLM prompt; agent auto-recovers before reporting failure
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/*`, `worker/src/pageDom.js`, `worker/src/agent.js`, `worker/src/actions.js`, `extension/shared/actions.js`

## [2026-08-22 13:50] Feature: Browser State Engine Phase 1 (state, diff, verify, fingerprints)

- **Prompt Provided:** implement Phase 1 browser automation architecture (page state model, rich action results, preconditions, fingerprints, DOM diff, verification, compact LLM projection)
- **Architectural Flow:** `worker/src/browserState/*` builds pageState + diff + verify outside LLM; agent loop runs PRECONDITION → ACT → DOM settle → VERIFY; observeInPage adds fingerprints/pageHints; PageSnapshotPanel shows state/diff
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/*`, `worker/src/pageDom.js`, `worker/src/agent.js`, `frontend/src/components/PageSnapshotPanel.jsx`

## [2026-08-22 13:35] UX: sticky agent screen + page snapshot + goal in chat rail

- **Prompt Provided:** make agent screen, page snapshot, and goal text box all visible (sticky)
- **Architectural Flow:** ChatDetailPage right rail uses CSS grid rows for screen/snapshot/goal; mobile dock uses same grid without outer scroll
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/PageSnapshotPanel.jsx`

## [2026-08-22 13:25] Feature: live page snapshot debug panel in chat

- **Prompt Provided:** show raw page observation / interactives in UI
- **Architectural Flow:** worker/extension store `pageObservation` on `thinking` task events; ChatDetailPage `PageSnapshotPanel` shows summary/table/JSON per step
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/agent.js`, `extension/shared/pageObservation.js`, `extension/background/agent.js`, `backend/src/routes/chats.js`, `frontend/src/components/PageSnapshotPanel.jsx`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-22 13:20] Fix: type into Gmail/contenteditable compose bodies

- **Prompt Provided:** agent said compose body could not be typed due to contenteditable div issue
- **Architectural Flow:** `type` on contenteditable uses execCommand/insertText in page DOM; cloud worker uses real keyboard after focus for rich editors (Gmail compose)
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/agent.js`, `extension/content/content.js`, `worker/src/actions.js`, `extension/shared/actions.js`

## [2026-08-22 13:10] Feature: periodic orphan `yambot_profile_*` volume sweep

- **Prompt Provided:** confirm delete cleans orphans; yes — add orphan volume sweep
- **Architectural Flow:** computer-manager reconcile removes profile volumes with no matching Agent in Mongo; delete path removes volume even when container already gone; orphan labeled containers drop volume when agent doc missing
- **Impacted Files:** `PROMPT_LOG.md`, `computer-manager/src/index.js`

## [2026-08-22 13:05] Fix: agent delete removes container volume + related Mongo data

- **Prompt Provided:** what is deploy-research-scraper-1; deleting agent should remove all related resources (disk/RAM)
- **Architectural Flow:** research-scraper is one shared SERP worker (not per-agent); DELETE agent stops box + removes `yambot_profile_*` volume; cascades tasks/chats/messages/research jobs
- **Impacted Files:** `PROMPT_LOG.md`, `computer-manager/src/index.js`, `computer-manager/src/httpApi.js`, `backend/src/routes/agents.js`, `deploy/docker-compose.yml`, `frontend/src/pages/SystemPage.jsx`

## [2026-08-22 13:00] Fix: worker crash loop (backticks in ACTION_SCHEMA template literal)

- **Prompt Provided:** STARTING… stuck, Take control/Zoom disabled, goals not running
- **Architectural Flow:** Worker exit 1 from ReferenceError in actions.js — nested backticks in template string; fix prompt text and redeploy worker image
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/actions.js`, `extension/shared/actions.js`

## [2026-08-22 12:45] Feature: stable smart XPath in snapshots + auto fallback on click

- **Prompt Provided:** do we have stable xpaths already? can we use smart xpath as a fallback?
- **Architectural Flow:** `buildSmartXPath` (id/testid/aria-label/name, not DevTools `/html/body/div[n]`) on each interactive; shown in LLM snapshot; agent enriches click/type/select with snapshot xpath when ref stale; resolution ref → name → css → xpath
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `extension/content/content.js`, `worker/src/agent.js`, `extension/background/agent.js`, `worker/src/actions.js`, `extension/shared/actions.js`

## [2026-08-22 12:20] Fix: Gmail-style nested menus missing from agent page snapshot

- **Prompt Provided:** Gmail bulk-action menus/submenus not visible to LLM after select all → options → submenu
- **Architectural Flow:** Collect all visible `[role="menu"]` panels + menuitem/checkbox/radio; mark `[submenu]` parents; suppress email/grid row noise when menus open; `openMenus` summary in LLM prompt
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `extension/content/content.js`, `worker/src/agent.js`, `extension/background/agent.js`

## [2026-08-22 10:25] Feature: agent work queue in chat (view, edit, delete pending goals)

- **Prompt Provided:** show queued work for the agent in every chat related to that agent; option to delete and edit queued items
- **Architectural Flow:** `GET /api/chats/:id` returns `agentQueue` (pending FIFO + active run across all chats for bound agent); `PATCH`/`DELETE` on pending tasks; `AgentTaskQueue` panel in ChatDetailPage; allow stacking pending goals while agent runs
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/chats.js`, `frontend/src/components/AgentTaskQueue.jsx`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-22 10:20] Perf: faster agent steps (captcha, no 600ms pause, no full-page shots)

- **Prompt Provided:** yes — (1) captcha: try DeathByCaptcha then ask user to take control; (2) remove 600ms step pause; (3) no full-page screenshots during agent loop
- **Architectural Flow:** Instant captcha detect via DOM (no 8s waitForSelector per step); DBC attempt then human handoff; drop post-step sleep; heartbeats skip JPEG on agent steps, viewport-only when idle
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `extension/background/agent.js`

## [2026-08-22 09:15] Fix: Take control noVNC mouse/keyboard not working

- **Prompt Provided:** when i take control, i am not able to move my mouse and type keyboard
- **Architectural Flow:** Explicit `view_only=0` + remount control iframe after Zoom; skip Playwright screenshots + xdotool window focus during humanControl; x11vnc `-cursor most`; faster screen heartbeat
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/LiveScreen.jsx`, `backend/src/index.js`, `worker/src/agent.js`, `worker/entrypoint.sh`, `deploy/Dockerfile.worker`, `computer-manager/src/index.js`

## [2026-08-22 09:05] Feature: Zoom shows live noVNC stream; Take control stays interactive

- **Prompt Provided:** when i click on zoom, i want to see the live screen, not just the screenshots. zoom let me see whats going on, take control button allow me to take control
- **Architectural Flow:** Zoom opens view-only noVNC (`view_only=1`) via desktop session; Take control still pauses agent and opens interactive noVNC; inline panel keeps screenshot thumbnails
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/index.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-22 09:00] UX: hide Chromium infobars on live screen (no-sandbox + Google API keys)

- **Prompt Provided:** unsupported command-line flag no sandbox + google api keys are missing banners in live screen browser
- **Architectural Flow:** Headed worker Chromium adds `--test-type` (suppresses no-sandbox warning) and sets GOOGLE_* env to `no` so Playwright Chromium does not show the API-keys infobar on noVNC
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/entrypoint.sh`, `deploy/Dockerfile.worker`

## [2026-08-22 08:55] Fix: Settings LLM changes reset after save/deploy

- **Prompt Provided:** i am updating new llm but its not getting udpated why ?
- **Architectural Flow:** `seedDefaultLlmSettings` no longer overwrites every user on API boot — only users without a saved key; settings PUT uses `markModified('settings')`; GET shows saved key only (not server default mask)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/seedLlm.js`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`

## [2026-08-22 08:50] Feature: Settings test LLM connection button

- **Prompt Provided:** i need test button in settings page to test the llm connection
- **Architectural Flow:** `POST /api/settings/test-llm` sends a tiny chat completion using form values or saved secrets; Settings page adds Test LLM connection button beside existing DBC test
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`

## [2026-08-21 18:35] Fix: mobile goal dock still showed strip (sticky + page pad)

- **Prompt Provided:** still there (strip under goal/instruction on mobile)
- **Architectural Flow:** Sticky dock inside `py-3` left a body-gradient gap at the screen bottom; switch mobile dock to `fixed` + opaque `yb-bg` with safe-area as padding on the same surface; drop page `pb` on mobile; add scroll spacer so messages clear the dock
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-21 18:20] Fix: mobile strip under chat goal / instruction box

- **Prompt Provided:** i see a strip in the mobile below to the goal/instruction box. check that design issue
- **Architectural Flow:** Remove LiveScreen pageUrl/status chrome from inline mobile chat (keep in zoom); stop double safe-area (body pad + sticky dock); dock paints one continuous bg into home-indicator inset
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/index.css`

## [2026-08-21 17:55] UX: hide Chromium “controlled by test software” banner

- **Prompt Provided:** in live screen in chrome i see chrome is being controlled by test software, instead of that can we have any other way?
- **Architectural Flow:** Worker headed Chromium launches with `ignoreDefaultArgs: ['--enable-automation']` and `--disable-blink-features=AutomationControlled` so the automation infobar is not shown on noVNC / Live Wall
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`

## [2026-08-21 17:50] Fix: Take control noVNC “failed to connect to server”

- **Prompt Provided:** from the wall when i click take control : failed to connect to server
- **Architectural Flow:** noVNC builds WS as `/${path}`; embed now sets path to `api/agents/:id/desktop/websockify` (plus ticket) so the upgrade hits the desktop proxy instead of bare `/websockify`
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/index.js`

## [2026-08-21 17:30] Ops: restore HTTPS + fix headed agent Chromium locks

- **Prompt Provided:** (continuation of ets do)
- **Architectural Flow:** Web binds only :8080 so host Caddy can terminate TLS for bot.vughy.com; entrypoint clears Chromium SingletonLock on boot so headed agents stop crash-looping after recreate
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/docker-compose.yml`, `worker/entrypoint.sh`

## [2026-08-21 17:05] Ops: unstick deploy + fix worker tzdata hang

- **Prompt Provided:** ets do (kill hung builds, restore site, finish noVNC worker deploy)
- **Architectural Flow:** Kill stuck compose; restore mongo/api/web; root cause of worker hang was interactive tzdata; set DEBIAN_FRONTEND=noninteractive; rebuild headed worker image; recreate agent boxes with YAMBOT_HEADED=1 + noVNC:6080
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/Dockerfile.worker`

## [2026-08-21 15:45] Feature: noVNC remote desktop for Take control

- **Prompt Provided:** lets do it (xrdp/vnc/novnc so Take control feels like real RDP)
- **Architectural Flow:** Worker image boots Xvfb+fluxbox+x11vnc+noVNC; headed Chromium on DISPLAY=:99; API proxies `/api/agents/:id/desktop` with ticket/cookie auth + WebSocket; LiveScreen Take control embeds noVNC iframe (fallback click-map if stream fails); nginx Upgrade headers; manager HEADED=1 + 1GB shm + 2GB RAM
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/Dockerfile.worker`, `worker/entrypoint.sh`, `worker/src/agent.js`, `computer-manager`, `backend` desktopProxy+index+package, `deploy/nginx.conf`, `frontend` LiveScreen

## [2026-08-21 15:25] Feature: Live Wall + remote-desktop attention blink

- **Prompt Provided:** live screen like remote desktop; page with all agents live screens, zoom + take control; red blink when help needed (CAPTCHA)
- **Architectural Flow:** `computer.needsAttention` set on ask_user/captcha handoff, cleared on answer/complete/stop; `GET /api/agents/live-wall` feeds `/live` grid; LiveScreen Take control opens remote-desktop session with Zoom; red CSS blink when attention
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model + agents/extension/chats routes, `frontend` LiveScreen, LiveWallPage, App, AppSidebar, AgentsPage, index.css

## [2026-08-21 15:15] Fix: no default Google page; new goals unblock waiting_user freeze

- **Prompt Provided:** remove default google.com from live screen for new agents; check my inbox for unread froze
- **Architectural Flow:** Cloud/extension no longer navigate to google.com unless Start URL or research mode; blank page by default. Posting a new chat goal cancels same-agent `waiting_user` so ask_user cannot freeze the computer
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `extension/background/agent.js`, `backend/src/routes/chats.js`, `frontend/src/pages/AgentEditPage.jsx`

## [2026-08-21 14:45] Fix: shopping cart priority + agent rules are store-agnostic

- **Prompt Provided:** what about other shopping carts then?
- **Architectural Flow:** Broaden cart/basket/bag detection (Shopify, Walmart, FR/DE/ES/PT labels, mini-cart drawers) and chrome headers; LLM rule uses same-host /cart|/basket|/bag|/gp/cart/view.html fallbacks instead of Amazon-only
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/actions.js`, `extension/content/content.js`, `extension/shared/actions.js`

## [2026-08-21 14:40] Fix: prioritize Cart/nav on shopping pages so agent leaves Amazon home

- **Prompt Provided:** it opened the amazon but not going to cart
- **Architectural Flow:** Observe still uncapped, but Cart/Delete/chrome controls are listed before product links; LLM prompt tells agent to click header Cart (#nav-cart) or navigate to /gp/cart/view.html when goal is cart
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/actions.js`, `extension/content/content.js`, `extension/shared/actions.js`

## [2026-08-21 14:30] Fix: remove interactive control cap (was 120)

- **Prompt Provided:** raise the interactive limit on all pages; remove the cap of 120 controls (Amazon cart Delete was missing)
- **Architectural Flow:** `collectInteractives()` in worker pageDom + extension content no longer stops at 120; all visible interactives get refs so shopping/cart Delete/Remove and other deep controls are visible to the LLM
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `extension/content/content.js`

## [2026-08-21 14:10] Fix: research-scraper stuck pending (python never started under xvfb-run)

- **Prompt Provided:** Research job queued pending then freezes
- **Architectural Flow:** Replace hung `xvfb-run` with explicit Xvfb+entrypoint; harden Chrome launch logging so claim loop actually runs
- **Impacted Files:** `PROMPT_LOG.md`, `research-scraper/entrypoint.sh`, `research-scraper/scraper.py`, `deploy/Dockerfile.research`

## [2026-08-21 14:00] Feature: Cloud Python Chrome research scraper + Research API

- **Prompt Provided:** Playwright flow still fails; run api.py-style Chrome in cloud; create API
- **Architectural Flow:** `POST /api/research/jobs` queues keywords; `research-scraper` Docker (Google Chrome + xvfb + pychrome) claims jobs, opens google.com, types query, captures HTML via CDP, parses with api.py BeautifulSoup parsers, posts pages; agent Phase 1 polls job then Phase 2 LLM visits URLs
- **Impacted Files:** `PROMPT_LOG.md`, `backend` ResearchJob + research routes + index, `research-scraper/*`, `deploy` Dockerfile.research + compose + env.example, `worker`/`extension` research.js

## [2026-08-21 13:50] Fix: Research flow = google.com type/search → scrape → LLM visits sites

- **Prompt Provided:** Not jump to /search?q=; type into google.com search box via xpath; scrape; then LLM visits each website
- **Architectural Flow:** Phase 1 opens google.com, types keyword (xpath), submits Search, scrapes/paginates SERPs. Phase 2 builds deep-research goal from organic URLs and continues LLM browser loop. Same on cloud worker + extension
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/research.js`, `worker/src/agent.js`, `extension/background/research.js`, `extension/background/agent.js`

## [2026-08-21 13:35] Feature: Load YamBot extension inside cloud Chromium

- **Prompt Provided:** i want this extension in cloud also
- **Architectural Flow:** Worker image bundles `extension/`; Playwright launches with `--load-extension` + `channel:chromium`. Research agents may use cloud or laptop extension. Cloud research uses extension content helpers (`__yambotCaptureSerp`) with worker SERP fallback; results still post to chat
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/Dockerfile.worker`, `worker` config/agent/research/serpCapture, `extension` content/manifest, `backend` agents routes, `frontend` AgentEditPage

## [2026-08-21 13:25] Feature: Research agent mode (extension-only SERP capture)

- **Prompt Provided:** Research agents only via Chrome extension; capture page itself (no Flask/visaclap/hotkey); results back to agent chat
- **Architectural Flow:** Agent `mode=research` forces `runner=extension` (no cloud box). Extension skips LLM loop, opens Google, content script `CAPTURE_SERP` / `CLICK_NEXT_SERP`, posts progress + JSON to task/chat
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model + agents routes, `frontend` AgentEditPage/AgentsPage, `extension` research.js, agent.js, content.js, manifest

## [2026-08-21 12:50] Fix: DBC solve hung after "Solving…" with no feedback

- **Prompt Provided:** got Solving Google CAPTCHA with DeathByCaptcha… and doing nothing
- **Architectural Flow:** Add AbortSignal timeouts on DBC fetch; submit captcha create as multipart (per DBC docs); emit progress/fail messages to chat while polling so UI never looks frozen
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/captcha.js`, `worker/src/agent.js`, `extension/background/captcha.js`, `extension/background/agent.js`

## [2026-08-21 12:40] Fix: Auto-solve Google reCAPTCHA via DeathByCaptcha (Vughy)

- **Prompt Provided:** Agent given https://vughy.com/agency/login/agency with Google captcha does nothing; testing DeathByCaptcha
- **Architectural Flow:** SPA explicit-render reCAPTCHA (`.captcha-recaptcha`, no static data-sitekey) — wait for iframe, extract sitekey, auto-call DBC when configured (not wait for LLM `solve_captcha`), inject token + invoke grecaptcha/React callbacks; image captchas still hand off to human
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/pageDom.js`, `extension/background/agent.js`, `extension/content/content.js`

## [2026-08-21 12:28] Feature: DeathByCaptcha test connection button

- **Prompt Provided:** need deathbycaptcha test button to test its connected
- **Architectural Flow:** Settings → Test connection → POST `/api/settings/test-dbc` hits DBC `/user` with form or saved creds and returns balance
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`

## [2026-08-21 12:11] Fix: Amazon CAPTCHA loop → ask user

- **Prompt Provided:** Agent entered Amazon email/password then looped on captcha instead of asking user to solve
- **Architectural Flow:** Detect Amazon/image captchas; when no reCAPTCHA sitekey, force waitForUserAnswer (Take control); DBC missing/unsupported returns needs_human instead of throwing
- **Impacted Files:** `PROMPT_LOG.md`, worker pageDom/captcha/agent/actions, extension content/captcha/agent/actions

## [2026-08-21 12:02] Fix: NaN xNorm/yNorm on live type/key control

- **Prompt Provided:** Agent validation failed controlQueue xNorm/yNorm Cast to Number failed for NaN when typing in live screen
- **Architectural Flow:** Only attach xNorm/yNorm on click commands with finite 0–1 values; type/key/scroll omit coords so Mongoose never sees NaN
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-21 11:57] UI: Live screen fills panel + Zoom modal

- **Prompt Provided:** show agent live screen full window; Zoom in opens full screen in a modal box
- **Architectural Flow:** LiveScreen `fill` grows in the sticky rail; Zoom in portals a near-viewport modal (Esc/backdrop/Close)
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` LiveScreen + ChatDetailPage

## [2026-08-21 10:22] UI: Chat thread follows live bottom + sticky rail

- **Prompt Provided:** keep live screen and goal sticky; chat thread show the bottom so live text is visible on the left
- **Architectural Flow:** ChatDetail left column is its own scroller pinned to latest messages (unless user scrolls up); right rail stays sticky with LiveScreen + goal
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-21 10:08] UI: Left sidebar + full-page live screen

- **Prompt Provided:** menu on left sidebar with toggle; whole project responsive; see full live agent screen not just viewport
- **Architectural Flow:** AppSidebar drawer/rail replaces AppHeader; worker captures clipped full-page JPEG; LiveScreen scrollable preview; remote clicks map via document coords + scroll-into-view
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` App/AppSidebar/LiveScreen/ChatDetail/index.css/pages, `worker/src/agent.js`, `backend` Agent/extension/agents

## [2026-08-21 10:05] UI: Sticky right rail for live screen + goal

- **Prompt Provided:** live agent screen and goal/instructions text box sticky at the right side of the page
- **Architectural Flow:** ChatDetail two-column layout — messages left, sticky right rail (LiveScreen + goal) on lg+; mobile keeps sticky bottom dock
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-21 09:49] Fix: Custom dropdown + calendar clicks (Passport / dates)

- **Prompt Provided:** Agent cannot select Passport in enquiry type dropdown; cannot select date from calendar on Vughy CRM
- **Architectural Flow:** Overlay-first snapshot (listbox/menu/calendar cells); React pointer clicks; cloud worker uses Playwright mouse at resolved coords; custom select clicks option by value/name
- **Impacted Files:** `PROMPT_LOG.md`, `worker` pageDom/agent/actions, `extension` content + shared/actions + background/agent

## [2026-08-21 00:22] Feature: Multi-strategy element locators

- **Prompt Provided:** Use advanced targeting (option 1): ref → role+name → label → CSS → XPath
- **Architectural Flow:** Snapshot adds role/cssHint; click/type/select resolve via fallback chain in worker pageDom + extension content; LLM schema documents optional locators
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/pageDom/agent, `extension` shared/actions + content + background/agent

## [2026-08-21 00:13] UI: Sticky mobile dock + Stop agent

- **Prompt Provided:** instruction box and live screen sticky at bottom on mobile; Stop button to stop the agent
- **Architectural Flow:** ChatDetail sticky bottom dock (LiveScreen + goal); POST `/api/chats/:id/stop` cancels active tasks; worker checks cancelled each step and exits
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` ChatDetailPage + LiveScreen compact, `backend` chats/extension, `worker/src/agent.js`

## [2026-08-20 20:58] Fix: JSON parse still failing + stale worker boxes

- **Prompt Provided:** still got the same unexpected non-whitespace character after JSON error
- **Architectural Flow:** Lenient JSON parse (slice at error position); LLM HTTP body also lenient; computer-manager recreates agent containers when worker image Id changes so fixes actually load
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/llm/agent, `extension` shared/actions + llm, `computer-manager/src/index.js`

## [2026-08-20 20:50] Fix: Agent stops on JSON parse trailing characters

- **Prompt Provided:** unexpected non-whitespace character after JSON; agent stops working
- **Architectural Flow:** Balanced first-object JSON extract (ignore trailing prose); normalize multimodal LLM content; on parse failure wait+retry instead of aborting the task
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/llm/agent, `extension` shared/actions + llm + agent

## [2026-08-20 19:41] Feature: Per-agent SMTP email identity

- **Prompt Provided:** give SMTP email to the agent on create/edit so agent uses email as a human
- **Architectural Flow:** Agent.email (encrypted SMTP + IMAP) → dashboard form + test send → workers call `/api/extension/email/send|check` → LLM actions `send_email` / `check_email`
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model/routes/agentEmail/extension, `frontend` AgentEdit/AgentsPage, worker + extension actions/agent loops, `backend/package.json`

## [2026-08-20 19:33] Feature: Free-text skill + per-agent scheduler

- **Prompt Provided:** scheduler for every agent; remove skill dropdown — write skill in a textbox
- **Architectural Flow:** Agent.skill is free text; Agent.schedule (enabled/goal/interval/dailyAt) → API `startAgentScheduler` ticks → enqueues Task into “Schedule · {name}” chat; skips if agent busy
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model/routes/scheduler/index, `frontend` AgentEditPage/AgentsPage, worker + extension skill prompt

## [2026-08-20 19:19] Feature: Delete agent + System containers/CPU page

- **Prompt Provided:** option to delete agent; page listing all containers + system processor charts
- **Architectural Flow:** Agents list Delete → API stops container via computer-manager then removes Mongo doc; `/system` polls `/api/system/overview` → manager Docker inventory + CPU/mem charts
- **Impacted Files:** `PROMPT_LOG.md`, `computer-manager` httpApi, `backend` system routes + agents delete, `frontend` SystemPage/AgentsPage/App/AppHeader, `deploy/docker-compose.yml`

## [2026-08-20 19:12] Config: Remove max steps — agents run unlimited

- **Prompt Provided:** remove max steps; agent can work unlimited
- **Architectural Flow:** Cloud worker + extension loops until `finish`/abort (no step ceiling); Max steps removed from Settings/Agent UI/sidepanel; prompts say unlimited
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `extension/background/agent.js`, `extension/sidepanel/*`, `frontend` Settings + AgentEdit, `backend` Agent/User/settings/agents/extension

## [2026-08-20 19:09] Fix: Mobile page scroll for chat history

- **Prompt Provided:** on mobile cannot scroll up to see chat history; keep page scroller
- **Architectural Flow:** Chat messages expand in document flow (no nested max-height box); auto-scroll only after user send, not on poll
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-20 18:56] Feature: Human mouse/keyboard takeover + give control back

- **Prompt Provided:** use mouse and keyboard on live computer for captcha etc., then give control back to the agent
- **Architectural Flow:** Dashboard Take control → `computer.humanControl` → worker pauses LLM loop / skips claims while still applying click/key/scroll queue; Give control back clears flag and agent resumes
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model + agents/control + extension heartbeat, `worker` agent/index, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:50] UI: Live screen above goal + fullscreen zoom

- **Prompt Provided:** live screen above goal/instructions textbox; zoom in for full size
- **Architectural Flow:** Chat detail single column — messages → LiveScreen → goal form; LiveScreen `Zoom in` toggles fixed fullscreen (Esc to exit)
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:44] UI: Mobile-responsive dashboard pass

- **Prompt Provided:** make the webpage responsive
- **Architectural Flow:** Mobile-first padding/stacking; sticky scrollable nav; chat shows live screen first on small screens; 44px touch targets; overflow-x + safe-area
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` AppHeader, ChatDetail, LiveScreen, Chats/Agents/Settings/Login/Register, `index.css`, `index.html`

## [2026-08-20 18:41] Fix: Blank live screen on about:blank

- **Prompt Provided:** i can see only blank screen
- **Architectural Flow:** Worker boot navigates off `about:blank` to Google (or `YAMBOT_START_URL`) before first screenshot heartbeat
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:29] Fix: Cloud screen stuck on “Provisioning…”

- **Prompt Provided:** provisioning cloud computer… but cannot see the screen
- **Architectural Flow:** Pin Playwright `1.54.2` to match Docker image browsers; manager recreates containers when start fails (stale network after compose recreate)
- **Impacted Files:** `PROMPT_LOG.md`, `worker/package.json`, `computer-manager/src/index.js`, LiveScreen error surfacing

## [2026-08-20 18:21] Config: Default Minimax LLM settings (server-side)

- **Prompt Provided:** Set LLM API key / MiniMax-M2.7 / https://api.minimax.io/v1 permanently in settings
- **Architectural Flow:** Server `DEFAULT_LLM_*` in deploy `.env` (not git) → API boot seeds all users’ encrypted settings → Settings UI + workers read from Mongo
- **Impacted Files:** `PROMPT_LOG.md`, `backend` env/User/settings/seed, frontend defaults, `deploy/remote-deploy.py`, `.env.example`, gitignored local deploy secrets

## [2026-08-20 18:01] Ops: Always VPS-deploy after git push

- **Prompt Provided:** always deploy on server for each git push; is chrome extension already installed?
- **Architectural Flow:** `deploy/remote-deploy.py` + `.cursorrules` mandate post-push VPS rebuild; cloud boxes use Playwright Chromium (no MV3 extension inside Docker); laptop extension remains optional manual install
- **Impacted Files:** `PROMPT_LOG.md`, `.cursorrules`, `deploy/remote-deploy.py`, `deploy/.deploy.local.env.example`, `.gitignore`

## [2026-08-20 17:53] Feature: Auto-provision cloud computers + interactive live control

- **Prompt Provided:** Auto-create VPS/container on new agent; live screen; interact to fix captchas etc.
- **Architectural Flow:** Agent create (default `runner=cloud`) → worker token + `computer.desired=running` → `computer-manager` (Docker sock) starts `yambot-worker` container → worker token-login + screenshot heartbeat → dashboard LiveScreen click/type → control queue drained by worker Playwright
- **Impacted Files:** Agent model, auth worker-login, agents control + manager routes, `computer-manager/`, worker login/control, LiveScreen interactive UI, docker-compose, PROMPT_LOG

## [2026-08-20 17:47] Feature: Live agent screen on dashboard + clarify cloud computer lifecycle

- **Prompt Provided:** Creating an agent should get own computer+Chrome+extension; also watch live screen from dashboard
- **Architectural Flow:** Clarify create≠auto-provision; worker heartbeats + JPEG screenshots → Agent.liveScreen → dashboard poll `/api/agents/:id/live`; chat UI shows live pane
- **Impacted Files:** `PROMPT_LOG.md`, Agent model, extension heartbeat route, worker screenshot loop, `LiveScreen` UI, Agent/Chat pages

## [2026-08-20 17:35] Feature: Own computer + Chrome per agent (cloud worker)

- **Prompt Provided:** “Own computer + Chrome per agent” — lets do this
- **Architectural Flow:** Agent `runner` (extension|cloud|any) → Task `runner` at enqueue → claim API filters by `agentId` + `claimAs` → Playwright worker with persistent Chromium profile polls only its agent → Compose `worker` service (one container ≈ one agent computer)
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent/Task/extension/agents/chats, `extension` poller, `worker/*`, `deploy/docker-compose*.yml`, `deploy/Dockerfile.worker`, `frontend` Agents UI, `README`/`deploy/README`

## [2026-08-20 17:31] Config: Production base URL bot.vughy.com

- **Prompt Provided:** update the base url to bot.vughy.com
- **Architectural Flow:** Vite/API env → `https://bot.vughy.com`; nginx proxies `/api` to API container so one host serves UI + API
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/.env.production`, `backend/.env.production`, `deploy/.env.example`, `deploy/docker-compose.yml`, `deploy/nginx.conf`

## [2026-08-20 17:23] Feature: Agent memory + VPS worker deploy

- **Impacted Files:** agent memory, deploy Compose on VPS
