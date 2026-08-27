# PROMPT_LOG.md

## [2026-08-27 14:01] Chats list — show which threads are live/working

- **Prompt Provided:** On chat page, show which thread is working when Live is running something
- **Architectural Flow:** GET /api/chats attaches live task status per chatId; ChatsPage badges Running / Needs you / Queued and polls every few seconds
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/chats.js`, `frontend/src/pages/ChatsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 13:54] Goals list — next autonomy run countdown

- **Prompt Provided:** On /goals page, show a timer for next run of each particular goal
- **Architectural Flow:** Client computes next check from autonomy.lastCheckAt + checkIntervalMinutes; live 1s countdown on active autonomy goals; light poll refresh so lastCheckAt stays current
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/GoalsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 13:47] Disable auto skill drafts — Teach skill / New skill / import only

- **Prompt Provided:** Stop automatically developing skills after runs; only create when user clicks Teach skill or New skill / import (lots of suggested skills were noise)
- **Architectural Flow:** Remove ensureSkillSuggestionFromTask from worker task-complete path; keep Teach skill demo finish, convert-demo, New skill, import, and explicit /learn; update Skills UI + help copy; LiveScreen recordDemo default false
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/worker.js`, `backend/src/utils/skillSuggestion.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 13:25] Agent Actions reference page

- **Prompt Provided:** User wants a page listing all agent actions with clear explanations and usage examples
- **Architectural Flow:** Add agentActionsContent.js catalog + AgentActionsPage with search/TOC/copy; route /agent-actions; sidebar link under Start here
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/help/agentActionsContent.js`, `frontend/src/pages/AgentActionsPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 12:32] Fix update_kpi — auto-inject goalRef from task

- **Prompt Provided:** Goal test run succeeded but update_kpi failed (empty goalId); user testing KPI + autonomy with vughy/yahoo goal
- **Architectural Flow:** Worker passes task.goalRef into executeAction ctx; update_kpi uses action.goalId || ctx.goalRef so goal-linked runs bump KPIs without LLM supplying Mongo id
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`

## [2026-08-27 12:22] Goal autonomy — 1 minute minimum interval

- **Prompt Provided:** Lower goal autonomy check interval minimum from 15 minutes to 1 minute
- **Architectural Flow:** Align schema, API validation, scheduler tick, UI input min, and help copy on 1-minute floor
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Goal.js`, `backend/src/routes/goals.js`, `backend/src/utils/goalAutonomy.js`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 12:00] UX simplification — guided setup + grouped nav

- **Prompt Provided:** User finds the product confusing; wants it easy to do things
- **Architectural Flow:** Add `/start` welcome page + GettingStartedCard checklist (LLM → quick agent → chat); group sidebar into Start here / More / Account; rename Common chat → Shared inbox, Skills → Workflows, Goals → Scheduled goals; register/login redirect to `/start`
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/hooks/useSetupStatus.js`, `frontend/src/components/GettingStartedCard.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/StartPage.jsx`, `frontend/src/pages/ChatsPage.jsx`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/RegisterPage.jsx`, `frontend/src/pages/LoginPage.jsx`, `frontend/src/App.jsx`


- **Prompt Provided:** User pasted 3 agencies but only 1 lead was imported
- **Architectural Flow:** expand wide `name,type,email` rows when pasted without line breaks; clearer import result message in UI
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/csvLeadsImport.js`, `backend/test/smoke.test.js`, `frontend/src/pages/CompanyPage.jsx`

## [2026-08-27 11:45] Fix CSV import name,type,email format

- **Prompt Provided:** Bulk entity CSV paste `name,type,email` fails with "No valid email addresses found"
- **Architectural Flow:** parseCsvText detects 3-column rows with email in last column; UI placeholder/help updated
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/csvLeadsImport.js`, `backend/test/smoke.test.js`, `frontend/src/pages/CompanyPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 10:45] System page — tenant-scoped agent containers

- **Prompt Provided:** System page should show only the user's agents; super admin sees all
- **Architectural Flow:** `/api/system/overview` filters `yambot-agent-*` by Agent.user unless isSuperAdmin; stop endpoint checks ownership; SystemPage shows scope hint
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/system.js`, `frontend/src/pages/SystemPage.jsx`

## [2026-08-27 10:35] Fix YamBot AppSidebar nav scroll

- **Prompt Provided:** Left YamBot app menu (AppSidebar) does not scroll to reach Log out
- **Architectural Flow:** aside `overflow-hidden` + nav `flex-1 min-h-0 overflow-y-auto`; header/help/footer `shrink-0`
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/AppSidebar.jsx`

## [2026-08-27 10:25] Vughy left nav scroll — sidebar panel targeting

- **Prompt Provided:** Left navigation menu scroll still broken; cannot scroll to Logout
- **Architectural Flow:** Scan left 40% viewport for scrollable nav panels; set scrollTop + wheel event; remote control clicks menu then evaluate scroll; LiveScreen Menu ↓/↑ + PageDown/End
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/agent.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-27 10:20] Fix Vughy sidebar menu scroll (nested scroll + takeover)

- **Prompt Provided:** After Vughy portal login, menu scrolling does not work
- **Architectural Flow:** Vughy sidebar uses inner overflow scroll; agent `scroll` only called `window.scrollBy`; now finds scrollable nav/aside at ref or pointer; remote control moves mouse to click/wheel point before `mouse.wheel`; LiveScreen wheel scroll without Shift and passes xNorm/yNorm
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/agent.js`, `frontend/src/components/LiveScreen.jsx`, `worker/src/actions.js`

## [2026-08-27 08:45] Fix production 502 — duplicate Ticket import crash

- **Prompt Provided:** Login on production returns HTTP 502
- **Architectural Flow:** API container failed to start due to duplicate `import { Ticket }` in `workerEntities.js`; removed duplicate so Node can load the module graph; redeploy
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/workerEntities.js`

## [2026-08-27 01:00] Close all OS gaps — tickets, deals, teams, SLA, CRM, SMS, portal, audit

- **Prompt Provided:** Implement all remaining gaps (bugs + partial features + missing work types) without omission
- **Architectural Flow:** pending_send/bounced enrollment stages; KPI→MetricBaseline; ticket mirror entity + auto-assign + support process + SLA job + triage trigger; ticket detail + portal; deals/invoices/teams models; unsubscribe/bounce; document filesystem storage; cron triggers + change UI; process transition validation; worker actions (search/create ticket, deals, invoice, crm_sync, send_sms); scheduled weekly reports; audit export; smoke tests
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/*`, `backend/src/utils/*`, `backend/src/routes/*`, `backend/test/smoke.test.js`, `worker/src/*`, `frontend/src/pages/*`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/pages/GovernancePage.jsx`, `frontend/src/pages/CompanyPage.jsx`

## [2026-08-27 00:15] Agent OS upgrades 1–8 — tickets, processes, state, triggers, KPI, integrations, docs, queues

- **Prompt Provided:** Implement all 8 upgrade areas: tickets, process builder, state APIs, full triggers, KPI loop, integrations, documents, queue UX
- **Architectural Flow:** Ticket model + email→ticket engine; QueuesPage (tickets/campaigns/tasks/docs); process stage editor + bottlenecks; worker actions (set_entity_status, update_enrollment, update_kpi, update_ticket, slack/webhook/calendar, attach_document); campaign pending_send→sent on task complete; condition/threshold/anomaly trigger evaluators; KPI parse from finish summary
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Ticket.js`, `DocumentFile.js`, `Entity.js`, `backend/src/utils/ticketEngine.js`, `stateHelpers.js`, `kpiUpdater.js`, `integrations.js`, `triggerEvaluators.js`, `emailInboxWatcher.js`, `campaignEngine.js`, `scheduler.js`, `routes/tickets.js`, `documents.js`, `queues.js`, `processes.js`, `triggers.js`, `workerEntities.js`, `worker.js`, `index.js`, `worker/src/actions.js`, `agent.js`, `verify.js`, `frontend/src/pages/QueuesPage.jsx`, `CompanyPage.jsx`, `OperationsPage.jsx`, `App.jsx`, `AppSidebar.jsx`, `helpContent.js`

## [2026-08-26 23:55] Bulk CSV lead import + enroll all campaigns

- **Prompt Provided:** Bulk CSV import for leads + campaign enroll all (5000-email outreach workflow)
- **Architectural Flow:** `csvLeadsImport.js` parses CSV → upserts Entity type lead by email; `POST /api/entities/import` + `/stats`; `enrollCampaignEntities` paginates all eligible leads (no 500 cap); CompanyPage Entities tab CSV paste/file upload; Campaigns "Enroll all leads" with full stats
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/csvLeadsImport.js`, `backend/src/utils/campaignEngine.js`, `backend/src/routes/entities.js`, `backend/src/routes/campaigns.js`, `frontend/src/pages/CompanyPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 23:30] Company OS Phases 1–4 — agent database, email ops, campaigns, dashboard

- **Prompt Provided:** Build Phase 1+2 (entity brain + email log/threading) then Phase 3 (campaigns) and Phase 4 (process instances + company dashboard)
- **Architectural Flow:** `entityContext` injects company memory + entities into every enqueue; worker entity/process actions; `EmailMessage` log + IMAP watcher → `email.received`/`email.replied`; Campaign/Enrollment + `campaignEngine` scheduler; Company dashboard API + expanded CompanyPage tabs
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Task.js`, `backend/src/models/EmailMessage.js`, `backend/src/models/Campaign.js`, `backend/src/utils/entityContext.js`, `backend/src/utils/emailLog.js`, `backend/src/utils/emailInboxWatcher.js`, `backend/src/utils/campaignEngine.js`, `backend/src/utils/enqueueTask.js`, `backend/src/utils/agentEmail.js`, `backend/src/utils/scheduler.js`, `backend/src/routes/workerEntities.js`, `backend/src/routes/worker.js`, `backend/src/routes/campaigns.js`, `backend/src/routes/companyDashboard.js`, `backend/src/routes/entities.js`, `backend/src/index.js`, `worker/src/actions.js`, `worker/src/agent.js`, `worker/src/browserState/verify.js`, `frontend/src/pages/CompanyPage.jsx`

## [2026-08-26 18:50] Group delete — safer UX (no accidental ×)

- **Prompt Provided:** Group delete too easy to trigger by mistake on the × chip
- **Architectural Flow:** Remove inline × delete; collapsible “Manage groups” panel with type-group-name confirmation before Delete is enabled
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/GroupFilterBar.jsx`

## [2026-08-26 18:45] Agents & goals — groups + copy with timestamp

- **Prompt Provided:** Group agents and goals into named folders; copy agent/goal with same config and name suffixed with date/time for editing
- **Architectural Flow:** EntityGroup model (type agent|goal); Agent.group / Goal.group refs; `/api/groups` CRUD; POST `/api/agents/:id/copy` and `/api/goals/:id/copy` via `copyNameWithTimestamp`; list pages group sections + filter + assign dropdown
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/EntityGroup.js`, `backend/src/models/Agent.js`, `backend/src/models/Goal.js`, `backend/src/utils/copyName.js`, `backend/src/routes/groups.js`, `backend/src/routes/agents.js`, `backend/src/routes/goals.js`, `backend/src/index.js`, `frontend/src/lib/groupedList.js`, `frontend/src/components/GroupFilterBar.jsx`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/GoalsPage.jsx`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 16:50] Multi-action completion routing (goals + triggers)

- **Prompt Provided:** On success and failure, LLM/rules pick parallel follow-ups (instructions + goals) with parent result injected; configure on Goals and Operations triggers
- **Architectural Flow:** Goal/Trigger `completionActions` + `completionActionsPickMode`; `completionActionsRunner.js` rule/LLM multi-pick → parallel `enqueueTask` with parent context block and `{{result}}` templates; worker complete handler after outcome routing
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/completionActions.js`, `backend/src/utils/completionActionsRunner.js`, `backend/src/models/Goal.js`, `backend/src/models/Trigger.js`, `backend/src/routes/goals.js`, `backend/src/routes/triggers.js`, `backend/src/routes/worker.js`, `frontend/src/components/CompletionActionsEditor.jsx`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 15:48] Skills page — show created timestamps

- **Prompt Provided:** Show time when demonstrations, skills, and drafts were created on /skills
- **Architectural Flow:** SkillsPage shows `Created` timestamps (with seconds) on suggested workflow rows and skill library rows via `formatChatMessageTime`
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 15:36] Skills — unified draft + suggested workflows (no training duplicate)

- **Prompt Provided:** Simplify skills UX — one draft per workflow, demonstrations when task completes, drop training status clutter
- **Architectural Flow:** `ensureSkillSuggestionFromTask` creates linked Demonstration + draft Skill on task complete; Teach skill links to same draft; `training` migrated to `draft`; Skills UI splits Suggested workflows vs Skill library
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/skillSuggestion.js`, `backend/src/utils/skillLearn.js`, `backend/src/utils/demoSession.js`, `backend/src/routes/worker.js`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/components/TrajectoryPanel.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 13:26] Goals save — fix missing writeAudit import

- **Prompt Provided:** Server error on goal save: writeAudit is not defined
- **Architectural Flow:** Restore `writeAudit` import removed during outcome-branches work in goals router
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/goals.js`

## [2026-08-26 13:02] Operations triggers — visible chat threads + reuse

- **Prompt Provided:** Cannot see messages in chat when testing outcome routing via Operations triggers
- **Architectural Flow:** Triggers reuse `actionConfig.chatId` per trigger; enqueue posts system queued message; events/task.completed carry `chatId`; Operations + Chats + ChatDetail link to trigger threads
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/triggerEngine.js`, `backend/src/utils/enqueueTask.js`, `backend/src/routes/worker.js`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/pages/ChatsPage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 12:32] LLM outcome routing on task completion (goals + triggers)

- **Prompt Provided:** Along with current event triggering, use LLM to decide which outcome branch fires based on agent result (e.g. weather &lt; 50)
- **Architectural Flow:** Goal/Trigger `outcomeBranches` + `outcomeRoutingEnabled`; `resultRouter.js` classifies `resultSummary` after existing success/failure completion events; emits chosen event → existing event triggers fire
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/outcomeBranches.js`, `backend/src/utils/resultRouter.js`, `backend/src/models/Goal.js`, `backend/src/models/Trigger.js`, `backend/src/routes/goals.js`, `backend/src/routes/triggers.js`, `backend/src/routes/worker.js`, `frontend/src/components/OutcomeBranchesEditor.jsx`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 12:10] Live screen — Teach skill button + floating chat in zoom

- **Prompt Provided:** Teach skill button beside Zoom/Take control; floating chat widget in full-screen zoom to see chat activity
- **Architectural Flow:** Take control = handoff only (no demo); Teach skill = session + demo capture; `FloatingChatWidget` polls chat in zoom modal when `chatId` passed from ChatDetailPage
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/components/FloatingChatWidget.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/pages/SkillsPage.jsx`

## [2026-08-26 12:02] Chat — show which skill was picked and why

- **Prompt Provided:** In chat, see which skill is picked up and why
- **Architectural Flow:** Slash invoke stores `pickReason` at queue; worker emits `skill_selected` with trigger/template/none reason; `SkillPickNotice` in thread + active-run bar
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/chats.js`, `backend/src/routes/worker.js`, `worker/src/browserState/skills.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `frontend/src/components/SkillPickNotice.jsx`, `frontend/src/lib/skillPick.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 11:54] Skills page — delete demonstration button

- **Prompt Provided:** Add delete button on skill demonstrations list
- **Architectural Flow:** `DELETE /api/skills/demos/:demoId` removes demo, unlinks `sourceDemonstration` on skills; Skills page row delete with confirm
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 11:46] Goals page — delete goal button

- **Prompt Provided:** Delete button on /goals page
- **Architectural Flow:** Wire existing `DELETE /api/goals/:id` to Goals list row with confirm dialog
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/GoalsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 11:44] Skills page — delete skill button

- **Prompt Provided:** Delete skill button on Skills page
- **Architectural Flow:** `DELETE /api/skills/:id` removes skill, clears demo `convertedSkill` links; Skills list row delete with confirm
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 09:50] Chat detail — scroll right rail to goal box

- **Prompt Provided:** Cannot scroll down to goal/instructions box; need page scroller
- **Architectural Flow:** Remove rail `overflow-hidden`; aside + control panel scroll vertically; snapshot fixed max-height (no flex-1 steal); mobile chat page flows in main scroll
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/PageSnapshotPanel.jsx`

## [2026-08-26 09:46] Chats page — delete chat button

- **Prompt Provided:** Add delete chat button on chats page
- **Architectural Flow:** `DELETE /api/chats/:id` cancels active/pending tasks scoped to thread, removes messages/tasks/chat; ChatsPage row action with confirm
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/chats.js`, `frontend/src/pages/ChatsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-26 09:42] Fix blank main content — revert aggressive #root flex rule

- **Prompt Provided:** /agents, /goals, /live and all pages show only sidebar menu, no page content
- **Architectural Flow:** `#root > * { flex-direction: column }` overrode ProtectedLayout row flex; sidebar `h-full` consumed viewport; main clipped to 0. Remove rule; main scrolls (`overflow-y-auto`); chat page keeps `flex-1 h-full` fill
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/index.css`, `frontend/src/App.jsx`

## [2026-08-26 09:38] Chat detail — three separate rail sections (snapshot / trajectory / goal)

- **Prompt Provided:** Page snapshot, Trajectory, and Goal/instructions should be 3 sections; stop bundling them in one scroller
- **Architectural Flow:** Remove nested `overflow-y-auto` wrapper; each panel is its own bordered card; snapshot flexes on desktop with internal scroll; trajectory + goal stay distinct shrink sections
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/PageSnapshotPanel.jsx`, `frontend/src/components/TrajectoryPanel.jsx`

## [2026-08-26 09:36] Chat detail desktop — fill viewport (no teal bottom strip)

- **Prompt Provided:** Teal strip at very bottom of browser window on desktop
- **Architectural Flow:** `#root` + providers pass `100dvh`; ProtectedLayout `h-dvh overflow-hidden`; chat page `flex-1 h-full`; grid stretches thread + aside to fill main
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/index.css`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-26 09:32] Chat detail — eliminate bottom strip (layout + live screen cover)

- **Prompt Provided:** Bottom strip still visible after removing mobile dock
- **Architectural Flow:** flex-1 height chain App→main→chat; grid `items-start` stops empty thread stretch; live screen `object-fit: cover` removes black letterbox bar; page flex-1 only on lg
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/App.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/index.css`

## [2026-08-26 09:30] Chat detail — remove bottom strip (no fixed mobile dock)

- **Prompt Provided:** Empty strip at bottom of chat page returned; remove completely
- **Architectural Flow:** Dropped fixed mobile dock + thread padding hack; agent rail flows inline below messages on mobile; desktop sticky aside unchanged
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-26 09:28] Chat detail — Page snapshot not squeezed in flex box

- **Prompt Provided:** Page snapshot appears trapped inside a box after live screen layout change
- **Architectural Flow:** Remove compact `h-full`/`flex-1` on snapshot panel; use fixed max-height scroll area; right rail scrolls as one column
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/PageSnapshotPanel.jsx`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-26 09:24] Chat detail — live screen box layout (no inner scroll)

- **Prompt Provided:** Chat page live screen has bottom strip and inner scroller; show as clean box
- **Architectural Flow:** Aspect-ratio frame wraps LiveScreen; screenshot uses `object-fit: contain` + `overflow-hidden`; mobile dock pins screen on top, removes empty spacer strip; demo notice moved inside screen chrome
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/index.css`

## [2026-08-26 09:16] Clarify LLM errors — MiniMax 503 vs wrong Base URL

- **Prompt Provided:** User sees "Received HTML instead of JSON — check Base URL" for MiniMax
- **Architectural Flow:** Production Base URL already `https://api.minimax.io/v1`; MiniMax returns nginx 503 HTML; worker/API test now distinguish provider outage from YamBot URL misconfig
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/llm.js`, `backend/src/utils/llmTest.js`

## [2026-08-26 09:12] Fix worker crash — missing formatSkillsCatalogBlock export

- **Prompt Provided:** Live screen stuck on STARTING at bot.vughy.com chat; workers crash-looping
- **Architectural Flow:** Phase C added `formatSkillsCatalogBlock` import in `agent.js` but omitted re-export from `browserState/index.js`; worker exits on boot → no heartbeat → UI shows STARTING…
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserState/index.js`

## [2026-08-25 21:15] Common chat Phase D — LLM auto-router with confirm

- **Prompt Provided:** Implement Phase D auto-router for common chat
- **Architectural Flow:** `Chat.autoRoute`; heuristic + LLM `routeCommonChat`; 409 confirm when confidence < 72%; skill-aware scoring; dispatch source `router`
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Chat.js`, `backend/src/utils/llmChat.js`, `backend/src/utils/chatRouter.js`, `backend/src/routes/chats.js`, `frontend/src/lib/api.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 21:00] Common chat Phase C — Hermes-style skills (SKILL.md, /slash, /learn)

- **Prompt Provided:** Implement Phase C — Hermes borrow for skills
- **Architectural Flow:** Skill `playbookMd` + `slug`; chat `/skill-slug` sets `Task.invokedSkill`; `/learn` drafts from trajectory; worker progressive catalog + full skill fetch; auto skill suggestion on successful runs
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Skill.js`, `backend/src/models/Task.js`, `backend/src/utils/skillMd.js`, `backend/src/utils/skillSlash.js`, `backend/src/utils/skillLearn.js`, `backend/src/routes/skills.js`, `backend/src/routes/chats.js`, `backend/src/routes/worker.js`, `worker/src/browserState/skills.js`, `worker/src/agent.js`, `frontend/src/lib/skillSlash.js`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 20:40] Common chat Phase B — @mention, default agent, labels, multi-agent queue

- **Prompt Provided:** Implement Phase B for common chat
- **Architectural Flow:** `@Agent` mention resolves dispatch; `defaultAgent` pin + `lastDispatchAgent` fallback; user message meta shows agent; chat-scoped queue grouped by agent with multiple actives
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Chat.js`, `backend/src/utils/mentionAgent.js`, `backend/src/routes/chats.js`, `frontend/src/lib/mentionAgent.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/AgentTaskQueue.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 20:20] Common chat — agent-agnostic thread + per-message dispatch

- **Prompt Provided:** Implement common chat alongside existing agent-bound chats
- **Architectural Flow:** `Chat.kind: common` with no bound agent; `POST messages` requires `agentId` per goal; live screen follows active task's agent; agent chats unchanged
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Chat.js`, `backend/src/routes/chats.js`, `frontend/src/pages/ChatsPage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 16:55] Fix CompanyEvent source enum for demo.captured

- **Prompt Provided:** CompanyEvent validation failed: source `skills` is not a valid enum value
- **Architectural Flow:** Add `skills`, `worker`, and other in-use sources to `EVENT_SOURCES` so demo finish can emit `demo.captured`
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/CompanyEvent.js`

## [2026-08-25 16:48] Demo recording tied to Take control session (server-side)

- **Prompt Provided:** Take control / give back — nothing saved, user wants to record a skill
- **Architectural Flow:** `POST /api/agents/:id/control` session toggle starts/finishes demo on server; response includes demonstration; LiveScreen shows persistent success banner + Skills link
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-25 16:28] Fix demo save on Give control back

- **Prompt Provided:** User does not see "demonstration saved" or demo.captured events after Take control
- **Architectural Flow:** Server auto-finishes demo when control session ends; skills-facing demo API; LiveScreen shows recording/success/errors prominently
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/demoSession.js`, `backend/src/routes/skills.js`, `backend/src/routes/worker.js`, `backend/src/routes/agents.js`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/pages/SkillsPage.jsx`

## [2026-08-25 16:00] Skills Phase 3 — replay mode + verification enforcement

- **Prompt Provided:** Go Phase 3 on Skills
- **Architectural Flow:** Skill `executionMode: replay` runs demo actions (click/type/navigate) before LLM; `enforceVerification` fails task when rules don't match; demos keep structured action objects
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Skill.js`, `backend/src/routes/skills.js`, `worker/src/browserState/skillReplay.js`, `worker/src/browserState/skills.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 15:35] Skills Phase 2 — trajectory demos, ops links, stats, human URL capture

- **Prompt Provided:** Go Phase 2 on Skills
- **Architectural Flow:** Task trajectory → demo API; Operations skill events link to /skills; worker records URL/control during human demo + skill stats on complete; verification hints on finish
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Agent.js`, `backend/src/routes/skills.js`, `backend/src/routes/worker.js`, `worker/src/browserState/skills.js`, `worker/src/agent.js`, `frontend/src/components/TrajectoryPanel.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 15:05] Skills Phase 1 — demos, edit, training queue, worker injection

- **Prompt Provided:** Go Phase 1 on Skills — demo recording on Take control, skill edit API/UI, training queue polish, production skill prompt injection
- **Architectural Flow:** Take control → `/api/worker/demos/*` → convert/edit skill → worker `GET /api/worker/skills` → `detectDbSkill` in agent prompt
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/skills.js`, `backend/src/routes/worker.js`, `worker/src/browserState/skills.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/App.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 14:40] Operations trigger edit button

- **Prompt Provided:** On `/operations`, add Edit button alongside Delete on triggers
- **Architectural Flow:** Edit loads trigger into existing form → PUT `/api/triggers/:id` → list refresh
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 14:36] Trigger completion events (chain triggers)

- **Prompt Provided:** On trigger form, when this trigger's task completes, emit custom event (e.g. crm.logout.done) to fire another trigger
- **Architectural Flow:** Trigger `completionEventType` → task stores `triggerRef` → worker `/complete` emits custom CompanyEvent → downstream triggers listen on bus
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Trigger.js`, `backend/src/models/Task.js`, `backend/src/utils/enqueueTask.js`, `backend/src/routes/triggers.js`, `backend/src/routes/worker.js`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-25 13:58] Goal completion events + true event triggers

- **Prompt Provided:** True triggers — optional event type when goal finishes; IF crm.aanya.found THEN enqueue_task on worker agent
- **Architectural Flow:** Goal `completionEventType` → worker `/complete` emits custom CompanyEvent (plus `task.completed`) → Operations trigger form picks event type + agent + task text → `processEventTriggers` enqueues follow-up task (reuses `chatId` from event payload when present)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Goal.js`, `backend/src/routes/goals.js`, `backend/src/routes/worker.js`, `backend/src/routes/triggers.js`, `backend/src/utils/triggerEngine.js`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/pages/OperationsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 16:50] Chat message timestamps with seconds

- **Prompt Provided:** In chat, for every message, show the time along with seconds
- **Architectural Flow:** `GET /api/chats/:id` returns messages with Mongoose `createdAt` → `ChatDetailPage` renders `<time>` per bubble via `formatChatMessageTime()`
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/lib/formatDateTime.js`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-24 16:05] Faster step pacing (tunable settle + retry delays)

- **Prompt Provided:** Can we reduce delay time between each step?
- **Architectural Flow:** `stepTiming.js` centralizes post-action settle (1s), DOM stable (180ms), LLM/parse retry (800/500ms) — env `YAMBOT_*` overrides; prompt nudges shorter model `wait` actions
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/stepTiming.js`, `worker/src/agent.js`, `worker/src/actions.js`

## [2026-08-24 15:42] Fix OpenAI OAuth showing MiniMax model after connect

- **Prompt Provided:** ChatGPT connection UI shows `email · model MiniMax-M2.7` after OAuth connect
- **Architectural Flow:** Connect always sets `gpt-4o` → `resolveOpenAiOAuthModel()` rejects MiniMax names at runtime → boot migration fixes existing OAuth users in Mongo
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/openaiCodex.js`, `backend/src/utils/llmOAuth.js`, `backend/src/utils/llmCredentials.js`, `backend/src/routes/settings.js`, `backend/src/utils/seedLlm.js`

## [2026-08-24 15:30] Settings submenu + OpenAI OAuth only (no LiteLLM)

- **Prompt Provided:** Submenu under Settings with OpenAI OAuth only — click connect and use ChatGPT account as LLM
- **Architectural Flow:** `/settings/llm` API key tab + `/settings/openai` ChatGPT PKCE OAuth → encrypted tokens on User → `resolveLlmCredentials()` + worker Codex `/responses` path
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/openaiCodex.js`, `backend/src/utils/llmOAuth.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/llmDefaults.js`, `backend/src/utils/llmTest.js`, `backend/src/utils/seedLlm.js`, `backend/src/routes/settings.js`, `backend/src/routes/worker.js`, `backend/src/index.js`, `worker/src/openaiCodex.js`, `worker/src/llm.js`, `worker/src/agent.js`, `frontend/src/pages/SettingsLayout.jsx`, `frontend/src/pages/SettingsOpenAiPage.jsx`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/App.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 15:18] Restore Test LLM button on Settings (API-key only)

- **Prompt Provided:** Add back Test LLM on /settings without OAuth or LiteLLM
- **Architectural Flow:** Settings form → `POST /api/settings/test-llm` → `probeLlmConnection()` one-shot `/chat/completions` with form or saved key → success/error shown in UI
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/llmTest.js`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 15:10] Fix LLM HTML error after LiteLLM removal (stale base URL)

- **Prompt Provided:** Goal runs fail with `LLM error — retrying… (<html>…viewport…)` — worker receives YamBot SPA HTML instead of JSON
- **Architectural Flow:** Boot migration + runtime normalize strip LiteLLM/YamBot URLs and gateway model aliases → workers call `https://api.minimax.io/v1` → clearer HTML detection in worker `llm.js`
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/llmDefaults.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/seedLlm.js`, `backend/src/routes/settings.js`, `worker/src/llm.js`

## [2026-08-24 15:00] Remove OAuth, LiteLLM gateway, Test LLM — API key only

- **Prompt Provided:** Remove OAuth/LiteLLM/Test LLM; use API key only like before; deploy
- **Architectural Flow:** Settings API-key-only → workers call provider `/v1` directly via runtime-config → drop LiteLLM/OAuth stack from compose and codebase
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/SettingsPage.jsx`, `backend/src/routes/settings.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/seedLlm.js`, `backend/src/index.js`, `backend/src/routes/worker.js`, `backend/src/utils/env.js`, `worker/src/llm.js`, `worker/src/agent.js`, `worker/src/browserState/planner.js`, `deploy/docker-compose.yml`, `deploy/remote-deploy.py`, `deploy/.env.example`, `backend/.env.example`, `frontend/src/help/helpContent.js`; deleted OAuth/LiteLLM modules and components

## [2026-08-24 14:56] Remove Test LLM connection from Settings

- **Prompt Provided:** Remove everything related to test LLM; use API key only like before
- **Architectural Flow:** Delete `POST /api/settings/test-llm` and Settings UI button; workers still load credentials via runtime-config (no pre-flight test)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/settings.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/litellmClient.js`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 14:52] Fix LiteLLM credential unique constraint on ChatGPT reconnect

- **Prompt Provided:** Unique constraint failed on credential_name when connecting ChatGPT again
- **Architectural Flow:** import-codex upserts credentials — PATCH existing `yambot_u_{userId}` tokens, POST only when missing (reconnect no longer hits Prisma unique violation)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/litellmClient.js`

## [2026-08-24 14:48] Fix LiteLLM ChatGPT model create (minimax upstream bug)

- **Prompt Provided:** Model create saved to DB but not live in router — Error upserting deployment, original model: minimax
- **Architectural Flow:** Connect ChatGPT must register `chatgpt/*` upstream (not user's MiniMax selection) → delete stale per-user deployment before recreate → import-codex resolves ChatGPT catalog model server-side
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/litellmClient.js`, `backend/src/routes/litellmGateway.js`, `frontend/src/pages/SettingsPage.jsx`

## [2026-08-24 14:40] Fix ChatGPT OAuth invalid_authorize_request

- **Prompt Provided:** invalid_authorize_request JSON when signing in with ChatGPT
- **Architectural Flow:** Codex OAuth uses localhost redirect + codex originator + short state stored server-side (OpenAI rejects long signed state / 127.0.0.1 redirect)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/openaiCodex.js`, `backend/src/utils/llmOAuth.js`, `worker/src/openaiCodex.js`, `frontend/src/components/LlmOAuthModal.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 14:35] ChatGPT connect — browser sign-in primary (device code broken)

- **Prompt Provided:** invalid_authorize_request / auth.openai.com/codex/device Not Found after Connect ChatGPT
- **Architectural Flow:** Connect ChatGPT opens Codex PKCE popup + paste URL (works on web) → import tokens to LiteLLM credentials; device-code modal removed from primary path
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/components/LlmOAuthModal.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 14:30] Settings: always show Connect ChatGPT in gateway mode

- **Prompt Provided:** In Settings cannot see Connect ChatGPT
- **Architectural Flow:** Gateway UI when `litellmEnabled` (not gated on `llmGatewayMode`) → ChatGPT connect block always visible → normalize MiniMax model id for catalog match
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`

## [2026-08-24 12:00] Fix ChatGPT OAuth — LiteLLM Postgres password drift + browser fallback

- **Prompt Provided:** OpenAI authentication unknown_error during ChatGPT device-code sign-in
- **Architectural Flow:** Postgres password synced on deploy (volume init vs .env mismatch) → remove static chatgpt models from litellm config → device-code modal uses auth.openai.com/codex/device → browser PKCE paste fallback imports tokens into LiteLLM credentials
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/remote-deploy.py`, `deploy/litellm.config.yaml`, `backend/src/utils/litellmClient.js`, `backend/src/routes/litellmGateway.js`, `frontend/src/components/LlmGatewayModal.jsx`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 11:45] Fix gateway mode — seed LiteLLM secrets in remote-deploy .env

- **Prompt Provided:** Gateway mode doesn't appear; add env vars and deploy
- **Architectural Flow:** `remote-deploy.py` now preserves/generates `LITELLM_*` keys in server `deploy/.env` so API `isLitellmEnabled()` is true after every deploy
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/remote-deploy.py`

## [2026-08-24 11:20] Integrate LiteLLM as LLM gateway (OAuth + all providers)

- **Prompt Provided:** Integrate LiteLLM as the LLM gateway (OAuth + all providers there)
- **Architectural Flow:** Docker Compose adds Postgres + LiteLLM proxy → YamBot API mints per-user virtual keys → workers call `http://litellm:4000/v1` → Settings proxies ChatGPT device-code OAuth to LiteLLM admin routes → per-user ChatGPT models use `oauth:yambot_u_{userId}` credentials
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/docker-compose.yml`, `deploy/litellm.config.yaml`, `deploy/.env.example`, `backend/src/utils/env.js`, `backend/src/utils/litellmClient.js`, `backend/src/routes/litellmGateway.js`, `backend/src/utils/llmCredentials.js`, `backend/src/models/User.js`, `backend/src/routes/settings.js`, `backend/src/index.js`, `backend/src/utils/seedLlm.js`, `backend/.env.example`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/components/LlmGatewayModal.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-24 11:05] OpenAI ChatGPT sign-in — built-in OAuth, no client credentials

- **Prompt Provided:** OpenAI OAuth should open login page and auto-retrieve tokens; user should not enter Client ID/Secret
- **Architectural Flow:** Built-in Codex public PKCE client → popup sign-in at auth.openai.com → paste loopback callback URL → encrypted access/refresh tokens + ChatGPT account id → Codex backend API for worker/test-llm
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/openaiCodex.js`, `backend/src/utils/llmOAuth.js`, `backend/src/models/User.js`, `backend/src/routes/settings.js`, `backend/src/utils/llmCredentials.js`, `backend/src/routes/worker.js`, `worker/src/openaiCodex.js`, `worker/src/llm.js`, `worker/src/agent.js`, `worker/src/browserState/planner.js`, `frontend/src/components/LlmOAuthModal.jsx`

## [2026-08-24 10:50] OAuth popup connect + per-user OAuth app credentials

- **Prompt Provided:** OAuth shows "not configured on this server"; user wants popup to pick provider and sign in on provider site to store tokens
- **Architectural Flow:** Always list all LLM OAuth providers; modal + popup window for connect; optional per-user OAuth Client ID/Secret when server env empty; callback HTML postMessages opener
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/llmOAuth.js`, `backend/src/models/User.js`, `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/components/LlmOAuthModal.jsx`

## [2026-08-24 10:40] Settings: LLM OAuth alongside API key

- **Prompt Provided:** Add OAuth option on Settings alongside current API key auth (Azure OpenAI, Google Gemini, optional OpenAI)
- **Architectural Flow:** PKCE OAuth connect on Settings → encrypted tokens on User.settings → resolveLlmCredentials() for test-llm + worker runtime-config; callback route unauthenticated with signed state
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/llmOAuth.js`, `backend/src/utils/llmCredentials.js`, `backend/src/models/User.js`, `backend/src/routes/settings.js`, `backend/src/routes/worker.js`, `backend/src/index.js`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/help/helpContent.js`, `backend/.env.example`

## [2026-08-24 09:45] Feature branch: Playwright + Google Chrome (not bundled Chromium)

- **Prompt Provided:** Try Playwright+Chrome; create feature branch so main stays deployable fallback
- **Architectural Flow:** `feature/playwright-chrome` branch; `YAMBOT_BROWSER_CHANNEL=chrome`; Dockerfile installs Chrome via Playwright; launchPersistentContext uses `channel: 'chrome'`
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/Dockerfile.worker`, `worker/src/config.js`, `worker/src/agent.js`, `worker/entrypoint.sh`, `computer-manager/src/index.js`

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
