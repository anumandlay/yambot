# PROMPT_LOG.md

## [2026-09-23 13:15] Fix type Illegal invocation in setNativeValue

- **Prompt Provided:** Step 15 type failed — frame.evaluate TypeError: Illegal invocation at setNativeValue.
- **Architectural Flow:** `setNativeValue` no longer blindly calls `HTMLInputElement.prototype.value.set` on whatever ref resolved (wrappers / wrong prototype → Illegal invocation). Walks the real prototype chain, prefers nested input inside textbox wrappers, falls back to `.value=` / attribute. Agent `type` catches remaining Illegal invocation and types via Playwright keyboard.
- **Impacted Files:** worker/src/pageDom.js, worker/src/agent.js, worker/test/setNativeValue.test.js, PROMPT_LOG

## [2026-09-23 13:10] One-command VPS install script

- **Prompt Provided:** Installation script so other users paste one link on a new VPS and get the whole project running.
- **Architectural Flow:** Root `install.sh` (curl|bash): install Docker → clone branch → generate `deploy/.env` secrets + public URL → optional Caddy HTTPS → `docker compose up -d --build`. Compose `PUBLIC_API_URL` / `CORS_ORIGINS` now read from `.env` so any domain works. Documented in README + deploy/README.
- **Impacted Files:** install.sh, deploy/docker-compose.yml, deploy/.env.example, README.md, deploy/README.md, PROMPT_LOG

## [2026-09-23 10:15] Fast path for simple open/go-to URL goals

- **Prompt Provided:** Why so long for open example.com / open vughy.com — speed up “just open”.
- **Architectural Flow:** Worker detects simple open/visit goals (`matchSimpleOpenGoal`), navigates once, reports title, completes — skips LLM observe/think loop (~3 min → ~seconds). Also allow extracting example.com when user said open/go to.
- **Impacted Files:** worker/src/simpleOpen.js, worker/src/agent.js, worker/test/simpleOpen.test.js, PROMPT_LOG

## [2026-09-23 10:00] Fix “yes” after open offer never starting computer

- **Prompt Provided:** Chat: can you open example.com → Want me to? → yes → Got it. Nothing happens.
- **Architectural Flow:** cheapChatReplyIfAny no longer swallows yes/ok/sure. Affirmative confirms recover the prior browse goal when the assistant offered to run. Concrete “can you open example.com” force-queues (question_shaped_but_actionable).
- **Impacted Files:** chatAutoTurn.js, chats.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-23 09:55] Fix queue Delete 16MB BSON error

- **Prompt Provided:** Delete on agent queue box → Server error “Resulting document after update is larger than 16777216”.
- **Architectural Flow:** Pending NSE task was requeued with 666 huge thinking/llm events (~16MB). Delete used events.push+save and tipped over the limit. Fix: cancel via $set replacing events/trajectory; slim worker event payloads; trim event array; catch BSON overflow on worker saves.
- **Impacted Files:** taskDocGuard.js, chats.js, worker.js, taskDocGuard.test.js, PROMPT_LOG

## [2026-09-23 09:52] Remove /grok/jev-lab A/B page

- **Prompt Provided:** Remove /grok/jev-lab page.
- **Architectural Flow:** Deleted JevLabPage, grok rail link, route, and dry-run POST /api/agents/:id/jev-lab. Production Auto Jev gate (AI Gateway) remains.
- **Impacted Files:** App.jsx, GrokStylePage.jsx, JevLabPage.jsx (deleted), agents.js, PROMPT_LOG

## [2026-09-23 09:40] Jev lab A/B page (dual threads under /grok)

- **Prompt Provided:** Put a toggle on grok-style page, or a test page with one message box and two chat thread viewers.
- **Architectural Flow:** New dry-run `POST /api/agents/:id/jev-lab` with `jevMode=on|off` (no chat write / no task enqueue). `runChatAutoTurn` accepts per-request `jevMode`. Frontend `/grok/jev-lab` sends one message to both paths in parallel and shows two threads. Linked from grok rail as “Jev lab (A/B)”.
- **Impacted Files:** jevEvaluate.js, chatAutoTurn.js, agents.js, JevLabPage.jsx, GrokStylePage.jsx, App.jsx, jevAutoGate.test.js, PROMPT_LOG

## [2026-09-23 09:25] Jev via Vercel AI Gateway for Auto REPLY vs QUEUE_GOAL

- **Prompt Provided:** Use Jev with the user’s Vercel AI Gateway API key in YamBot.
- **Architectural Flow:** Auto calls `POST https://ai-gateway.vercel.sh/v1/evaluate` (model `typesafe-ai/jev`) before the Hermes LLM turn. Confident `reply` → Q&A stream; confident `queue_goal` → enqueue; uncertain/errors → existing Auto LLM with a Jev hint. Key lives in gitignored `deploy/.deploy.local.env` → VPS `deploy/.env` via remote-deploy.
- **Impacted Files:** jevEvaluate.js, chatAutoTurn.js, env.js, docker-compose.yml, remote-deploy.py, .env examples, jevAutoGate.test.js, PROMPT_LOG

## [2026-09-22 20:15] Mid-run messages: new API request, not inject into live LLM

- **Prompt Provided:** When a task is running and I send a new message, instead of injecting into the next LLM call, send a new API request separately.
- **Architectural Flow:** ChatDetailPage no longer POSTs `/tasks/:id/inject` for Auto while running. Composer always uses the normal `/messages` stream (Hermes Auto reply or queue_goal pending behind the active run). Inject endpoint remains for explicit tooling; UI/help copy updated.
- **Impacted Files:** ChatDetailPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-22 14:45] Live screen follows the open agent chat (not stuck on Trial India)

- **Prompt Provided:** On /grok/:chatId the agent screen stayed on Trial Expiry even after switching agents.
- **Architectural Flow:** ChatDetailPage stays mounted across chatId changes; `watchAgentId` stuck on the previous agent and won over `chat.agent`. Fix: agent-bound chats always use the bound agent for LiveScreen; clear watch on chatId change; Watch-agent auto-pick only in common chat; remount/clear LiveScreen on agentId change.
- **Impacted Files:** ChatDetailPage.jsx, LiveScreen.jsx, PROMPT_LOG

## [2026-09-22 14:40] Plug Mem0 into group rooms

- **Prompt Provided:** Wire Mem0 into rooms (e.g. Website Ops) like 1:1 agent chats.
- **Architectural Flow:** `cheapRoomMemberReply` now calls `resolveCuratedMemoryForPrompt` (curated Mongo + Mem0 search merge) instead of empty curated arrays. After non-PASS room replies, `mem0IngestChatTurn` stores durable facts per speaking agent. Reply meta records mem0 merge counts.
- **Impacted Files:** roomTurn.js, PROMPT_LOG

## [2026-09-22 14:30] “Tell general agent to …” — peer fan-out, not sender Chromium

- **Prompt Provided:** `tell general agent to open vughy.com` showed “Starting Trial India’s computer”.
- **Architectural Flow:** Natural-language peer asks (no `@`) now parse via `parseNaturalPeerAsk` / `resolvePeerAskAssignments` into the existing waiting_peer fan-out (General’s computer only). Clear assistant ack. `defaultQueueAck` no longer says “Starting … computer” for tell/ask peer goals.
- **Impacted Files:** mentionAgent.js, chats.js, roomTurn.js, chatAutoTurn.js, mentionPeerAsk.test.js, PROMPT_LOG

## [2026-09-22 14:22] Faster finish → chat result (skip JPEG / post bubble early)

- **Prompt Provided:** After open example.com the page loaded quickly but the final chat message lagged ~16s.
- **Architectural Flow:** Post-LLM `waitWhileHumanControl` was taking a full live-screen JPEG; finish also screenshotted before `/complete`. Fix: human-control wait uses screenshot:false; finish/ask_user skip JPEG; `complete` posts the result Message right after task.save; curated MEMORY extract is fire-and-forget. Same early-result pattern for API agent finalize.
- **Impacted Files:** worker/src/agent.js, backend/src/routes/worker.js, backend/src/utils/apiAgentRunner.js, PROMPT_LOG

## [2026-09-22 14:00] LLM owns REPLY vs QUEUE_GOAL (classifier hint)

- **Prompt Provided:** Give the live-computer decision to the LLM so it understands question vs start computer more clearly.
- **Architectural Flow:** Stop force-queuing on URL/domain. Auto system prompt gets an explicit DECISION frame; every model turn gets `[AUTO DECISION HINT]` from `classifyMessageIntent`. LLM chooses REPLY vs QUEUE_GOAL. Hard vetoes remain: day-history forced dayLogs answer, memory-store / day-history force-REPLY if model mis-queues, send-email/peer still force-queue.
- **Impacted Files:** chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 13:55] “Did we open nseindia.com today?” stays in dayLogs chat

- **Prompt Provided:** “did we opened nseindia.com today ?” started the computer.
- **Architectural Flow:** Domain tripped `has_url_or_domain` before past-tense day-history matched. Expand `looksLikeDayHistoryOrStatusRequest` for “did we open/visit … today”; answer yes/no from dayLogs via `formatDayHistoryChatAnswer(snapshot, question)`. Imperative “open https://…” still queues.
- **Impacted Files:** messageIntent.js, chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 13:50] Day-history ask: answer from dayLogs (not Mem0 pref echo)

- **Prompt Provided:** “tell me clearly what we did today with timestamp” replied “long scratchpads”.
- **Architectural Flow:** Path was correct (`day_history_forced_qa`) but LLM Q&A echoed a Mem0 short-reply/scratchpad pref. Now format answer deterministically from `snapshot.dayHistoryRecent/Relevant` (agent `dayLogs`) — no LLM for that ask.
- **Impacted Files:** chatAutoTurn.js (`formatDayHistoryChatAnswer`), hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 13:45] Auto: day-history / “what we did today” stays chat

- **Prompt Provided:** “tell me clearly what we did today with timestamp” started the computer.
- **Architectural Flow:** Model text_fallback chose QUEUE_GOAL and invented a browse goal from thread. Added `looksLikeDayHistoryOrStatusRequest` + `looksLikeVagueChatFollowup`; classify as question; Auto short-circuits to forced Q&A (`answerChatQuestion`/`streamChatQuestion`); `ensureAutoTurnResult` also force-REPLies if somehow queued. Cheap reply for bare “what”.
- **Impacted Files:** messageIntent.js, chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 13:20] Auto: memory-store prefs with URLs stay chat (no computer)

- **Prompt Provided:** Fix Auto so remember/store preferences stays chat-only even when URLs are listed.
- **Architectural Flow:** Live Part-1 paste hit `has_url_or_domain` → heuristic queue → Chromium. New `looksLikeMemoryStoreRequest` classifies those as `memory_store_request` (question) before URL/action checks. `autoTurnHeuristicGate` leaves them to the model; `ensureAutoTurnResult` force-REPLies if the model still queues. Auto prompt documents MEMORY STORE rule.
- **Impacted Files:** messageIntent.js, chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 13:05] Big Mem0 live suite (multi-fact + isolation + ingest)

- **Prompt Provided:** Bigger Mem0 test, not a small one.
- **Architectural Flow:** Suite stores 15 facts (10 agent / 4 user / 1 other-agent), 14 paraphrased searches, agent+user scope isolation, ephemeral reject, chat ingest (greeting skip + LLM extract), `resolveCuratedMemoryForPrompt` merge. Script: `scripts/_mem0_big_suite_turn.py`.
- **Impacted Files:** scripts/_mem0_big_suite_turn.py, PROMPT_LOG

## [2026-09-22 12:55] Mem0 embed: accept FastEmbed Float32Array rows

- **Prompt Provided:** Test Mem0 with an example — add returned `embed_failed` after FastEmbed init.
- **Architectural Flow:** FastEmbed yields `Float32Array` vectors; `Array.isArray` skipped them. Normalize via `Array.from` so store/search work.
- **Impacted Files:** mem0Service.js, PROMPT_LOG

## [2026-09-22 12:50] Fix API npm ci (lockfile sync + fail-hard Dockerfile)

- **Prompt Provided:** Test Mem0 with an example (API crash-looped: missing `cors`).
- **Architectural Flow:** Incomplete lockfile made `npm ci` fail; Dockerfile `… || true` hid the failure so the image shipped with no deps. Regenerated full `package-lock.json`; `npm ci` must fail the build; onnx rebuild stays best-effort. Then re-run live Mem0 add→search example.
- **Impacted Files:** backend/package-lock.json, deploy/Dockerfile.api, PROMPT_LOG

## [2026-09-22 12:45] Mem0-style FastEmbed+Qdrant (live example path)

- **Prompt Provided:** Test Mem0 with an example.
- **Architectural Flow:** mem0ai/oss Memory was unusable (MiniMax no embeddings; Qdrant client 1.19 dropped `search`; optional peer import hell). Replaced with YamBot `mem0Service`: local FastEmbed + Qdrant 1.12 client, same scoped add/search/merge API. Chat ingest uses Settings LLM to extract facts then upserts. Live example script validates store→retrieve.
- **Impacted Files:** mem0Service.js, package.json, Dockerfile.api, docker-compose, PROMPT_LOG

## [2026-09-22 12:40] Mem0 FastEmbed + Qdrant compat (live example)

- **Prompt Provided:** Test Mem0 with an example.
- **Architectural Flow:** First run: no site LLM key → Settings fallback. Second: MiniMax has no `/embeddings` (all models failed); Qdrant 1.13 vs client 1.19. Switch default embedder to local FastEmbed (`fast-bge-small-en-v1.5`, 384-d); Qdrant client `checkCompatibility: false`; bump image toward 1.14; Dockerfile rebuilds onnxruntime-node. Live add→search example script ready.
- **Impacted Files:** mem0Service.js, Dockerfile.api, docker-compose.yml, .env.example, package.json, PROMPT_LOG

## [2026-09-22 12:35] Mem0 falls back to Settings LLM when site key empty

- **Prompt Provided:** Test Mem0 with an example — first run failed (`no LLM API key`).
- **Architectural Flow:** VPS `DEFAULT_LLM_API_KEY` is empty (keys live in user Settings). `getMem0Memory({ userId })` now resolves Settings credentials when site/MEM0 env keys are missing, then runs add/search against Qdrant.
- **Impacted Files:** mem0Service.js, live example script, PROMPT_LOG

## [2026-09-22 12:30] Self-host Mem0 (Qdrant) + wire into YamBot memory

- **Prompt Provided:** Install Mem0 on our server and implement it in YamBot for clearer memory/context.
- **Architectural Flow:** Add Qdrant to deploy compose. API uses `mem0ai/oss` Memory (disableHistory) against Qdrant — data stays on VPS (Hub mem0-api-server image is stale). Curated writes also `mem0AddFact`; chat Auto/Q&A turns `mem0IngestChatTurn` (infer). `resolveCuratedMemoryForPrompt` merges Mem0 search hits ahead of Hermes USER/MEMORY; Memory chip shows `mem0 +N`. Pollution filter still applies. LLM/embed via DEFAULT_LLM_* (optional MEM0_* overrides).
- **Impacted Files:** mem0Service.js, semanticMemory.js, curatedMemoryOps.js, chats/enqueue/goals/workforce/scheduler/agentMessageBus/apiAgentRunner, docker-compose.yml, env.js, .env.example, package.json, tests, PROMPT_LOG

## [2026-09-22 12:25] Strip Auto scratchpad before REPLY (capability Q leak)

- **Prompt Provided:** Chat showed planning notes (“We need answer… capability question… Output REPLY…”) then the real sentence for “can you also open webistes for me”.
- **Architectural Flow:** Models glue scratchpad then `….REPLY\nYes…`. New `extractAfterLastReplyMarker` takes body after the last protocol REPLY/ANSWER (including glued punctuation). `parseAutoTurnOutput` / sanitize / stream / recover use it; deliberation detector covers capability-Q phrases; never keep long scratchpad as “fallback”. Prompt CRITICAL line requires first token REPLY/QUEUE_GOAL.
- **Impacted Files:** chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 12:20] Hermes-style Auto — model decides reply vs computer

- **Prompt Provided:** Follow Hermes: model always decides reply vs tools; “can you open websites” should not start the computer.
- **Architectural Flow:** Capability questions without a concrete URL/site classify as `capability_question` (chat). `autoTurnHeuristicGate` only force-queues URL/domain, peer A2A, send-email, explicit task — not action_verbs / “can you open…”. Auto prompt tells the model to reply for capability Qs and choose reply vs queue_goal itself.
- **Impacted Files:** messageIntent.js, chatAutoTurn.js, hermesAutoGate.test.js, PROMPT_LOG

## [2026-09-22 12:05] Tiny run-log chip + instant “hi” replies

- **Prompt Provided:** “hi” stuck on Sending; don’t want Run details as a thread bubble — only a small control to open the modal.
- **Architectural Flow:** Ops collapse to a tiny `≡ N` chip (opens same modal). Greetings/acks use `cheapChatReplyIfAny` (no LLM). Stream path clears busy as soon as the optimistic bubble appears so Send is not locked for the full reply.
- **Impacted Files:** RunOpsIconRow.jsx, ChatDetailPage.jsx, chatAutoTurn.js, chats.js, PROMPT_LOG

## [2026-09-22 11:55] Chat: one run-details bubble + fix scroll-up

- **Prompt Provided:** Cannot scroll up for earlier messages; replace inline ops chips with one bubble that opens a modal of all chips for that run.
- **Architectural Flow:** `RunOpsIconRow` collapses consecutive ops into a single “Run details · N events” bubble; modal lists every event and drills into detail. Group by taskId so retries stay separate. Chat thread: Load earlier button, lower stick-to-bottom threshold, touch/wheel unstick so polls don’t pin the viewport.
- **Impacted Files:** RunOpsIconRow.jsx, ChatDetailPage.jsx, FloatingChatWidget.jsx, PROMPT_LOG

## [2026-09-22 11:45] Fewer steps — skill intent gate + ask_user guards

- **Prompt Provided:** Register-on-Vughy run showed huge chip/step spam; user said “lets go” on skill-gate + no CUA-permission/password ask_user.
- **Architectural Flow:** `detectDbSkillMatch` rejects register↔trial-admin intent conflicts and stops counting generic tokens (`open`) via blob includes. New `askUserGuards` auto-skips CUA permission asks and signup password asks (dummy credentials). Signup prompt line tells the model to use dummy values without asking.
- **Impacted Files:** worker skills.js, askUserGuards.js, agent.js, computerUse.js, index.js, worker/test/skillsMatch.test.js, PROMPT_LOG

## [2026-09-22 10:30] Curated MEMORY hygiene — stop goal/if-rule pollution

- **Prompt Provided:** Memory chip on “open vughy.com and register” showed old India trial-expiring if-rule + ACTIVE USER MESSAGE; user said “lets go” on the fix plan.
- **Architectural Flow:** New `curatedMemoryFilter` drops ephemeral goal/if-rule dumps on extract; `persistCuratedMemoryFromRun` always filters; `selectCuratedSubset` strips ephemeral on pull, lowers full-inject threshold (10→4), tightens keyword/semantic floors so unrelated facts are not padded in. Scrub production Mongo of matching entries.
- **Impacted Files:** curatedMemoryFilter.js, curatedMemoryExtract.js, semanticMemory.js, tests, scrub scripts, PROMPT_LOG

## [2026-09-22 10:20] CUA type — foreground delivery_mode on Xvfb

- **Prompt Provided:** Follow-up: type still failed after type_text fix with background delivery unavailable.
- **Architectural Flow:** Default `delivery_mode: foreground` on type_text / click / key for Linux Xvfb (no focus-free backend).
- **Impacted Files:** cua_hermes/sidecar.py, PROMPT_LOG

## [2026-09-22 10:15] Fix CUA type blocked — use type_text + unrestricted

- **Prompt Provided:** Agent ask_user: CUA text entry blocked by browser permission policy.
- **Architectural Flow:** Root cause: sidecar fell back to raw MCP tool `type`, which cua-driver denies ("no reviewed risk classification"). Hermes maps to `type_text` / `press_key`/`hotkey`. Also default CUA_DRIVER_PERMISSION_MODE=unrestricted + DANGEROUSLY_BYPASS_APPROVALS for cloud (no approval UI). Prompt: never ask_user about CUA permission policy.
- **Impacted Files:** cua_hermes/sidecar.py, cuaDriver.js, cuaMcpSession.js, actions.js, computerUse.js, Dockerfiles, PROMPT_LOG

## [2026-09-21 22:25] CUA on = Hermes Python path; CUA off = Playwright

- **Prompt Provided:** When CUA is activated use the same way Hermes uses cua-driver and remove hybrid noise; when not CUA keep the current Playwright process.
- **Architectural Flow:** New Python sidecar (`worker/cua_hermes/sidecar.py`) owns `cua-driver mcp` (NDJSON JSON-RPC, sticky window, element_token/snapshot_id). Node `cuaHermesBridge` + Hermes capture/actions. `computerUse.activate` starts this path only. CUA `computer_use` actions no longer rematch via Playwright or glide the demo cursor. Non-CUA runs unchanged. Worker images copy sidecar + python3.
- **Impacted Files:** cua_hermes/sidecar.py, cuaHermesBridge.js, cuaHermesCapture.js, cuaHermesActions.js, computerUse.js, agent.js, actions.js, Dockerfile.worker, Dockerfile.cua-worker, PROMPT_LOG

## [2026-09-21 21:55] Harden Auto “send them the emails” → send_email

- **Prompt Provided:** User will fill agent SMTP; harden Auto so send follow-ups don’t navigate to mangled address URLs.
- **Architectural Flow:** Detect send-email requests; if SMTP missing, reply to configure; else build a concrete QUEUE_GOAL with recipients/subject/body from chat and mandate send_email only. Strip emails before domain intent match. Worker blocks navigate/open_tab that look like mangled local-parts when the goal is send_email.
- **Impacted Files:** chatAutoTurn.js, messageIntent.js, worker agent.js, actions.js, PROMPT_LOG

## [2026-09-21 21:30] Fix Auto draft follow-ups wiped as “thinking”

- **Prompt Provided:** Chat has context but “draft an email for above emails” returned “I am here…”. Do all fixes (sanitize, fallback, prompt, prefer results in context).
- **Architectural Flow:** Root cause: `looksLikeAutoDeliberation` treated any long multi-sentence REPLY (email drafts) as scratchpad and `sanitizeAutoReplyContent` emptied them. Protect substantive replies; drop blanket length heuristic; draft-from-context intent + prompt; clearer empty fallback; pack chat context preferring user/result/chat_qa over agent step spam; longer lines for result messages.
- **Impacted Files:** chatAutoTurn.js, chatContext.js, messageIntent.js, PROMPT_LOG

## [2026-09-21 16:35] Unstick Gmail Label as (three-dots) + speed up cursor

- **Prompt Provided:** Need to click three dots and select the label; taking too long.
- **Architectural Flow:** Live task looped 100+ steps on Gmail More→Label as center clicks. Click submenu parents on the right-edge chevron + ArrowRight; strengthen choose_menu_item for nested Label as→label; Gmail-specific prompt hint; shorten CUA arrow holds so clicks are not slowed ~1s each.
- **Impacted Files:** pageDom.js, macros.js, agent.js, actions.js, xCursor.js, PROMPT_LOG

## [2026-09-21 15:45] Make CUA arrow actually visible (CSP-safe + longer hold)

- **Prompt Provided:** Cannot see live CUA-style gradient arrow.
- **Architectural Flow:** Prior overlay used innerHTML SVG which Trusted Types/CSP silently blocked. Switch to CSS `background-image` data-URI (no innerHTML), Node-driven glide steps, larger 56px arrow, hold on target before/after click so Zoom shows it.
- **Impacted Files:** xCursor.js, PROMPT_LOG

## [2026-09-21 15:40] CUA cursor: gradient arrow overlay (not ✕)

- **Prompt Provided:** Why use X as the moving cursor when CUA has a beautiful arrow?
- **Architectural Flow:** The ✕ was a temporary visibility hack. Swap the page overlay for a cua.default-inspired gradient arrow (tip hotspot). cua-driver’s native compositor overlay stays unreliable on Xvfb containers, so YamBot keeps a page-level arrow for Zoom/Take control.
- **Impacted Files:** xCursor.js, computerUse.js, PROMPT_LOG

## [2026-09-21 15:30] Fix Zoom “no connection” — x11vnc crash + supervisor

- **Prompt Provided:** Clicking Zoom shows “no connection”.
- **Architectural Flow:** Live agent had x11vnc SIGSEGV (zombie); websockify still listened on :6080 but could not reach :5900 → noVNC “Failed to connect”. Stabilize x11vnc flags (`-noxdamage -noshm -cursor arrow`) and run x11vnc + websockify under restart loops in entrypoint.
- **Impacted Files:** worker/entrypoint.sh, PROMPT_LOG

## [2026-09-21 15:20] CUA: visible ✕ cursor + Playwright-accurate element clicks

- **Prompt Provided:** Live cursor missing; clicks still landing on the wrong link (e.g. Notifications instead of Trial expiring).
- **Architectural Flow:** MCP AT-SPI `element_index` clicks were “ok” but hit the wrong Chrome control. Resolve element → Playwright role/label bbox (else AT-SPI frame→viewport) and click with a pre-hit red ✕ page overlay + xdotool glide. Always attach Playwright viewport JPEG for CUA vision so x/y match. Rank interactive elements in the capture prompt.
- **Impacted Files:** xCursor.js, cuaActions.js, cuaCapture.js, agent.js, computerUse.js, PROMPT_LOG

## [2026-09-21 15:15] Fix CUA click coordinate spaces (viewport vs AT-SPI)

- **Prompt Provided:** CUA clicks not landing on the right coordinates.
- **Architectural Flow:** AT-SPI frames are desktop/screen pixels; model x/y and Playwright use viewport CSS from the attached screenshot. Route raw x/y through Playwright; convert AT-SPI frame centers → viewport for fallback; glide cursor using screen coords for element clicks.
- **Impacted Files:** xCursor.js, cuaActions.js, agent.js, actions.js, cuaCapture.js, PROMPT_LOG

## [2026-09-21 15:10] Linux AT-SPI live + SOM tree without SHM screenshot

- **Prompt Provided:** Improve Linux AX in the worker image.
- **Architectural Flow:** entrypoint starts dbus + at-spi-bus (verified ready); Chrome `--force-renderer-accessibility`. AX `get_window_state` returns elements. Window screenshots still fail MIT-SHM on Xvfb — enable MIT-SHM extension; SOM falls back to tree-only + Playwright vision image.
- **Impacted Files:** Dockerfile.worker, entrypoint.sh, agent.js, cuaCapture.js, deploy/README.md, PROMPT_LOG

## [2026-09-21 15:00] Linux AT-SPI for CUA SOM/element capture

## [2026-09-21 14:55] Unstick CUA capture hang (AT-SPI / get_window_state)

- **Prompt Provided:** Live “Check india trial-expiring… using cua” stuck after site memory with no LLM turn.
- **Architectural Flow:** cua-driver MCP `get_window_state` SOM hung (AT-SPI missing); capture retried forever and CLI fallback also blocked. Cap retries, skip CLI for get_window_state, 35s hard timeout in agent loop, fall back to Playwright vision.
- **Impacted Files:** cuaCapture.js, cuaMcpSession.js, agent.js, PROMPT_LOG

## [2026-09-21 14:45] Fix CUA MCP hang on start_session CLI fallback

- **Prompt Provided:** Hermes-parity CUA MCP smoke hung after NDJSON fix.
- **Architectural Flow:** `start_session` ran via `callTool` before `started=true`, so it fell through to `cua-driver call` CLI (daemon required) and blocked. Mark session started after tools/list; then optional start_session uses MCP.
- **Impacted Files:** cuaMcpSession.js, PROMPT_LOG

## [2026-09-21 14:40] Fix cua-driver MCP framing (NDJSON)

- **Prompt Provided:** Hermes-parity CUA — MCP initialize timed out on live agent boxes.
- **Architectural Flow:** cua-driver 0.28.x speaks newline-delimited JSON-RPC on stdio; Content-Length framing caused Parse error. Client now writes/reads NDJSON (still accepts Content-Length if present).
- **Impacted Files:** cuaMcpSession.js, PROMPT_LOG

## [2026-09-21 14:30] Hermes-parity CUA inside YamBot (MCP + SOM)

- **Prompt Provided:** When CUA is on, keep YamBot Playwright as orchestrator but drive Chrome through cua-driver MCP like Hermes (SOM/AX capture, element click/type/key) plus visible X-cursor glide; normal goals stay Playwright-primary.
- **Architectural Flow:** New worker modules `cuaMcpSession` (stdio JSON-RPC + CLI fallback), `cuaCapture` (sticky Chrome + SOM), `cuaActions` (click/type/key/scroll + xCursor). `computerUse.activate` starts MCP and resolves window. Agent injects CUA CAPTURE each CUA turn; `computer_use` action routes via MCP with Playwright fallback. Navigate/tabs/CRM/finish stay Playwright.
- **Impacted Files:** worker cuaMcpSession.js, cuaDriver.js, cuaCapture.js, cuaActions.js, computerUse.js, actions.js, agent.js, helpContent.js, PROMPT_LOG

## [2026-09-21 13:50] CUA: force coordinate preference + visible X cursor

- **Prompt Provided:** Force CUA to prefer click_at/type_at and show the X cursor moving on the live screen.
- **Architectural Flow:** Stronger CUA prompt; when CUA active, click/type/click_at/type_at resolve a point then `xdotool` glides the OS cursor before Playwright click (`xCursor.js`). entrypoint sets left_ptr cursor; Dockerfile adds x11-xserver-utils.
- **Impacted Files:** xCursor.js, computerUse.js, actions.js, agent.js, entrypoint.sh, Dockerfile.worker, PROMPT_LOG

## [2026-09-21 13:42] CUA mode: honor “using cua” in original chat bubble

- **Prompt Provided:** User sent “Check india trial-expiring list on Vughy again using cua” but saw no CUA / no live mouse.
- **Architectural Flow:** Hermes Auto rewrote the goal and dropped “using cua”, so Task.computerUseMode stayed `auto` and Playwright DOM clicks succeeded without activating CUA. Parse mode from original user `content` as well as rewritten `goalText`.
- **Impacted Files:** chats.js, PROMPT_LOG

## [2026-09-21 13:25] Website CUA: chat “using cua” + auto after 2 fails

- **Prompt Provided:** Install cua-driver on the live Playwright computer; activate after 2 failed attempts; also start CUA when chat says e.g. “login using cua”. Website agents (no full XFCE).
- **Architectural Flow:** `Task.computerUseMode` (`auto`|`cua`|`playwright`) from `parseComputerUseFromText`. Worker `createComputerUseController` starts CUA on explicit mode or after 2 recoverable locator failures; lazy `cua-driver serve`; `click_at`/`type_at` + forced vision. Same Xvfb Chrome session — no container swap.
- **Impacted Files:** computerUseMode.js, Task.js, enqueueTask.js, chats.js, worker computerUse.js/cuaDriver.js/actions.js/agent.js, Dockerfile.worker, entrypoint.sh, helpContent.js, PROMPT_LOG

## [2026-09-21 13:16] Fix bogus skill verification warning

- **Prompt Provided:** Pakistan trial-expiring ran correctly (0 rows) but chat showed `Skill verification warnings: Rule not met: Goal completed successfully`.
- **Architectural Flow:** Learn had seeded that phrase as a verificationRules regex; evaluateSkillVerification required it in the summary blob. Treat success-meta rules as `ctx.success` checks; stop seeding the placeholder; clear it on the live Vughy skill.
- **Impacted Files:** worker skills.js, skillWorkflowLearn.js, skillSuggestion.js, PROMPT_LOG

## [2026-09-21 13:10] Never stream Auto freeform (thinking flash)

- **Prompt Provided:** User still saw LLM thinking text in chat after the ack-sanitize deploy.
- **Architectural Flow:** Saved acks were clean; leak was live stream of freeform planning before `QUEUE_GOAL`/`REPLY`. `streamVisibleFromBuffer` now emits nothing until a clean `REPLY`/`ANSWER` body; queue_goal never streams. Broadened `looksLikeAutoDeliberation`. Scrubbed old deliberation rows in Trial chat.
- **Impacted Files:** chatAutoTurn.js, PROMPT_LOG

## [2026-09-21 12:55] Strip Auto planning dumps from queue acks

- **Prompt Provided:** Chat showed LLM thinking (“Should we be rude?… We can say On it…”) before the real status sentence.
- **Architectural Flow:** Model was streaming/saving deliberation as the ack. Detect `looksLikeAutoDeliberation`, extract quoted/final status via `extractQuotedOrFinalAck`, fall back to `defaultQueueAck`. Hold stream until protocol header or non-planning text; prompt forbids planning notes in chat.
- **Impacted Files:** chatAutoTurn.js, PROMPT_LOG

## [2026-09-21 11:35] Skills page: Learned badge, workflow key, demote

- **Prompt Provided:** Skills left one-by-one — #4 Skills page clarity.
- **Architectural Flow:** GET `/api/skills` populates agent + sourceTask and flags `learnedFromRun`. Skills page shows Learned/Live badges, workflow key, source goal snippet, Promote/Demote/Restore/Delete; deprecated skills in a collapsed section.
- **Impacted Files:** skills.js routes, SkillsPage.jsx, PROMPT_LOG

## [2026-09-21 11:30] Skill hints steer harder — plan from Suggested flow

- **Prompt Provided:** Skills left one-by-one — #3 hints steer harder.
- **Architectural Flow:** Matched learned skill builds the run Plan from durable steps (`planFromSkill`). ACTIVE SKILL block mandates ordered Suggested flow; SKILL PROGRESS names the next step using history heuristics (navigate/click/type match). System prompt reinforces skill-first steering.
- **Impacted Files:** planner.js, skills.js, agent.js, browserState/index.js, PROMPT_LOG

## [2026-09-21 11:25] One skill per workflow — merge overlapping learns

- **Prompt Provided:** Skills left one-by-one — #2 one skill per workflow (merge overlaps).
- **Architectural Flow:** `buildWorkflowKey` uses compact seeded tokens so rephrases collide. `findExistingLearnedSkill` matches exact key or Jaccard/shared-triggers near-duplicates; upsert merges steps/triggers and `deprecateDuplicateLearnedSkills` archives siblings. Live Vughy trial skills merged to one production skill.
- **Impacted Files:** skillWorkflowLearn.js, PROMPT_LOG

## [2026-09-21 11:20] Skill triggers: strip email/password match signals

- **Prompt Provided:** Skills left items one-by-one — start with clean triggers (no email/password tokens).
- **Architectural Flow:** Learn scrubbing strips emails, password literals, mail hosts (gmail…), digit secrets from tokens/triggers/titles/workflowKey. Matcher skips credential triggers and key parts. Live production skills scrubbed to drop `ayamunesh`/`gmail`/password triggers.
- **Impacted Files:** skillWorkflowLearn.js, worker skills.js, PROMPT_LOG

## [2026-09-21 10:25] Skill match: no domain-only; skip placeholder learns

- **Prompt Provided:** Continue skills — tighten match so similar goals activate Skill chip; stop junk learns.
- **Architectural Flow:** Live skills were named from Auto placeholders (“concrete worker instructions”) and matched on `vughy.com` alone. Learn prefers `userFacingGoal`, rejects placeholders/generic tokens; match requires content triggers or workflowKey/name overlap (domain alone insufficient). Catalog returns `workflowKey`; Skill chip reason shows overlap detail; ACTIVE SKILL prompt tells agent to follow Suggested flow.
- **Impacted Files:** skillWorkflowLearn.js, worker skills.js, worker agent.js, worker.js routes, PROMPT_LOG

## [2026-09-21 10:10] USER memory delete must drop chat summary zombies

- **Prompt Provided:** Settings → Memory deleted “be rude with me” but agents still used the old rude USER profile.
- **Architectural Flow:** Live USER curated store was empty; poison lived in `Chat.contextSummary` (and old frozen task snapshots). On USER curated mutate/clear, invalidate all chat context summaries for the account. Prompt/summary rules: USER PROFILE from Settings is authoritative; empty USER → do not invent tone from chat history.
- **Impacted Files:** curatedMemoryOps.js, chatContext.js, Agent.js, chatAutoTurn.js, PROMPT_LOG

## [2026-09-21 09:50] Dedupe site-memory flows (don’t stack every success)

- **Prompt Provided:** Every successful same run adds another site-memory flow and all get injected.
- **Architectural Flow:** `appendSiteHint` upserts similar `flow` fingerprints (keep newest); cap flows at 3 stored / 2 injected. Stats visits/successes still increment. Inject block explains counts are stats, not duplicated hints.
- **Impacted Files:** SiteProfile.js, learn.js, PROMPT_LOG

## [2026-09-21 09:45] Conditional goals must not reuse older if-rules

- **Prompt Provided:** User said “if more than 1 accounts, say hi” but agent evaluated old “days_left &lt; 15” and skipped messaging.
- **Architectural Flow:** Auto was rewriting goals from chat history; SITE MEMORY flow hints stored full prior summaries with old conditions. Pin ACTIVE USER MESSAGE on queue; reject `...` goals; store navigation-only site flows; worker prompt: current condition overrides SITE MEMORY.
- **Impacted Files:** chatAutoTurn.js, learn.js, agent.js, PROMPT_LOG

## [2026-09-21 09:40] Learn production skills from successful runs (all workflows)

- **Prompt Provided:** Implement Hermes-style skills for all workflows (not only trial expiry).
- **Architectural Flow:** On successful multi-step complete, `learnSkillFromSuccessfulRun` upserts one production Skill per agent+workflowKey (durable named steps + triggers, no Suggested: flood). Stronger `detectDbSkillMatch` (triggers + name tokens). Chat **Skill+** chip; next similar goals can activate via existing Skill chip.
- **Impacted Files:** skillWorkflowLearn.js, Skill.js, worker.js, worker agent.js, skills.js (worker), RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-21 09:15] Conditional peer-message goals must not block finish

- **Prompt Provided:** Live check of “check trial expiring… if >1 under 15 days say hi to general agent”.
- **Architectural Flow:** `goalRequiresFreshPeerAsk` matched “message … agent” inside an if/otherwise clause, blocking finish and causing wait loops on about:blank. Skip fresh-peer requirement for conditional “if…otherwise do not message” goals.
- **Impacted Files:** agentMessageBus.js, PROMPT_LOG

## [2026-09-21 09:10] Site memory inject chip in chat

- **Prompt Provided:** On trial-expiring chat Memory chip, also show domain site profile and how it is inserted.
- **Architectural Flow:** Worker posts `site_memory_pull` once per domain when SiteProfile hints load; chat Site chip popup shows hints + exact `SITE MEMORY` block and insertion point (browser LLM system prompt). Memory curated popup notes Site is separate.
- **Impacted Files:** worker agent.js, worker.js routes, RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-21 08:25] Strip Auto QUEUE_GOAL placeholder leaks

- **Prompt Provided:** Chat showed `<optional one short sentence to the user>` after “Let's start your work”.
- **Architectural Flow:** Model echoed Auto prompt angle-bracket templates as ack/goal. Detect placeholders, fall back to defaultQueueAck / user text; rewrite text-fallback prompt with real examples (no `<…>` slots).
- **Impacted Files:** chatAutoTurn.js, PROMPT_LOG

## [2026-09-20 01:45] History page Curated memory link

- **Prompt Provided:** On /history put curated memory alongside view chat history and view memory.
- **Architectural Flow:** HistoryRow gains “Curated memory” → `/history/agents/:id/memory#curated`. AgentMemoryPage curated section has `id="curated"` and scrolls after load.
- **Impacted Files:** HistoryPage.jsx, AgentMemoryPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-20 01:35] Ops chips forced to ~16px

- **Prompt Provided:** Icons are still not smaller.
- **Architectural Flow:** Exclude `.yb-ops-chip` from global `button { font-size: 1rem }`; force 1rem height / 0.55rem type with `!important` so UA padding and cascade cannot reinflate chips.
- **Impacted Files:** index.css, RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-20 01:30] Ops chips actually smaller (beat global button font)

- **Prompt Provided:** Icons are not smaller.
- **Architectural Flow:** Global `button { font-size: 1rem }` overrode Tailwind text utilities. Added `.yb-ops-chip` (20px / 0.625rem) so run-status icons visibly shrink.
- **Impacted Files:** index.css, RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-20 01:25] Memory popup clarity + smaller ops icons

- **Prompt Provided:** Memory popup said nothing injected after CRM register; shrink ops icons ~80% of prior size.
- **Architectural Flow:** Curated pull meta had USER facts but empty agent MEMORY (store empty) — popup looked empty. Always show agent+USER sections with injected count; parse body fallback. Icons h-9→h-7. Stronger post-run CRM/dummy heuristics for agent MEMORY save.
- **Impacted Files:** RunOpsIconRow.jsx, curatedMemoryExtract.js, PROMPT_LOG

## [2026-09-20 00:50] Hypothetical questions must not start the computer

- **Prompt Provided:** “what if i dont give you any details and tell you to register an account in crm” started the computer though it was a question.
- **Architectural Flow:** Heuristic matched `register` → `action_verbs` → `heuristic_queue_goal` before the model ran. Added `hypothetical_or_policy` classify (what if / what would / if I don’t…) as question; Auto prompt says answer those from memory.
- **Impacted Files:** messageIntent.js, chatAutoTurn.js, PROMPT_LOG

## [2026-09-20 00:35] Stop agent self-intro on every Auto reply

- **Prompt Provided:** Check General agent recent chat — wrong with agent name on every reply.
- **Architectural Flow:** Auto/Q&A prompts said “Always introduce yourself as {name}”, so every chat_qa opened with “I’m General agent” / echoed AGENT NAME. Softened prompts: know your name, don’t introduce every turn; formatAgentPrompt adds identity note.
- **Impacted Files:** chatAutoTurn.js, messageIntent.js, Agent.js, PROMPT_LOG

## [2026-09-19 22:50] Account name is the display name everywhere

- **Prompt Provided:** Use the user account name everywhere instead of curated “I am yamunesh”.
- **Architectural Flow:** `resolveHumanDisplayName` prefers `user.name` (curated “I am …” only if name is a stub). Settings → Memory has Display name editor via PUT `/api/auth/profile`.
- **Impacted Files:** userPublic.js, auth.js, SettingsMemoryPage.jsx, PROMPT_LOG

## [2026-09-19 22:30] Auto-save curated MEMORY after successful runs

- **Prompt Provided:** Also store curated memory after agent runs (not only day logs / short notes).
- **Architectural Flow:** On successful task complete (browser + API agents), `persistCuratedMemoryFromRun` LLM-extracts ≤5 durable facts into agent curated MEMORY (heuristic fallback), dedupes, posts **Saved** chip in chat.
- **Impacted Files:** curatedMemoryExtract.js, worker.js, apiAgentRunner.js, RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-19 22:25] LLM chip + sender name + agent memory target

- **Prompt Provided:** Small bubble for what is sent to the LLM; sender shows as “test”; agent “remember” saved to USER memory instead of agent MEMORY.
- **Architectural Flow:** Mirror llm_request/response into icon chat chips (click = full prompt/reply). Fix `resolveHumanDisplayName` to read curated `{content}` objects (and skip stub names). Worker memory action + prompts force target `memory` for “remember …” unless clearly account-wide identity.
- **Impacted Files:** worker.js, agent.js, actions.js, RunOpsIconRow.jsx, userPublic.js, PROMPT_LOG

## [2026-09-19 15:20] Mid-run chat must supersede original goal

- **Prompt Provided:** Why “register a account in crm” felt late / never started after open google.com.
- **Architectural Flow:** Inject did start CRM (~1s), but the worker still finished the original “open google.com” goal and abandoned signup. Fix: on operator consume, rewrite active GOAL to ACTIVE REQUEST; strengthen OPERATOR CHAT prompt so finish cannot ignore mid-run asks.
- **Impacted Files:** worker/src/agent.js, PROMPT_LOG

## [2026-09-19 14:45] Delete agent requires account password

- **Prompt Provided:** On `/agents`, add delete with a confirmation box to enter the password.
- **Architectural Flow:** AgentsPage Delete opens modal for account password. DELETE `/api/agents/:id` requires `{ password }` verified via `User.verifyPassword` before soft-delete (History + Restore unchanged).
- **Impacted Files:** AgentsPage.jsx, agents.js, helpContent.js, PROMPT_LOG

## [2026-09-19 14:40] Keyword search on History chat + memory pages

- **Prompt Provided:** On chat history / memory pages from `/history`, add a search box for keywords.
- **Architectural Flow:** AgentChatHistoryPage filters threads/messages client-side; AgentMemoryPage top search filters curated, logins, day history, and short notes.
- **Impacted Files:** AgentChatHistoryPage.jsx, AgentMemoryPage.jsx, PROMPT_LOG

## [2026-09-19 14:30] Memory pull chip in chat

- **Prompt Provided:** Small bubble to click and see ranking / what memory was pulled.
- **Architectural Flow:** After each enqueue, post `curated_pull` system message (ui icon). Chat ops row shows **M Memory** chip; popup lists ranked agent/USER facts with scores. Meta includes `pulled[]` from `resolveCuratedMemoryForPrompt`.
- **Impacted Files:** semanticMemory.js, enqueueTask.js, chats.js, goals.js, workforce.js, scheduler.js, RunOpsIconRow.jsx, PROMPT_LOG

## [2026-09-19 14:20] Semantic memory live test + tighter top-k

- **Prompt Provided:** Real test of built-in semantic memory.
- **Architectural Flow:** Unit tests + VPS live test (OpenRouter embeddings). Synthetic 12-fact store for NYSE goal → selects 6 (NYSE/index/CI first; travel/Gmail dropped). Tightened score floor + TOP_K=8. WOM agent curated store still empty (USER prefs inject as “all”).
- **Impacted Files:** semanticMemory.js, semanticMemory.test.js, _test_semantic_memory_*, PROMPT_LOG

## [2026-09-19 14:15] Built-in semantic curated memory retrieval

- **Prompt Provided:** Implement built-in semantic memory (not Honcho).
- **Architectural Flow:** On enqueue / chat / schedule / goals / A2A, `resolveCuratedMemoryForPrompt` embeds the goal (OpenAI-compatible `/embeddings`) and injects top-12 curated USER+MEMORY facts by cosine similarity; keyword fallback when embeddings unsupported; full inject if ≤10 entries. Embeddings stamped on memory add/replace and backfilled at freeze. Frozen into task snapshot as before.
- **Impacted Files:** llmEmbed.js, semanticMemory.js, curatedMemory.js, curatedMemoryOps.js, enqueueTask.js, chats.js, agentMessageBus.js, scheduler.js, goals.js, workforce.js, apiAgentRunner.js, worker agent.js, helpContent.js, PROMPT_LOG

## [2026-09-19 14:05] Raise curated MEMORY cap to 20,000 chars

- **Prompt Provided:** Raise curated MEMORY cap to 20000.
- **Architectural Flow:** `MEMORY_CHAR_LIMIT` 8000 → 20000. UI/help copy updated.
- **Impacted Files:** curatedMemory.js, Agent.js, AgentMemoryPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 14:00] Raise curated MEMORY cap to 8,000 chars

- **Prompt Provided:** Increase curated MEMORY cap from 2200 to more.
- **Architectural Flow:** `MEMORY_CHAR_LIMIT` 2200 → 8000 (~3k tokens). UI/help copy updated; USER cap unchanged at 1,375.
- **Impacted Files:** curatedMemory.js, Agent.js, AgentMemoryPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 13:50] Memory entries show date/time added

- **Prompt Provided:** Show date and time when new memory is added to an agent.
- **Architectural Flow:** Curated MEMORY/USER entries now persist `{ content, at }` (legacy strings still load). API returns `items[]` + `updatedAt`. Agent Memory + Settings Memory UI show Added timestamps; day logs/credentials also show their `at`.
- **Impacted Files:** curatedMemory.js, curatedMemoryOps.js, Agent.js, User.js, AgentMemoryPage.jsx, SettingsMemoryPage.jsx, PROMPT_LOG

## [2026-09-19 13:45] History → View memory

- **Prompt Provided:** On `/history`, after View chat history, add View memory for that agent’s full memory.
- **Architectural Flow:** HistoryRow links to `/history/agents/:id/memory` (same AgentMemoryPage). Route registered before chat-history; back nav shows ← History + Chat history when opened from History.
- **Impacted Files:** HistoryPage.jsx, App.jsx, AgentMemoryPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 13:40] History transcripts human-readable only

- **Prompt Provided:** History Show dumps “action type / Action fields” etc — make it readable.
- **Architectural Flow:** AgentChatHistoryPage filters ops/schema noise (`isHistoryNoiseMessage`) and renders `readableHistoryContent` (thought / finish / ask_user / humanizeGoal). Count shows conversational messages vs total logged.
- **Impacted Files:** readableChat.js, AgentChatHistoryPage.jsx, PROMPT_LOG

## [2026-09-19 13:35] History Show missing latest chat messages

- **Prompt Provided:** `/history/agents/6aab…` showed “741 messages updated …” but Show did not display the latest chat.
- **Architectural Flow:** `GET /:id/chat-history` used a global oldest-first `Message.find($in).limit(N)`, so older threads consumed the budget and the newest thread (opened by `updatedAt`) looked empty/stale. Now loads newest-first **per chat**, returns true `messageCount` + `truncated`; UI scrolls to latest.
- **Impacted Files:** agents.js, AgentChatHistoryPage.jsx, PROMPT_LOG

## [2026-09-19 13:25] Instant single-@ peer fan-out (no WOM computer relay)

- **Prompt Provided:** `tell @Content Inspector to open https://www.nyse.com/index` — ~36s before CI saw the ask.
- **Architectural Flow:** Single browse @peer used to queue WOM’s Chromium run first so WOM could call message_agent (worker poll + LLM). Now any single parsed peer assignment uses the same server-side `peerFanoutTargets` path as multi-@ / cheap greetings — `sendAgentMessage` at POST, parent parks `waiting_peer`, cheap-finish when peer replies.
- **Impacted Files:** chats.js, PROMPT_LOG

## [2026-09-19 13:20] History page + soft-delete agents

- **Prompt Provided:** New History page listing deleted (disabled) and current agents, with link to complete chat history per agent.
- **Architectural Flow:** DELETE /api/agents/:id now soft-archives (`active=false`, `deletedAt`) and keeps chats/tasks; stops computer without wiping volume. GET /api/agents filters to current only. GET /api/agents/history + GET /:id/chat-history + POST /:id/restore. UI: HistoryPage, AgentChatHistoryPage, nav History; Agents Delete → Archive.
- **Impacted Files:** Agent.js, agents.js, HistoryPage.jsx, AgentChatHistoryPage.jsx, AgentsPage.jsx, App.jsx, AppSidebar.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 13:15] Enter sends in chat/room composers

- **Prompt Provided:** In all message boxes, Enter should send (not newline).
- **Architectural Flow:** ChatDetailPage + RoomDetailPage: Enter submits; Shift+Enter inserts newline; @ picker still uses Enter to pick. Command Center / Business setup already behaved this way.
- **Impacted Files:** ChatDetailPage.jsx, RoomDetailPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 13:10] Room list facilitator + @mention picker

- **Prompt Provided:** On /rooms list show Facilitator after room name; in room compose, typing @ should list room agents.
- **Architectural Flow:** RoomsPage shows Facilitator line under title. RoomDetailPage reuses mentionAgent.js suggestions limited to participantAgents (arrow keys / Enter / click).
- **Impacted Files:** RoomsPage.jsx, RoomDetailPage.jsx, PROMPT_LOG

## [2026-09-19 13:05] Bots roster (Hermes-style directory)

- **Prompt Provided:** Implement Bots roster — what it is and how useful; then build it.
- **Architectural Flow:** `GET /api/agents/roster` returns slim agent rows + live status (needs_you / working / online / idle). New BotsRosterPage with Open chat, Ask, Add to room (picker → PATCH room members). Nav `/bots` + grok `/grok/bots`. Reuses Agent model — discovery surface, not a second runtime.
- **Impacted Files:** agents.js, BotsRosterPage.jsx, App.jsx, AppSidebar.jsx, helpContent.js, GrokStylePage.jsx, PROMPT_LOG

## [2026-09-19 12:50] Rooms in grok rail + edit existing rooms

- **Prompt Provided:** Put /rooms in grok-style left menu; add Edit for created groups.
- **Architectural Flow:** Grok left rail lists group rooms → `/grok/rooms` / `/grok/rooms/:roomId` (routes before `:chatId`). RoomsPage/RoomDetailPage use grok-aware base paths. RoomsPage edit mode PATCHes title, members, facilitator.
- **Impacted Files:** GrokStylePage.jsx, App.jsx, RoomsPage.jsx, RoomDetailPage.jsx, PROMPT_LOG

## [2026-09-19 12:45] Room Send no longer blocks on full turn

- **Prompt Provided:** Send button stuck on “Running turn…” for a long time.
- **Architectural Flow:** POST /api/rooms/:id/messages now returns after saving the user bubble (+ pending icon); `runRoomTurn` continues in the background. Member cheap replies run in parallel. UI unlocks immediately and polls faster while `room_turn_pending`.
- **Impacted Files:** rooms.js, roomTurn.js, RoomDetailPage.jsx, PROMPT_LOG

## [2026-09-19 12:00] Group rooms MVP (shared agent channels)

- **Prompt Provided:** Develop Hermes-style group rooms as a separate feature on the existing A2A spine.
- **Architectural Flow:** `Chat.kind=room` + `participantAgents` / `facilitatorAgent`. `/api/rooms` CRUD + post message runs `runRoomTurn`: each member cheap-LLM replies or PASS; `@mention` + browse/work delegates via `sendAgentMessage` (parentChatId = room, bypass managed allow-list). UI: sidebar Group rooms, RoomsPage, RoomDetailPage. Chats list excludes rooms.
- **Impacted Files:** Chat.js, roomTurn.js, rooms.js, agentMessageBus.js, chats.js, index.js, RoomsPage.jsx, RoomDetailPage.jsx, App.jsx, AppSidebar.jsx, helpContent.js, PROMPT_LOG

## [2026-09-19 10:20] One peer reply bubble (no triple WOM spam)

- **Prompt Provided:** `@Content Inspector perfect` produced 3 WOM messages: peer_reply + “Done — reply above” + another “Content Inspector replied: …”.
- **Architectural Flow:** Cheap peer finish had three writers for the same answer. Keep only the immediate `peer_reply` bubble from finalize; cheap-finish parent task without posting “Done”; chats.js marks parent done without a second assistant summary.
- **Impacted Files:** agentMessageBus.js, chats.js, PROMPT_LOG

## [2026-09-19 10:10] Cheap Q&A uses recent task history

- **Prompt Provided:** After CI opened mellow.io, `@Content Inspector what is the last task you did` answered Vughy.com from memory.
- **Architectural Flow:** Cheap peer questions only saw persona/curated MEMORY, not Task history. Fix: inject newest completed real tasks (skip cheap/resume wrappers) into the cheap LLM prompt and prefer that block for last-task answers.
- **Impacted Files:** agentMessageBus.js, PROMPT_LOG

## [2026-09-19 09:55] Skip late-resume after cheap peer finish

- **Prompt Provided:** `tell @Content Inspector to open https://www.hello.com/` — what went wrong?
- **Architectural Flow:** CI succeeded and cheap peer resume correctly posted the reply + Done. Then `resumeParentForLatePeer` saw parent `done` and wrongly spawned a second computer run (“LATE PEER RESULT”). Fix: if `maybeWakeWaitingPeerParent` returned `finishedCheap`, skip late resume.
- **Impacted Files:** agentMessageBus.js, PROMPT_LOG

## [2026-09-19 09:50] Faster peer reply in WOM chat thread

- **Prompt Provided:** After Content Inspector opened web.whatsapp.com, WOM showed “replied” badge long before the reply appeared in the chat thread.
- **Architectural Flow:** Badge came from `pendingPeerResults` immediately, but the thread waited for WOM’s computer to resume and finish. Fix: on peer finalize, post a full `peer_reply` agent bubble into the parent chat right away; for peer_ask/fan-out parents, cheap-finish without Chromium (short “Done — reply above”) instead of waking a computer just to summarize.
- **Impacted Files:** agentMessageBus.js, PROMPT_LOG

## [2026-09-19 09:20] Cheap peer question path (no computer)

- **Prompt Provided:** Implement Hermes-style cheap A2A for greetings / light Q&A first.
- **Architectural Flow:** `shouldAnswerPeerCheaply` + `runCheapPeerQuestion` answer question/event (and short greetings) with one LLM turn — no Playwright claim. Chat fan-out parks `waiting_peer` before send; if all peers reply cheaply, parent finishes immediately with a summary (no WOM computer). Single cheap `@Peer hi…` uses the same path.
- **Impacted Files:** agentMessageBus.js, chats.js, PROMPT_LOG

## [2026-09-19 08:55] Shared body for multi-@ peer asks

- **Prompt Provided:** `Send a message to @Market researcher and @Website Inspector hi how are you` — MR got empty default and ran standing work; only WI got the greeting.
- **Architectural Flow:** `parsePeerAskAssignments` now detects shared asks: when middle @ chunks are empty, fill all peers from text after the last @ (or cleaned preamble like “Say hi to”). Distinct per-peer instructions (`open A` / `open B`) unchanged. Fan-out uses `question` mode for greetings so peers do not fall into standing task workflows.
- **Impacted Files:** mentionAgent.js, chats.js, PROMPT_LOG

## [2026-09-19 00:15] Block peer re-delegate on open-URL fan-out

- **Prompt Provided:** Live check of multi-@ fan-out — CI/WI swapped work instead of opening URLs themselves.
- **Architectural Flow:** Fan-out queued correctly, but hop-1 peers still message_agent’d each other. Fix: `forbidFurtherHops` / direct-browse detection sets hop depth to max so relays hard-fail; expand “open X.com” into explicit DIY browse instructions; chat fan-out always passes `forbidFurtherHops: true`.
- **Impacted Files:** agentMessageBus.js, chats.js, PROMPT_LOG

## [2026-09-18 23:40] Multi-@ peer_ask fan-out (CI + WI)

- **Prompt Provided:** In WOM: `tell @Content Inspector to open github.com and @Website Inspector to open example.com` — only WI got a garbled relay ask.
- **Architectural Flow:** `resolveAgentMention` matched one @ (longest name), stripped it, and peer_ask forced a single message_agent. Fix: `resolveAllAgentMentions` + `parsePeerAskAssignments` split per-peer instructions; 2+ peers → server-side `sendAgentMessage` fan-out (wait:false) and parent `waiting_peer`; resume/finish when all PEER RESULTs arrive.
- **Impacted Files:** mentionAgent.js, chats.js, agentMessageBus.js, PROMPT_LOG

## [2026-09-18 23:30] Fix WOM↔WI peer_ask ping-pong loop

- **Prompt Provided:** Same `@Website Inspector ask what he did…` in Website Operations Manager — diagnose what happened.
- **Architectural Flow:** Peer_ask forwarded literal “ask what he did…” so WI messaged WOM back; after each peer_wait_resume WOM’s goal still required message_agent so it re-asked forever. Fix: rewrite ambiguous peer content to “report YOUR work”; hard-reject message_agent to the parent sender; on peer wake rewrite goal to PEER RESULTS READY + finish-only; consume/finish-guard notes forbid re-ask; cancel stuck parent task.
- **Impacted Files:** chats.js, agentMessageBus.js, scripts/_stop_wom_loop_*, PROMPT_LOG

## [2026-09-18 23:00] Mid-message @ + multi schedules per agent

- **Prompt Provided:** `@` only worked at the start of the compose box; also need multiple scheduled cron jobs per agent.
- **Architectural Flow:** Mention picker/resolver now opens on `@` anywhere (whitespace-bounded) using caret position; insert replaces the in-progress query. Agents gain `schedules[]` (multiple jobs) with legacy `schedule` mirrored to job 0; scheduler ticks every due job; Agent Edit UI lists add/remove jobs.
- **Impacted Files:** mentionAgent.js (fe+be), ChatDetailPage.jsx, Agent.js, scheduler.js, agents.js, system.js, AgentEditPage.jsx, helpContent.js, PROMPT_LOG

## [2026-09-18 22:50] Agent-chat @Peer = message_agent (not dispatch)

- **Prompt Provided:** `@website inspector ask what he did…` in WOM asked Market researcher and started the wrong computer.
- **Architectural Flow:** Agent-chat `@Peer` had been switching `agentDoc` to the peer (dispatch). That ran Auto as Website Inspector with “ask what he did…”, so WI messaged Market researcher. Fix: keep the bound agent; rewrite the goal to `message_agent` that peer with wait:true when ask/reply language is present; `peerAskForced` skips Hermes so Auto cannot reassign.
- **Impacted Files:** chats.js, ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 20:45] Hide noisy peer-delegate chat text

- **Prompt Provided:** Delegated peer chat showed COMPANY MEMORY + AGENT MESSAGE hop rules — too noisy for the user.
- **Architectural Flow:** `enqueueTask` now takes `displayContent` for the chat Message while Task.goal keeps company memory + A2A framing for the worker. `message_agent` passes a short “From …:” display. Frontend `humanizeGoalOrMessage` strips the same noise from older bubbles/queue rows.
- **Impacted Files:** enqueueTask.js, agentMessageBus.js, goalDisplay.js (new), ChatDetailPage.jsx, AgentTaskQueue.jsx, FloatingChatWidget.jsx, PROMPT_LOG

## [2026-09-18 20:40] Fix mobile chat scroll shake

- **Prompt Provided:** On mobile, scrolling the last chat message upward shakes the thread.
- **Architectural Flow:** Silent polls rebuilt a new `messages` array even when unchanged, re-firing stick-to-bottom. Also `scrollIntoView` scrolled ancestors and a 96px threshold kept stick=true during small upward scrolls. Fix: stable merge (return prev when unchanged), scroll only via thread `scrollTop`, hysteresis (unstick >120 / restick <40), ignore programmatic onScroll.
- **Impacted Files:** ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 20:10] @mention delegate in every agent chat

- **Prompt Provided:** In every agent chat, typing `@` should list other agents so the user can pick one to delegate a task.
- **Architectural Flow:** Chat compose shows the @ agent dropdown in agent chats (excluding the bound agent). Server resolves `@Peer …` on agent-bound threads and runs the goal as that peer while keeping messages on the current chat. Agent-chat queue merges peer-delegated tasks and groups by agent; live screen follows the active run’s agent.
- **Impacted Files:** chats.js, mentionAgent.js (fe+be), ChatDetailPage.jsx, AgentTaskQueue.jsx, PROMPT_LOG

## [2026-09-18 20:00] Grok mobile: live + queue as bubbles

- **Prompt Provided:** On grok-style mobile, put live view and task status in small bubbles; tap opens a popup.
- **Architectural Flow:** Below `lg`, grok ChatDetailPage hides the right rail. `GrokMobileRailBubbles` shows two floating bubbles (queue + live) above the composer; tap opens a bottom-sheet popup with the same panels. Desktop (`lg+`) keeps the inline rail. AgentTaskQueue gains `emptyFallback` for the idle popup state.
- **Impacted Files:** GrokMobileRailBubbles.jsx (new), ChatDetailPage.jsx, AgentTaskQueue.jsx, PROMPT_LOG

## [2026-09-18 19:00] Peer-wait frees computer for next goal

- **Prompt Provided:** WOM peer-wait left github.com pending while browser idle — allow next goal.
- **Architectural Flow:** After message_agent queues peers, parent parks as `waiting_peer` (not `running`) and the worker exits so claimNext can start the next pending goal. claimNext only blocks on `running` / `waiting_user`. When all peers finish, `maybeWakeWaitingPeerParent` requeues the parent as high-priority `pending` to resume and finish. Stop cancels `waiting_peer` too.
- **Impacted Files:** Task.js, worker.js (park + claim), agentMessageBus.js, worker/agent.js, chats.js, AgentTaskQueue.jsx, ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 17:25] Fix duplicate chat bubbles + thread order

- **Prompt Provided:** One send showed twice; thread order scrambled after Auto stream.
- **Architectural Flow:** DB had single copies — UI merged optimistic `stream-*` rows with polled real messages (different ids) and sorted synthetic ids into history. Pause silent polls while send is in flight; strip/replace stream rows on result; sort real ObjectIds before stream stubs; sendInFlightRef blocks double Enter/click.
- **Impacted Files:** ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 17:20] Fix Auto “Sending…” hang on simple chat

- **Prompt Provided:** “how are you” left Send on Sending for a long time.
- **Architectural Flow:** Chat GET was returning up to 40 recent tasks **with full event blobs** (~10–20MB), and optimistic `stream-*` message ids made `after=` fall back to heavy reloads during send. Trim task payloads (events only for running/waiting_user), ignore synthetic ids in poll cursors, merge stream result without awaiting full reload, prefer streamed text Auto path for normal chat (tools only for status/peer lookups), and stop blocking Auto/queue on context-summary LLM.
- **Impacted Files:** chats.js, ChatDetailPage.jsx, chatAutoTurn.js, PROMPT_LOG

## [2026-09-18 17:10] Step 4: Auto chat hardening

- **Prompt Provided:** Hermes-style chat step 4 — hardening.
- **Architectural Flow:** Runtime normalizes every Auto turn (`ensureAutoTurnResult`): sanitize reply text, fill default queue acks (`Starting {agent}’s computer: …`), recover empty/malformed model output (`recoverMalformedAutoOutput`), and loose-parse tool args (single quotes, trailing commas, unquoted keys). Empty SSE streams retry as one-shot completions in `llmChatCompletionStream` + text fallback. chats.js always posts/streams a queue ack; UI shows “Queuing computer…” if routing has no ack yet. Worker/A2A unchanged.
- **Impacted Files:** chatAutoTurn.js, llmChat.js, chats.js, ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 16:50] Step 3: Auto chat timing metrics

- **Prompt Provided:** Hermes-style chat step 3 — timing metrics.
- **Architectural Flow:** Auto turns record firstTokenMs, decisionMs, toolRounds, lookups, path, totalMs. Values stream as NDJSON `timing`, land on message `meta.hermesTiming`, and appear on the Answer/Queued ops icon text (“Timing: …”). Task `queued` events include hermesTiming when Auto queued a goal. Worker/A2A unchanged.
- **Impacted Files:** chatAutoTurn.js, chats.js, api.js, ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 16:45] Step 2: Auto light tool loop (status / peers)

- **Prompt Provided:** Hermes-style chat step 2 — light in-chat tool loop.
- **Architectural Flow:** Auto tools add `check_run_status` and `list_peer_agents` (lookups only). Up to 3 model↔tool rounds; terminal tools remain `reply` / `queue_goal`. Runtime in chats.js supplies live Task status + peer list. No Playwright from lookups. Text REPLY/QUEUE_GOAL fallback unchanged when tools unsupported.
- **Impacted Files:** chatAutoTurn.js, chats.js, PROMPT_LOG

## [2026-09-18 16:25] Step 1: Auto chat tools (reply / queue_goal) + text fallback

- **Prompt Provided:** Hermes-style chat step 1 — structured Auto tools without affecting worker/A2A.
- **Architectural Flow:** Auto exposes OpenAI-compatible tools `reply` and `queue_goal`. Runtime validates and posts chat or enqueues a computer goal. If the provider rejects tools (or returns no tool_calls), fall back to existing REPLY/QUEUE_GOAL text protocol + streaming. Heuristic peer/browser gate unchanged. Answer/Computer/worker paths untouched.
- **Impacted Files:** chatAutoTurn.js, llmChat.js (llmChatCompletionMessage), PROMPT_LOG

## [2026-09-18 16:10] Hermes-style Auto: one turn + streamed replies

- **Prompt Provided:** Make YamBot more Hermes-like — fast replies; model decides question vs computer (not a separate classifier).
- **Architectural Flow:** Auto mode skips the classify LLM. `runChatAutoTurn` does one model call (REPLY vs QUEUE_GOAL); strong peer/browser heuristics still queue immediately. Answers stream via NDJSON (`delta` events) + `llmChatCompletionStream`. Answer mode streams too; Computer mode still force-queues. Frontend `apiChatMessageStream` paints tokens live.
- **Impacted Files:** chatAutoTurn.js, llmChat.js, chats.js, api.js, ChatDetailPage.jsx, PROMPT_LOG

## [2026-09-18 15:55] Chat ops icons popup + sticky mobile composer

- **Prompt Provided:** Icon click shows content in a popup; mobile chat message box sticky at bottom.
- **Architectural Flow:** `RunOpsIconRow` icons are buttons that open a bottom-sheet/dialog with full message text. Chat page fills the shell (`data-chat-shell`); main disables page scroll on chat; live rail sits above the thread on mobile so the composer stays pinned under the scrolling messages.
- **Impacted Files:** RunOpsIconRow.jsx, ChatDetailPage.jsx, App.jsx, PROMPT_LOG

## [2026-09-18 15:42] Route peer fan-out as Computer goal (not Q&A)

- **Prompt Provided:** FO-918-E replied “can’t send peer-agent messages in Q&A mode”.
- **Architectural Flow:** Intent heuristics + LLM classifier treat ask-both / fan-out / message_agent / soft-wait as `goal` (confidence 0.95). Peer A2A overrides Answer/`forceAsk` because Q&A cannot call message_agent.
- **Impacted Files:** messageIntent.js, PROMPT_LOG

## [2026-09-18 15:40] Fix fan-out: never block HTTP on first peer

- **Prompt Provided:** check live what happened (FO-918-D — still ~38s between peers).
- **Architectural Flow:** LLM already sent one `fanout` with both peers. Bug was `POST /tools/message-agent` calling `sendAgentMessage({ wait:true })`, which blocked until peer A finished before peer B was queued. Route now always enqueues (`wait:false`); worker polls all peers in parallel. `opts.wait:false` overrides waitMode block in the bus.
- **Impacted Files:** worker.js, agentMessageBus.js, PROMPT_LOG

## [2026-09-18 15:35] Fix fan-out expand when peerAgentsBlock missing

- **Prompt Provided:** check live FO-918-C — still sequential (~38s gap).
- **Architectural Flow:** Claim now persists `agentSnapshot.peerAgentsBlock`; worker fetches `/api/worker/peers` when names missing so expand can add all goal-named peers in one message_agent step.
- **Impacted Files:** worker routes, worker agent.js, PROMPT_LOG

## [2026-09-18 15:25] Fix v5 fan-out: auto-expand parallel peers in one step

- **Prompt Provided:** How can we solve sequential (partial) fan-out?
- **Architectural Flow:** When the goal says both/at the same time/fan-out, `expandMessageAgentTargetsForFanOut` adds every peer named in the goal to a single message_agent call so they queue together (not wait:true then the next peer).
- **Impacted Files:** agentMessageBus.js, worker a2aFanout.js + agent.js, apiAgentRunner.js, PROMPT_LOG

## [2026-09-18 14:50] Block finish that reuses old peer replies from memory

- **Prompt Provided:** How can we solve reusing memory on soft-wait retests?
- **Architectural Flow:** Finish guard requires a fresh `message_agent` hop on this parent task when the goal looks like soft-wait / ask-peer. Prompt no longer allows finishing peer asks from SESSION CONTEXT alone.
- **Impacted Files:** agentMessageBus.js, worker finish-guard, worker agent.js, apiAgentRunner.js, PROMPT_LOG

## [2026-09-18 14:40] Fix soft wait: block early finish during soft window

- **Prompt Provided:** Fix v3 soft wait — agent finished before soft deadline / same turn as message_agent.
- **Architectural Flow:** `guardFinishAgainstSoftWaits` blocks finish while soft peers are still inside softWaitUntil; past deadline it soft-pauses then allows finish. Worker finish action + API runner call finish-guard; consume returns softActive notes; finish only completes when `result.finished` is true.
- **Impacted Files:** agentMessageBus.js, worker routes, worker agent.js, apiAgentRunner.js, PROMPT_LOG

## [2026-09-17 16:15] Chat bubbles show human display name (not chat title)

- **Prompt Provided:** “it should show the user name when i send a message” (clarifying “test” on the bubble).
- **Architectural Flow:** Speaker label uses `displayName` from curated “I am …” (else account name) + `meta.senderName` on new user messages. Auto-rename chat title when it still equals the signup name stub so the page header is not confused with the speaker.
- **Impacted Files:** userPublic.js, auth /me, chats.js, ChatDetailPage, FloatingChatWidget, PROMPT_LOG

## [2026-09-17 15:55] Collapse A2A system/peer lines into status icons

- **Prompt Provided:** Chat titled “test” while goal was delegation; make icons for system messages (→/← peer, PEER RESULT).
- **Architectural Flow:** Title stayed “test” because auto-rename only replaces New chat / Common chat defaults. Expanded `isOpsIconMessage` + kinds for A2A in/out, PEER RESULT, soft wait; stamp `ui:icon` on new A2A system messages; worker event mapping for peer_result.
- **Impacted Files:** RunOpsIconRow, agentMessageBus, worker routes, PROMPT_LOG

## [2026-09-17 15:50] A2A v6: late peer resume when parent already finished

- **Prompt Provided:** lets go with v6.
- **Architectural Flow:** When B finishes after A’s task is already done/error, `resumeParentForLatePeer` queues a high-priority follow-up on the same chat with the late PEER RESULT + original goal + A’s prior summary. Cap 3 resumes per parent; dedupe per agentMessageId. Chat shows an icon ack; API agents get kickApiAgent.
- **Impacted Files:** `agentMessageBus.js` (finalize + resumeParentForLatePeer), worker prompt, PROMPT_LOG

## [2026-09-17 15:40] A2A v5: multi-peer fan-out (B+C in parallel)

- **Prompt Provided:** v3, v4, v5 one by one (this entry = v5).
- **Architectural Flow:** `message_agent` accepts `to: ["B","C"]`, comma-separated names, or `fanout:[{to,content}]` (max 5). Queues peers in parallel; block waits for all; async/soft register each in pendingPeerResults (UI badges show each).
- **Impacted Files:** worker agent/actions, apiAgentRunner/Actions, agentMessageBus peer prompt, PROMPT_LOG

## [2026-09-17 15:35] A2A v4: peer status badges under agent screen

- **Prompt Provided:** v3, v4, v5 one by one (this entry = v4).
- **Architectural Flow:** Queue APIs include `pendingPeerResults`. `PeerStatusBadges` under live screen shows Waiting on B / B replied (tap expands result). Soft-wait peers labeled Soft wait.
- **Impacted Files:** chats.js queue selects, PeerStatusBadges.jsx, ChatDetailPage, help, PROMPT_LOG

## [2026-09-17 15:30] A2A v3: soft wait (work then pause for peer)

- **Prompt Provided:** lets go with v3, v4 and v5 one by one (this entry = v3).
- **Architectural Flow:** `wait:"soft"` (+ optional `soft_wait_minutes`, default 3) registers async mailbox with softWaitUntil. Parent keeps working; when the soft deadline passes and peer is still waiting, worker calls soft-pause and blocks until peer finishes (or hard timeout).
- **Impacted Files:** Task model, agentMessageBus, worker routes/agent/actions, apiAgentRunner/Actions, PROMPT_LOG

## [2026-09-17 15:25] A2A v2: mid-run chat injects into running agent

- **Prompt Provided:** lets go with v2 (chat with Agent A while it runs / waits on B).
- **Architectural Flow:** `POST /chats/:id/tasks/:taskId/inject` pushes `pendingOperatorMessages`. Worker/API drain each turn as OPERATOR MESSAGE notes. Chat Auto mode while running uses inject; Answer = Q&A; Computer still queues a new goal.
- **Impacted Files:** Task model, agentMessageBus, chats/worker routes, worker agent, apiAgentRunner, ChatDetailPage, help, PROMPT_LOG

## [2026-09-17 15:20] A2A v1: async peer results while parent keeps working

- **Prompt Provided:** Implement v1 — Agent A keeps doing remaining work after delegating to B; merge B’s result later. Also list next versions.
- **Architectural Flow:** `message_agent` with `wait:false` registers `Task.pendingPeerResults`. Child complete finalizes AgentMessage + fills the parent mailbox. Each parent LLM turn drains via `POST .../peer-results/consume` into PEER RESULT notes. `wait:true` still blocks when A needs the answer first.
- **Impacted Files:** Task model, agentMessageBus, worker routes/agent/actions, apiAgentRunner/Actions, PROMPT_LOG

## [2026-09-17 15:05] Fix: parent agent must not open URL meant for peer

- **Prompt Provided:** Agent A tasked Agent B to open a website and report back — why is A opening the same site?
- **Architectural Flow:** Parent worker bootstrap navigated any URL found in the goal before the LLM could `message_agent`. Skip bootstrap when the goal looks like peer delegation; harden peer/prompt rules so A only messages B and waits.
- **Impacted Files:** `worker/src/agent.js`, `worker/src/actions.js`, `agentMessageBus.js`, `PROMPT_LOG.md`

## [2026-09-17 14:35] Snapshot + trajectory as icons under agent screen

- **Prompt Provided:** Make page snapshot and trajectory small icons below the agent screen.
- **Architectural Flow:** Both panels gain `variant="icon"` (badge + popover). ChatDetail places them under LiveScreen and removes the page-bottom panels.
- **Impacted Files:** `PageSnapshotPanel.jsx`, `TrajectoryPanel.jsx`, `ChatDetailPage.jsx`, `PROMPT_LOG.md`

## [2026-09-17 14:30] Zoom pop-out: open live view in a new tab

- **Prompt Provided:** After Zoom button, small icon that opens zoom in a new tab.
- **Architectural Flow:** Icon beside Zoom opens `/agents/:agentId/live` in a new tab. `AgentLivePage` mounts `LiveScreen` with `autoZoom` so view-only noVNC Zoom starts when the stream is online.
- **Impacted Files:** `LiveScreen.jsx`, `AgentLivePage.jsx`, `App.jsx`, `PROMPT_LOG.md`

## [2026-09-17 14:20] Quiet chat: icons for run ops + vague one-word → Answer

- **Prompt Provided:** Don’t show queued/started/plan/LLM/step/ask-agent lines as bubbles; use icons. “now” should not start computer.
- **Architectural Flow:** Single-word/vague pings classify as question. Worker skips chat dumps for LLM I/O and duplicate ask_user agent lines; ops messages get `meta.ui=icon`. Chat UI collapses them into `RunOpsIconRow` (tooltip = full text). Real assistant asks remain as bubbles.
- **Impacted Files:** messageIntent, worker routes/agent, enqueueTask, chats, apiAgentRunner, RunOpsIconRow, ChatDetailPage, FloatingChatWidget, PROMPT_LOG

## [2026-09-17 14:00] Intent routing: Auto / Answer / Computer

- **Prompt Provided:** How to know question vs browser task without /ask and /run.
- **Architectural Flow:** Stronger heuristics (greetings, memory introspect); LLM refine when confidence &lt; 0.9 with recent chat context; composer Auto|Answer|Computer toggle maps to forceAsk/forceGoal (slash optional).
- **Impacted Files:** `messageIntent.js`, `chats.js`, `ChatDetailPage.jsx`, help, PROMPT_LOG

## [2026-09-17 13:56] Strip &lt;think&gt; tags from chat replies

- **Prompt Provided:** why &lt;think&gt; is showing in reply
- **Architectural Flow:** Shared `stripModelThinking` strips think/thinking blocks before assistant messages are saved (Q&A, worker complete, ask_user, API runner).
- **Impacted Files:** `llmSanitize.js`, `messageIntent.js`, `worker.js`, `apiAgentRunner.js`, PROMPT_LOG

## [2026-09-17 13:52] Chat Q&A: agent name + curated USER memory

- **Prompt Provided:** Hi greeted as YamBot; USER memory question saw nothing.
- **Architectural Flow:** Q&A snapshot now loads User+Agent curatedMemory into toAgentSnapshot. answerChatQuestion identifies as agent name (never “YamBot”) and explicitly uses USER PROFILE / MEMORY blocks.
- **Impacted Files:** `chats.js`, `messageIntent.js`, PROMPT_LOG

## [2026-09-17 13:42] Fix curated memory ENTRY_DELIMITER.join

- **Prompt Provided:** /settings/memory Server error — ENTRY_DELIMITER.join is not a function
- **Architectural Flow:** Python-style `delimiter.join(list)` → JS `list.join(delimiter)` in charCount + renderCuratedBlock.
- **Impacted Files:** `curatedMemory.js`, PROMPT_LOG

## [2026-09-17 13:40] Hermes-style curated USER + MEMORY

- **Prompt Provided:** Yes lets go (implement Hermes MemoryStore on Mongo).
- **Architectural Flow:** Account `User.curatedMemory` (USER.md, 1,375 chars) + per-agent `Agent.curatedMemory` (MEMORY.md, 2,200 chars). Entries §-delimited; threat scan; hard reject when full. Frozen blocks captured in `toAgentSnapshot` at enqueue. Mid-run `memory` tool (add/replace/remove, target user|memory) persists immediately but does not mutate the task prompt. Settings → Memory UI + Agent Memory curated section; dayLogs/episodic notes/vault unchanged.
- **Impacted Files:** `curatedMemory.js`, `curatedMemoryOps.js`, User/Agent models, enqueueTask, formatAgentPrompt, agents/settings/worker routes, apiAgentActions/Runner, worker actions/agent, SettingsMemoryPage, AgentMemoryPage, App/SettingsLayout, help, PROMPT_LOG

## [2026-09-17 12:28] Agent group tree views

- **Prompt Provided:** Wherever agents are showing, show a tree-like view by group.
- **Architectural Flow:** Collapsible group → agent folders on Grok rail, Chats agent list, Agents page, and Live Wall. Shared `AgentGroupFolder` + `entityGroupId` helper. Search on Grok also matches group names. Live-wall API includes `groupId`.
- **Impacted Files:** `groupedList.js`, `AgentGroupFolder.jsx`, GrokStyle/Chats/Agents/LiveWall pages, `agents.js` live-wall, PROMPT_LOG

## [2026-09-17 12:03] Fix API 502 — agents.js syntax

- **Prompt Provided:** Request failed HTTP 502
- **Architectural Flow:** Avatar edit left `if (body.mode…)` open without body/close → API crash-loop SyntaxError. Restored mode assignment block; redeploy.
- **Impacted Files:** `backend/src/routes/agents.js`, PROMPT_LOG

## [2026-09-17 11:55] Agent profile pictures

- **Prompt Provided:** Upload profile picture for an agent; show it wherever agents appear.
- **Architectural Flow:** `avatarMime` + `avatarBase64` on Agent (resized JPEG/WebP thumbnail ≤~100KB). Edit page upload/clear; shared `AgentAvatar` on Agents, Chats, grok-style, chat header, Live Wall. Chats populate includes avatar fields. Copy agent copies avatar.
- **Impacted Files:** `Agent.js`, `agents.js`, `chats.js`, `agentAvatar.js`, `AgentAvatar.jsx`, AgentEdit/Agents/Chats/Grok/ChatDetail/LiveWall pages, help, PROMPT_LOG

## [2026-09-17 11:51] Grok agent list: stable order + search

- **Prompt Provided:** Stick agent order permanently; add search box above agent names.
- **Architectural Flow:** Left rail sorts A–Z by name (ignores API `updatedAt` reshuffles from 5s poll). Search filters by name/skill above the list.
- **Impacted Files:** `GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-17 11:47] Grok-style red attention dots

- **Prompt Provided:** Also show a red dot when the agent needs human attention.
- **Architectural Flow:** Left rail: red pulsing dot for `waiting_user` or `computer.needsAttention`; green for pending/running. Both can show together. Idle stays muted.
- **Impacted Files:** `GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-17 11:44] Grok-style agent working dots

- **Prompt Provided:** In grok style left pane, add a green dot if that agent is doing something.
- **Architectural Flow:** Left agent list shows a pulsing emerald dot when any of that agent’s chats has live status pending/running/waiting_user; idle agents get a muted dot. Poll chats every 5s so dots stay current.
- **Impacted Files:** `GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-17 11:40] Drop Delete on agent chat rows

- **Prompt Provided:** Drop delete button (agent rows on Chats).
- **Architectural Flow:** Agent list on Chats / grok-style is open-only. Delete remains only for shared-inbox threads. Agent removal stays on Agents page.
- **Impacted Files:** `ChatsPage.jsx`, `GrokStylePage.jsx`, help, PROMPT_LOG

## [2026-09-17 11:45] One chat per agent

- **Prompt Provided:** Yes, let’s go (one chat per agent; simplify Chats UI).
- **Architectural Flow:** `ensureAgentChat` is the sole path for agent-bound threads. `enqueueTask`, chats POST, goals/workforce runs, schedules, and triggers reuse that chat (no Trigger· / Goal· / message_agent spawn threads). Chats + grok-style UIs list one row per agent; “Open chat” replaces “New chat”. A2A child goals already land via `enqueueTask` on the peer’s sole chat.
- **Impacted Files:** `enqueueTask.js`, `chats.js`, `goals.js`, `workforce.js`, `scheduler.js`, `triggerEngine.js`, `ChatsPage.jsx`, `GrokStylePage.jsx`, help, `AgentMemoryPage.jsx`, PROMPT_LOG

## [2026-09-17 11:30] Fix message_agent timeout + fetch failed

- **Prompt Provided:** How can we solve Content Inspector timeout soft-cancel and fetch failed?
- **Architectural Flow:** Worker no longer holds one long HTTP wait (enqueue + short polls with heartbeats). Wait raised to 25m; soft-cancel on timeout removed (peer keeps running; late results sync via poll). Child goals instruct finish — do not message_agent the sender back.
- **Impacted Files:** `agentMessageBus.js`, `worker.js` routes, `worker/agent.js`, PROMPT_LOG

## [2026-09-16 15:35] Agent-to-agent v3 — typed modes, soft-cancel, threads, managedAgents

- **Prompt Provided:** Let’s do v3.
- **Architectural Flow:** Modes `task|question|approval|handoff|event` with mode-specific child goals; managers with `managedAgents` may only message that list; wait timeout soft-cancels the child task; `GET /api/agent-messages/threads` + **Agent threads** page in sidebar; prompts/help updated.
- **Impacted Files:** `AgentMessage.js`, `agentMessageBus.js`, `agentMessages.js`, `worker.js`, `apiAgentActions.js`, `apiAgentRunner.js`, `worker/actions.js`, `worker/agent.js`, `AgentThreadsPage.jsx`, `App.jsx`, `AppSidebar.jsx`, help, PROMPT_LOG

## [2026-09-16 15:30] Agent-to-agent v2 — depth 2, events, Operations hops

- **Prompt Provided:** Start v2; explain what v2 does.
- **Architectural Flow:** Raise hop depth to 2 (A→B→C). Emit `agent.message.sent|result|failed|timeout` on the company event bus. Persist structured `resultPayload` on AgentMessage. Add `GET /api/agent-messages` and Operations **Agent hops** tab. Prompts/help updated for depth 2.
- **Impacted Files:** `agentMessageBus.js`, `AgentMessage.js`, `eventCatalog.js`, `agentMessages.js`, `index.js`, `apiAgentActions.js`, `worker/actions.js`, `OperationsPage.jsx`, help, PROMPT_LOG

## [2026-09-16 15:25] Remove LLM spend budget caps (unlimited)

- **Prompt Provided:** Remove all functionality related to budgets; unlimited LLM.
- **Architectural Flow:** Disabled cost ceilings (`checkCostCeiling` always ok), removed enqueue/CEO/optimize spend gates, worker no longer aborts on `budget.exceeded`, economic stop ignores spend vs value. Policies/Agent edit UI no longer expose monthly/daily/company AI caps; save clears legacy caps to 0. Governance shows spend only (no cap).
- **Impacted Files:** `runawayGuards.js`, `enqueueTask.js`, `ceoAutonomy.js`, `continuousOptimize.js`, `policy.js`, `economicDecision.js` (backend+worker), `worker.js` runtime-config, `worker/agent.js`, `policies.js`, `agents.js`, `governance.js`, `companyAudit.js`, Policies/AgentEdit/Governance pages, help, PROMPT_LOG

## [2026-09-16 15:15] Agent-to-agent chat v1 (message_agent)

- **Prompt Provided:** Implement agent-to-agent chat v1: Agent A can ask Agent B to do work/answer via YamBot, optionally wait, with logging and loop limits.
- **Architectural Flow:** `AgentMessage` + `agentMessageBus.sendAgentMessage` enqueues a child task for peer B (same user), enforces hop depth 1 and 5 calls/parent, optional wait up to 8m with parent `claimedAt` refresh. Browser worker + API runner expose `message_agent`; `POST /api/worker/tools/message-agent`. Peer names injected into claim snapshot / API system prompt. Chat system lines `→` / `←` on A’s thread.
- **Impacted Files:** `backend/src/models/AgentMessage.js`, `backend/src/utils/agentMessageBus.js`, `backend/src/utils/enqueueTask.js`, `backend/src/routes/worker.js`, `backend/src/routes/agents.js`, `backend/src/utils/apiAgentActions.js`, `backend/src/utils/apiAgentRunner.js`, `backend/src/utils/deleteUserCascade.js`, `backend/src/models/Agent.js`, `worker/src/actions.js`, `worker/src/agent.js`, `frontend/src/help/agentActionsContent.js`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 15:10] Chats tree: count in brackets after agent name

- **Prompt Provided:** After agent name show number of chats in a bracket.
- **Architectural Flow:** Agent folder headers render as `Name (N)` instead of a separate trailing count.
- **Impacted Files:** `frontend/src/pages/ChatsPage.jsx`, PROMPT_LOG

## [2026-09-16 15:05] Chats page: tree by agent name

- **Prompt Provided:** On chats page, create a tree by agent name; recent chat first.
- **Architectural Flow:** Agent chats grouped under expandable agent folders. Folders ordered by most recent chat activity; chats inside each folder newest-first. Shared inbox unchanged.
- **Impacted Files:** `frontend/src/pages/ChatsPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 14:55] Common chat @ agent autocomplete

- **Prompt Provided:** In common chat when typing @, show all agents to choose easily.
- **Architectural Flow:** `listMentionSuggestions` opens while compose is `@` / `@partial`. ChatDetailPage shows a dropdown above the textarea; click or arrows+Enter/Tab inserts `@Name `. Esc clears.
- **Impacted Files:** `frontend/src/lib/mentionAgent.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 14:20] API-only agents (no live computer / save RAM)

- **Prompt Provided:** While creating an agent, choose whether it needs a live computer; if not, no Chromium box but still HTTP/API-style work (browser agents keep API tools too — this option saves RAM).
- **Architectural Flow:** `Agent.mode` = `browser` | `api`. `wantsCloudComputer` skips containers for `api`. New `apiAgentRunner` claims pending API tasks (kick on enqueue + 15s tick), runs LLM + http/email/entities/tickets tools, completes like the worker. UI: Live computer radio on create/edit; hide LiveScreen for API agents.
- **Impacted Files:** `backend/src/models/Agent.js`, `backend/src/routes/agents.js`, `backend/src/routes/worker.js`, `backend/src/routes/chats.js`, `backend/src/utils/apiAgentActions.js`, `backend/src/utils/apiAgentRunner.js`, `backend/src/utils/scheduler.js`, `backend/src/utils/enqueueTask.js`, `backend/src/utils/agentReadiness.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 14:10] Copy agent from edit page + fuller config clone

- **Prompt Provided:** Option to copy an agent; click creates an agent with the same configuration.
- **Architectural Flow:** Copy already existed on Agents list (`POST /api/agents/:id/copy`). Added **Copy** on Agent edit. Clone now also copies credentials vault, vision LLM profile, lifecycle/authority, and SiteProfile hints (still skips chats / memory / day logs; new cloud box).
- **Impacted Files:** `backend/src/routes/agents.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 14:05] Architect blueprint full-page zoom

- **Prompt Provided:** On /architect, Architecture blueprint section — zoom to full page.
- **Architectural Flow:** Amber blueprint header gains **Full page**; opens a fixed full-viewport overlay with the same BlueprintPanel, Approve & Build, Close / Esc, body scroll lock.
- **Impacted Files:** `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 11:55] Reserve /ask /run — not skill slugs

- **Prompt Provided:** `/ask …` returned Skill not found (No production skill matches /ask).
- **Architectural Flow:** `parseSkillSlash` now ignores reserved chat commands `ask`, `run`, `learn`, `help` so intent overrides reach Q&A / computer paths instead of skill lookup.
- **Impacted Files:** `backend/src/utils/skillSlash.js`, `frontend/src/lib/skillSlash.js`, PROMPT_LOG

## [2026-09-16 11:50] Skills page: show system-defined skills

- **Prompt Provided:** Also show system defined skills on the same page in a section.
- **Architectural Flow:** Added read-only catalog (`login`, `shopping`, `email`, `research`) matching worker templates. `GET /api/skills` returns `systemSkills`; Skills page shows a **System skills** section (expandable details) above training / your library.
- **Impacted Files:** `backend/src/utils/systemSkills.js`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 11:45] Rename sidebar Workflows → Skills

- **Prompt Provided:** Change the workflows menu name to skills; also explained skill load vs Chromium JSON system prompt in chat.
- **Architectural Flow:** AppSidebar nav label `/skills` changed from “Workflows” to “Skills”. (Q&A vs browser prompt behavior unchanged — documented in chat reply.)
- **Impacted Files:** `frontend/src/components/AppSidebar.jsx`, PROMPT_LOG

## [2026-09-16 10:30] Chat context scales to LLM context window

- **Prompt Provided:** Can we use the LLM context size for chat memory so it is nicer than fixed 16/24/14k.
- **Architectural Flow:** Added `contextTokens` on LlmProfile + `settings.llmContextTokens` (optional UI). Credentials resolve effective tokens (override → infer from model → 128k default). `chatContext.js` packs recent turns / summarize thresholds / summary size from that budget (~22% of the window for chat memory, char-capped).
- **Impacted Files:** `backend/src/utils/llmContextWindow.js`, `backend/src/utils/chatContext.js`, `backend/src/utils/llmCredentials.js`, `backend/src/models/LlmProfile.js`, `backend/src/models/User.js`, `backend/src/routes/{settings,llmProfiles,chats}.js`, `frontend/src/pages/{SettingsPage,SettingsLlmProfilesPage}.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-16 10:25] Agent cloud computer: Playwright only (no CUA)

- **Prompt Provided:** While creating a new agent, in Cloud computer / Desktop engine, only Playwright Chromium — do not want CUA.
- **Architectural Flow:** Removed CUA option from agent create/edit UI; always persist `computer.engine=playwright`. API create/update/clone ignore CUA overrides. Help copy updated.
- **Impacted Files:** `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, `backend/src/routes/agents.js`, PROMPT_LOG

## [2026-09-15 16:10] Architect: defer Details needed, keep chatting

- **Prompt Provided:** On /architect after discussion it asks questions; sometimes don’t want to answer yet but continue chat and answer later.
- **Architectural Flow:** Pending requirements no longer hard-lock the chat composer. **Answer later** parks the amber form (compact banner + **Answer details** to reopen); parked forms survive free-chat turns that omit `pendingRequirements`. Submit still clears and resumes design.
- **Impacted Files:** `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 16:05] Lighten grok sidebar + agent screen chrome

- **Prompt Provided:** On /grok page, dislike black color on sidebar menu and agent screen header.
- **Architectural Flow:** Grok left rail already uses white/teal-50 chrome; LiveScreen shell, header, banners, control footer, zoom modal, and “live view open” placeholder switched from slate-950/black chrome to white + teal-50 with teal borders/text. Screenshot stage stays black (media surface only).
- **Impacted Files:** `frontend/src/components/LiveScreen.jsx`, `frontend/src/pages/GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-15 16:00] Apply Vughy.com brand colors to YamBot UI

- **Prompt Provided:** Visit vughy.com and apply the same color code to this project.
- **Architectural Flow:** Pulled Vughy `brand-*` palette from production CSS (`#f4f0ff`…`#4a2895`, gradient `#6941c6`→`#9e7bff`). Remapped Tailwind `teal-*` via `@theme` in `index.css` plus `--yb-*` tokens so existing teal utility classes render as Vughy purple across the app; grok shell backgrounds aligned.
- **Impacted Files:** `frontend/src/index.css`, `frontend/src/pages/GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-15 15:45] Grok left rail: agent → chats tree + delete

- **Prompt Provided:** On /grok show chats as a tree under each agent; delete icon on each chat.
- **Architectural Flow:** `GrokStylePage` left rail nests chats under agents (expand/collapse), + creates a new chat, trash calls `DELETE /api/chats/:id` with confirm; deleting the open chat navigates to another sibling or `/grok`.
- **Impacted Files:** `frontend/src/pages/GrokStylePage.jsx`, PROMPT_LOG

## [2026-09-15 15:35] Mid-run Q&A + queue goals (no supersede)

- **Prompt Provided:** Ask questions while agent is working (answer from memory); new tasks stay pending until current run completes.
- **Architectural Flow:** Question path unchanged for computer (no cancel) + clearer “run continues” system note. Goal path no longer cancels running/waiting_user tasks — new goals stay `pending`. Worker claim refuses another task while agent is busy. Help copy updated.
- **Impacted Files:** `backend/src/routes/chats.js`, `backend/src/routes/worker.js`, `backend/src/utils/messageIntent.js`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 15:25] Auto-save signup credentials (no YES/NO)

- **Prompt Provided:** Auto-save after signup instead of asking YES/NO in chat.
- **Architectural Flow:** On successful signup finish, worker posts typed email/password to `/api/worker/credentials` immediately and posts an info line in chat. Skips if vault already has that site/account.
- **Impacted Files:** `worker/src/agent.js`, `backend/src/models/Agent.js`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 15:20] Offer save-login to vault after signup (human YES)

- **Prompt Provided:** After register, agent said password not retained; add human-gated save proposal.
- **Architectural Flow:** On successful `finish` after a signup-like goal with typed email/password, worker asks YES/NO via `ask_user`. YES → `POST /api/worker/credentials` into agent vault (View memory). Never auto-saves without confirmation.
- **Impacted Files:** `worker/src/browserState/learn.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, `backend/src/routes/worker.js`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 15:05] Chat-scoped session context + summarization

- **Prompt Provided:** Remember chat context until the chat is deleted; when the chat is large, summarize older context.
- **Architectural Flow:** Chat stores `contextSummary` / `contextSummarizedThrough`. Each message packs summary + last 16 eligible turns into Q&A prompts and Task `agentSnapshot.chatContext` (worker + formatAgentPrompt). When ≥24 messages or ~14k chars, older turns are LLM-summarized. Deleting the chat removes summary with the document.
- **Impacted Files:** `backend/src/utils/chatContext.js`, `backend/src/models/Chat.js`, `backend/src/models/Agent.js`, `backend/src/utils/messageIntent.js`, `backend/src/routes/chats.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-15 14:55] Remove Create VPS (/admin/create-vps)

- **Prompt Provided:** Remove /admin/create-vps page and all its functionality.
- **Architectural Flow:** Deleted AdminPersonalVps UI/nav/route, API proxy `/api/admin/personal-vps`, `personal-vps` microservice, Compose service, and env knobs. Super-admin nav keeps Users only.
- **Impacted Files:** `frontend/src/pages/AdminPersonalVpsPage.jsx` (deleted), `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `backend/src/routes/adminPersonalVps.js` (deleted), `backend/src/index.js`, `backend/src/utils/env.js`, `personal-vps/**` (deleted), `deploy/Dockerfile.personal-vps` (deleted), `deploy/docker-compose.yml`, `deploy/.env.example`, PROMPT_LOG

## [2026-09-15 14:30] Grok-style workspace (new tab)

- **Prompt Provided:** Add a “grok-style” menu that opens a new tab: left = all agents, middle = chat, right = same as the classic chat page rail.
- **Architectural Flow:** Auth-only `/grok` layout (no AppSidebar). `GrokStylePage` lists agents and find-or-creates agent chats; nested `ChatDetailPage` at `/grok/:chatId` fills middle+right with grokMode chrome. Sidebar link uses `target=_blank`.
- **Impacted Files:** `frontend/src/pages/GrokStylePage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 14:25] Show full API keys on /settings/llm

- **Prompt Provided:** On /settings/llm also always show complete API keys; do not mask.
- **Architectural Flow:** `GET /api/settings` returns plaintext `llmApiKey`, `visionApiKey`, and `dbcPassword`. Settings page loads them into text inputs (no password dots / masked labels).
- **Impacted Files:** `backend/src/routes/settings.js`, `frontend/src/pages/SettingsPage.jsx`, PROMPT_LOG

## [2026-09-15 14:20] Show full LLM API keys on /settings/llms

- **Prompt Provided:** On /settings/llms always show the complete API keys; do not mask.
- **Architectural Flow:** `publicLlmProfile` decrypts and returns plaintext `apiKey`. Settings LLM profiles UI uses `type=text`, loads the key into the edit form, and shows the full key on each saved profile row.
- **Impacted Files:** `backend/src/models/LlmProfile.js`, `frontend/src/pages/SettingsLlmProfilesPage.jsx`, PROMPT_LOG

## [2026-09-15 14:10] Super-admin set user password

- **Prompt Provided:** Option to change the password for a user once logged in (super admin).
- **Architectural Flow:** `POST /api/admin/users/:userId/password` with `{ password }` (min 6). Admin users table gets **Set password** (works for any user including self). Prompts for new + confirm; does not expose the hash.
- **Impacted Files:** `backend/src/routes/admin.js`, `frontend/src/pages/AdminUsersPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 14:00] Super-admin delete registered users (cascade agents)

- **Prompt Provided:** In super admin, page to see all registered users and delete a user including all agents in that account.
- **Architectural Flow:** `AdminUsersPage` already listed users via `GET /api/admin/users`. Added `DELETE /api/admin/users/:userId` with `deleteUserCascade` — stops agent computers, then removes chats/messages/tasks/agents and other tenant-owned collections, then the User. UI shows role + Delete (blocked for self) with confirm.
- **Impacted Files:** `backend/src/utils/deleteUserCascade.js`, `backend/src/routes/admin.js`, `frontend/src/pages/AdminUsersPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 13:55] Restore host Caddy after VPS wipe

- **Prompt Provided:** bot.vughy.com is not opening (after fresh deploy / deleted VPS files).
- **Architectural Flow:** Docker stack was healthy on :8080/:4010 but host Caddy (TLS :80/:443) was removed in the wipe. Reinstalled Caddy, wrote `deploy/Caddyfile.host` (bot.vughy.com → 127.0.0.1:8080, open.vughy.com → :8799), started service. Added `deploy/restore-host-caddy.py` for next wipe.
- **Impacted Files:** `deploy/Caddyfile.host`, `deploy/restore-host-caddy.py`, `deploy/README.md`, PROMPT_LOG

## [2026-09-15 13:40] Chat message intent: question vs goal

- **Prompt Provided:** Can the agent understand whether the message I sent is a goal or a question?
- **Architectural Flow:** New `messageIntent.js` classifies messages (heuristics + optional LLM refine). Questions get an in-chat assistant reply from agent memory/profile — no Task, no computer boot, no cancel of running goals. Goals keep the existing queue path. Overrides: `/ask` and `/run` (or `goal:` / `question:`). Chat UI placeholder explains both modes.
- **Impacted Files:** `backend/src/utils/messageIntent.js`, `backend/src/routes/chats.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-15 12:24] Optional Cua XFCE desktop for YamBot agents

- **Prompt Provided:** can we use Cua desktop for yambot project
- **Architectural Flow:** Per-agent `computer.engine` (`playwright` default | `cua`). Cua agents use image `yambot-cua:local` (`trycua/xfce-cua` + Node/Playwright worker on DISPLAY=:1, YamBot noVNC on :6080). computer-manager recreates the box on engine/image mismatch (4GB RAM). Existing Playwright agents are unchanged. Not the shared OpenMausBot `openmausbot-computer` container; cua-driver MCP is out of scope for this v1.
- **Impacted Files:** `backend/src/models/Agent.js`, `backend/src/routes/agents.js`, `backend/src/utils/desktopProxy.js`, `computer-manager/src/index.js`, `deploy/Dockerfile.cua-worker`, `deploy/docker-compose.yml`, `deploy/README.md`, `worker/entrypoint-cua.sh`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, `PROMPT_LOG.md`

## [2026-09-15 11:01] Point OpenMausBot at open.vughy.com

- **Prompt Provided:** use this domain open.vughy.com
- **Architectural Flow:** DNS A already 15.204.242.239. Host Caddy now terminates TLS for `open.vughy.com` → loopback `:8799`; sslip.io 301s to the new host. systemd `OMB_PUBLIC_URL` / `--public-url` updated so pairing links match. Let's Encrypt cert issued. YamBot `bot.vughy.com` unchanged.
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/README.md` (Caddy + systemd live on the VPS)

## [2026-09-15 10:57] Install OpenMausBot sidecar on the YamBot VPS

- **Prompt Provided:** in the same server, lets install openmausbot.com and lets test how it will work
- **Architectural Flow:** Official `openmausbot serve --tunnel` (`*.openmausbot.com`) signed in but their control plane did not issue a public address. Installed OpenMausBot 0.1.80 as Linux user `maus` + systemd on loopback `:8799`, reverse-proxied by host Caddy (admin API is off — use `systemctl restart caddy`, not reload). Test URL: `https://openmaus.15.204.242.239.sslip.io`. MiniMax seeded as openai-compat (chat-only). YamBot `bot.vughy.com` stays on `:8080`.
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/README.md` (docs only; runtime lives on the VPS)

## [2026-09-11 15:15] Soft-skip stale dismiss clicks (Got it / Accept)

- **Prompt Provided:** click failed Element not found for Got it (stale ref/xpath) — do this without failing.
- **Architectural Flow:** New `softClick.js` detects ephemeral dismiss/consent targets. Recovery now name-rebinds, tries Playwright getByRole, then soft-skips with `ok:true` when the control is already gone. Preconditions no longer hard-block a dead eN when name/css can still resolve. Absolute `/body/...` xpath is dropped so name matching is not poisoned.
- **Impacted Files:** `worker/src/browserState/softClick.js`, `worker/src/browserState/recovery.js`, `worker/src/browserState/preconditions.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 15:05] Searchable dropdown macro (choose_searchable)

- **Prompt Provided:** For dropdowns with search, can we do something?
- **Architectural Flow:** New `choose_searchable` action opens a combobox/ref, finds the filter input (active/overlay/expanded), types the query with real keystrokes, then clicks a matching listbox/option (ArrowDown+Enter fallback). `select` with `query`/`filter` routes to the same macro. Observe marks comboboxes with `aria-autocomplete` / input combobox as `[searchable]` on ACTION SURFACE. Prompt docs + verification updated.
- **Impacted Files:** `worker/src/pageDom.js`, `worker/src/browserState/macros.js`, `worker/src/browserState/index.js`, `worker/src/browserState/actionSurface.js`, `worker/src/browserState/verify.js`, `worker/src/actions.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 14:50] Compact ACTION SURFACE observe/serialize

- **Prompt Provided:** Improve the worker observe/serialize path toward a Browser-Use–style compact action surface.
- **Architectural Flow:** New `actionSurface.js` filters noise, ranks by goal/subgoal + new/overlay boosts, and emits compact lines `[e12*] button "Sign in"`. `formatStateProjection` leads with ACTION SURFACE, marks `*` from `stateDiff.added_refs`, trims a11y/structures/page-text when the surface is rich. Action schema + agent SPEED/PAGE READY lines tell the model to use those refs. Element resolution unchanged (same `ref` ids).
- **Impacted Files:** `worker/src/browserState/actionSurface.js`, `worker/src/browserState/format.js`, `worker/src/browserState/index.js`, `worker/src/actions.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 14:20] Aggressive multi-action batch prompting

- **Prompt Provided:** Tighten the worker prompt so models batch more aggressively.
- **Architectural Flow:** Stronger MULTI-ACTION rules in `buildActionSchemaForPrompt` (4–N target, anti one-action, Gmail batch example). Per-step BATCH line + SPEED WARNING when the last two turns were single-action. System SPEED lines require 4+ actions when controls are already visible.
- **Impacted Files:** `worker/src/actions.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 13:45] Vision LLM profile (agent + settings default)

- **Prompt Provided:** After "Enable vision screenshots" on agent create/edit, add a dropdown for vision LLM profile; Settings needs a default vision profile used when the agent does not pick one.
- **Architectural Flow:** `Agent.llm.visionProfile` and `User.settings.visionProfile`. `resolveVisionLlmCredentials(user, main, agent)` order: agent vision profile → settings default vision profile → legacy vision key/base/model → main LLM. Agent edit Autonomy shows the dropdown; Settings shows Default vision LLM profile.
- **Impacted Files:** `backend/src/models/Agent.js`, `backend/src/models/User.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/agentEmail.js`, `backend/src/routes/agents.js`, `backend/src/routes/settings.js`, `backend/src/routes/worker.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/pages/SettingsPage.jsx`, `frontend/src/pages/SettingsLlmProfilesPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-11 11:25] Blocked-subgoal stop

- **Prompt Provided:** Implement blocked-subgoal stop so the agent does not loop forever when one remaining piece of the goal cannot be done.
- **Architectural Flow:** `evaluateBlockedSubgoal(history)` watches consecutive thoughts that say prior work is done but the same remaining need is stuck. After 4 turns: warn the LLM to finish/ask_user. After 6 turns: force `finish` with a partial-results summary. Same-control failure streaks after prior findings also trip the stop.
- **Impacted Files:** `worker/src/browserState/blockedSubgoal.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 10:20] 40-minute FIFO run memory

- **Prompt Provided:** Each LLM call only sees the last 6 actions. The model has a 1M context window — summarize with FIFO so the agent remembers about the last 30–40 minutes.
- **Architectural Flow:** Raw actions stay at the last 6 (current refs only). `summarizeSessionContext` now injects a FIFO summary of thoughts, extracts, and failed controls from the last 40 minutes; oldest lines drop first. Typed passwords stay for the whole run. A new run is required so the worker image picks this up.
- **Impacted Files:** `worker/src/browserState/learn.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-11 09:00] Agent brief JSON parse

- **Prompt Provided:** Generate with AI on /agents/new shows "Could not parse AI response — The model did not return valid JSON."
- **Architectural Flow:** Prefer JSON from content or reasoning; repair fences, smart quotes, trailing commas, and newlines inside strings; one repair call if the first reply is still not JSON. Longer token budget so the draft is not cut off.
- **Impacted Files:** `backend/src/utils/agentDraftFromBrief.js`, `backend/src/utils/llmChat.js`, `frontend/src/pages/AgentEditPage.jsx`, PROMPT_LOG

## [2026-09-11 08:50] Session summary on each LLM step

- **Prompt Provided:** Summarize this run's context (especially email/password already typed) and send it to the LLM so login does not forget registration.
- **Architectural Flow:** `summarizeSessionContext(history)` is injected on every step; `ask_user` for email/password is skipped when those values were already typed this session.
- **Impacted Files:** `worker/src/browserState/learn.js`, `worker/src/browserState/index.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-10 15:41] Agent memory vault + day history

- **Prompt Provided:** Implement agent memory + credential vault plan — day-wise history, keyword retrieval into new chats, user-entered credentials only (plaintext in UI, encrypted at rest), per-agent scope.
- **Architectural Flow:** `Agent.dayLogs` + `Agent.credentials`; task complete appends day rollup; `toAgentSnapshot(goal)` selects recent + keyword-matched detail; worker `formatAgentSnapshot` injects SAVED LOGINS + day history; View memory UI for days/filter/vault CRUD.
- **Impacted Files:** `backend/src/models/Agent.js`, `backend/src/routes/worker.js`, `backend/src/routes/agents.js`, `backend/src/routes/chats.js`, `backend/src/routes/goals.js`, `backend/src/routes/workforce.js`, `backend/src/utils/enqueueTask.js`, `backend/src/utils/scheduler.js`, `worker/src/agent.js`, `frontend/src/pages/AgentMemoryPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-10 15:27] Vision screenshots off by default

- **Prompt Provided:** Enable vision screenshots (error recovery on cloud worker) — by default uncheck.
- **Architectural Flow:** New agents default `autonomy.visionEnabled` to false in UI EMPTY form, Agent schema, create/update body parse, worker vision gate, and autonomy prompt string. Opt-in only.
- **Impacted Files:** `frontend/src/pages/AgentEditPage.jsx`, `backend/src/models/Agent.js`, `backend/src/routes/agents.js`, `worker/src/agent.js`, PROMPT_LOG

## [2026-09-10 15:24] Remove agent-page leads upload

- **Prompt Provided:** On `/agents/new`, remove "Upload leads to this agent's group" and all related functionality.
- **Architectural Flow:** Dropped CSV upload UI + handlers from AgentEditPage (new + edit). Company → Entities import (`POST /api/entities/import`) stays. Help key `agent.leadsUpload` removed; group help points to Company.
- **Impacted Files:** `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, PROMPT_LOG

## [2026-09-08 15:26] Remove live-screen Python runner

- **Prompt Provided:** Remove the original scraper run as well; this functionality should not exist in YamBot.
- **Architectural Flow:** Dropped live-screen "Run Python" (`run_python` control, worker `python3` exec, `computer.pythonRun`, `/api/worker/python-run`). Agent computers stay browser-only. Desktop scraper container already removed.
- **Impacted Files:** `frontend/src/components/LiveScreen.jsx`, `worker/src/agent.js`, `backend/src/routes/agents.js`, `backend/src/routes/worker.js`, `backend/src/models/Agent.js`, `deploy/Dockerfile.worker`, PROMPT_LOG

## [2026-09-08 14:50] Live screen — paste and run Python on the agent computer

- **Prompt Provided:** Paste .py scripts and run them in the live screen.
- **Architectural Flow:** LiveScreen "Run Python" queues `run_python` control; worker writes the script and execs `python3` in the agent container; result stored on `computer.pythonRun` and shown under the live screen. Worker image installs python3; stale agent boxes are recreated by computer-manager.
- **Impacted Files:** `frontend/src/components/LiveScreen.jsx`, `worker/src/agent.js`, `backend/src/routes/agents.js`, `backend/src/routes/worker.js`, `backend/src/models/Agent.js`, `deploy/Dockerfile.worker`, PROMPT_LOG

## [2026-09-08 13:00] View memory link on every agent

- **Prompt Provided:** For every agent, show a link to view what is in the agent memory.
- **Architectural Flow:** GET `/api/agents/:id/memory` returns episodic notes; `/agents/:agentId/memory` page; "View memory" links on Agents, edit, Live Wall, Workforce, Command Center, Architect, System.
- **Impacted Files:** `backend/src/routes/agents.js`, `frontend/src/pages/AgentMemoryPage.jsx`, `App.jsx`, Agents/AgentEdit/LiveWall/Workforce/CommandCenter/BusinessArchitect/BusinessSetup/AgentRuns/System pages, PROMPT_LOG

## [2026-09-01 16:25] Personal VPS — Show connection details (host, port, user, password)

- **Prompt Provided:** When clicking show password, display hostname, port, username, and password together.
- **Architectural Flow:** `ConnectionCredentials` panel on Create VPS list; button renamed to "Show connection details".
- **Impacted Files:** `frontend/src/pages/AdminPersonalVpsPage.jsx`, PROMPT_LOG

## [2026-09-01 16:20] Personal VPS — explicit Docker image pull before create

- **Prompt Provided:** Fix create VPS error `(HTTP code 404) no such container - No such image: ubuntu:24.04`
- **Architectural Flow:** `ensureImage()` pulls OS image from Docker Hub when missing locally, before Mongo record + `createContainer`; clearer pull error messages.
- **Impacted Files:** `personal-vps/src/dockerOps.js`, `frontend/src/pages/AdminPersonalVpsPage.jsx`, PROMPT_LOG

## [2026-09-01 16:00] Super-admin Personal VPS — isolated Linux containers

- **Prompt Provided:** Personal VPS page for super-admin only: create named Linux containers on YamBot VPS with OS selection (including Ubuntu Desktop), password SSH/PuTTY, list/stop/delete; dynamic resources; fully isolated from YamBot product.
- **Architectural Flow:** New `personal-vps/` microservice (Docker socket, Mongo `personal_vps_instances` collection) → internal HTTP :4060 → API proxy `/api/admin/personal-vps/*` (superAdminRequired) → `AdminPersonalVpsPage` at `/admin/create-vps`.
- **Impacted Files:** `personal-vps/**`, `deploy/Dockerfile.personal-vps`, `deploy/docker-compose.yml`, `backend/src/routes/adminPersonalVps.js`, `backend/src/index.js`, `backend/src/utils/env.js`, `frontend/src/pages/AdminPersonalVpsPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `deploy/.env.example`, PROMPT_LOG

## [2026-08-31 12:10] Lead-to-Customer ordeal + browser claim — verified 10/10

- **Prompt Provided:** go (browser PASS + Lead-to-Customer ordeal)
- **Architectural Flow:** Browser agent `desired=running`; wait/claim helpers; TEST_ONLY inline Mongo claim fallback; Lead-to-Customer ordeal (GET→email→IMAP/handoff→CRM→dedupe→approval→browser→attribution). Verified: SANDBOX 14/14, LIVE 10/10 PASS (browser=inline claim; ordeal PASS).
- **Impacted Files:** liveBosWorker, liveBosOrdeal, liveBosTenant/Scenarios/liveBos.js, env example, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 12:00] Deploy LIVE_BOS env onto VPS (not GitHub)

- **Prompt Provided:** deploy everything even env file. so that i dont get confused
- **Architectural Flow:** remote-deploy.py merges local `backend/.live-bos.env` LIVE_BOS_* into server `deploy/.env` so API container process.env enables LIVE_BOS; secrets stay gitignored / out of GitHub.
- **Impacted Files:** `deploy/remote-deploy.py`, PROMPT_LOG

## [2026-08-31 11:30] LIVE_BOS real E2E harness (TEST_ONLY, no sandbox remaps as PASS)

- **Prompt Provided:** Upgrade LIVE_BOS from probe/sandbox remap into controlled real end-to-end validation (ChatGPT gaps 1–6 + safety/evidence).
- **Architectural Flow:** Dedicated LIVE_BOS tenant fixtures; wire sendAgentEmail + forcePollAgentInbox → email.replied → triggers; real WorkflowRunner (non-sandbox); real schedule tick; approval/resume; event dedupe/DLQ/replay; attribution; honest PASS/BLOCKED/NOT_IMPLEMENTED/FAIL; keep 14 sandbox proofs unchanged.
- **Impacted Files:** liveBos.js rewrite, liveBosTenant/Evidence/Scenarios, emailInboxWatcher export, Agent schedule 2m, tests, .live-bos.env.example, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 11:15] Always commit + push + deploy (project rule)

- **Prompt Provided:** always comit and deply
- **Architectural Flow:** Persist always-apply Cursor rule: after each completed iteration commit, push origin, run `python deploy/remote-deploy.py`; never commit LIVE_BOS/mailbox secrets.
- **Impacted Files:** `.cursor/rules/always-commit-deploy.mdc`, PROMPT_LOG

## [2026-08-31 11:00] LIVE_BOS scaffold — controlled live integration harness (skip without creds)

- **Prompt Provided:** scaffold only
- **Architectural Flow:** No product architecture changes. Add LIVE_BOS gated suite that maps the 14 BOS/harden proofs to real API/mailbox/browser/crash probes; SKIP with reasons until `LIVE_BOS=1` + untracked `.live-bos.env` credentials; report PASS/FAIL/SKIP.
- **Impacted Files:** `backend/src/utils/liveBos.js`, `backend/test/liveBos.test.js`, `backend/.live-bos.env.example`, proofs route/script, FEATURE_AUDIT, PROMPT_LOG, .gitignore

## [2026-08-31 10:40] Harden BOS — durability, events, chaos, security, attribution

- **Prompt Provided:** yes do everything what chatgpt says (hardening phase)
- **Architectural Flow:** Durable wait + approval workflow states; event retry/DLQ/dedupe/replay; crash/idempotency proofs; canary KPI rollback proof; cost+loop runaway guards; security+chaos suites; outcome attribution + causal memory; extend bosProofs.
- **Impacted Files:** WorkflowDefinition/Run, apiWorkflowRunner, eventBus/CompanyEvent, eventDelivery, runawayGuards, attribution, causalMemory, security/chaos proofs, scheduler, policies, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 10:25] E2E BOS proof suite (5 scenarios, no new product features)

- **Prompt Provided:** yes (prove Architect+CEO+Pulse+Workforce+Trigger+Workflow end-to-end)
- **Architectural Flow:** bosProofs runner creates ephemeral fixtures; scenarios: API email chain, multi-agent handoff, failure/heal, CEO goal/KPI, pulse optimize; `/api/proofs/run` + `npm run test:bos`.
- **Impacted Files:** `backend/src/utils/bosProofs.js`, `backend/src/routes/proofs.js`, `backend/test/bosProofs.test.js`, `backend/package.json`, `index.js`, CommandCenter, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 09:50] Deepen PARTIALs — model routing, auto-optimize, lifecycle UI, explain UI

- **Prompt Provided:** lets do it (finish remaining PARTIAL depth)
- **Architectural Flow:** modelRouter auto-tier by complexity/errors/cost; continuousOptimize tick for A/B promote; Agents/Edit/Workforce lifecycle controls; AgentRuns + Command Center explain chain UI.
- **Impacted Files:** modelRouter, continuousOptimize, scheduler, ceo/pulse, AgentsPage, AgentEditPage, WorkforcePage, AgentRunsPage, CommandCenter, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 09:10] P1/P2 Autonomous BOS — CEO loop, canary, explain, audit, resume

- **Prompt Provided:** Still thin / not full P2 — lets do this
- **Architectural Flow:** Workflow resume on task complete; CEO decide→execute tick; department hire completeness; canary promote/rollback; explainability + SOP-from-agent + NL company audit; workforce pick v2 + lifecycle API; experiment promote.
- **Impacted Files:** apiWorkflowRunner, Task, enqueueTask, worker, ceoAutonomy, departmentHire, workflowCanary, explainability, companyAudit, scheduler, ceo/workflows/workforce routes, CommandCenter, FEATURE_AUDIT, PROMPT_LOG

## [2026-08-31 09:00] Executable Business Runtime v1 (full P0 + P1 scaffolding)

- **Prompt Provided:** can we do all (approve full Autonomous BOS architecture)
- **Architectural Flow:** Event envelope/catalog; ontology links; WorkflowDefinition/Run + ApiWorkflowRunner; handoff compile at apply; sandbox tests gate build; HealController; operatingMode policy; routes /workflows /heal /ontology.
- **Impacted Files:** many under `backend/src/{models,utils,routes}`, `PoliciesPage`, `FEATURE_AUDIT.md`, `PROMPT_LOG.md`

## [2026-08-31 08:40] Audit + Autonomous Business Loop + SOP/Watch-me

- **Prompt Provided:** can we do all three? (audit, Slice A autonomous loop, SOP/Watch-me)
- **Architectural Flow:** FEATURE_AUDIT.md; businessPulse observe→act; CEO /pulse + hire-roles + optimize apply; scheduler tickBusinessPulse; Command Center pulse UI; SOP/department hire-all; managerAutonomy event dedupe; SOP decision journal.
- **Impacted Files:** `FEATURE_AUDIT.md`, `PROMPT_LOG.md`, `backend/src/utils/{businessPulse,scheduler,managerAutonomy,ceoChat}.js`, `backend/src/routes/ceo.js`, `frontend/src/pages/CommandCenterPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-31 03:20] Full recheck — fix confirmed Business OS bugs

- **Prompt Provided:** recheck all and fix
- **Architectural Flow:** Fix sync-mailbox wrong agent match; company-dashboard ObjectId aggregates; diagnose CastError; emergency desired restore; apply-change trigger sync + parent UI refresh; maxAuthorityLevel action filter; LLM tier UI + inference; AgentRuns ErrorAlert; Architect resetAll clears URL.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/{architect,companyDashboard,system}.js`, `backend/src/utils/{ceoChat,syncLiveAgentsFromPlan}.js`, `backend/src/models/Agent.js`, `frontend/src/{components/ArchitectOpsHub,pages/{AgentRuns,BusinessArchitect,SettingsLlmProfiles}Page}.jsx`

## [2026-08-31 03:05] Fix Architect ops hub fetch storm

- **Prompt Provided:** check expected errors and fix it
- **Architectural Flow:** Production logs showed Architect page looping GET blueprint + templates; ops hub useEffect depended on inline onDocLoaded/onError → infinite refetch. Stabilize via refs; skip no-op blueprint sync.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/ArchitectOpsHub.jsx`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-31 03:00] Recheck Business OS — fix bugs

- **Prompt Provided:** recheck everything and fix
- **Architectural Flow:** Audit Command Center / capabilities / connections / CEO optimizer / Architect; fix Goal `title` mapping; dashboard `tasksLast7Days` nesting; learningMode wiring; Connections upsert; ObjectId aggregate match; sidebar letter clash; tidy Architect imports.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/{capabilitiesCatalog,ceoChat,architectChat,connectionsCatalog}.js`, `frontend/src/pages/{CommandCenter,BusinessArchitect}Page.jsx`, `frontend/src/components/AppSidebar.jsx`

## [2026-08-31 02:47] Complete remaining Business OS phases

- **Prompt Provided:** complete all the phases (deferred roadmap)
- **Architectural Flow:** Connections hub; SOP→hire + department design; decision journal + authority/learningMode; blueprint restore; A/B experiment APIs; model cost optimizer; Command Center wired to all.
- **Impacted Files:** many under `backend/src/{routes,utils,models}`, `frontend/src/pages/{Connections,Decisions,CommandCenter,Policies}Page.jsx`, `ArchitectOpsHub`, `App.jsx`, `AppSidebar`, `helpContent`, `PROMPT_LOG.md`

## [2026-08-31 02:39] Business OS slice — Command Center + capabilities

- **Prompt Provided:** Complete remaining ChatGPT roadmap slice (Command Center, capability discovery, readiness, emergency stop, NL debug, live apply-change, discover)
- **Architectural Flow:** GET /api/capabilities feeds Architect + CEO; agent readiness on agents API/UI; emergency-stop/resume; /command CEO chat + discover + diagnose; Architect apply-change syncLiveAgents; Ask why on runs.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/capabilitiesCatalog.js`, `backend/src/utils/agentReadiness.js`, `backend/src/utils/ceoChat.js`, `backend/src/utils/syncLiveAgentsFromPlan.js`, `backend/src/routes/capabilities.js`, `backend/src/routes/ceo.js`, `backend/src/routes/system.js`, `backend/src/routes/agents.js`, `backend/src/routes/architect.js`, `backend/src/utils/architectChat.js`, `backend/src/models/Agent.js`, `backend/src/index.js`, `frontend/src/pages/CommandCenterPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/pages/SystemPage.jsx`, `frontend/src/pages/AgentRunsPage.jsx`, `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/components/ArchitectOpsHub.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-31 02:15] Architect email not configured after build

- **Prompt Provided:** Step 1 check_email failed — Email is not configured; user gave everything in business ops
- **Architectural Flow:** Persist encrypted Architect answers; merge on Apply; infer Gmail hosts; reject placeholder passwords; sync-mailbox endpoint + ops hub form; post-build emailWarnings.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/businessChat.js`, `backend/src/utils/applyBusinessPlan.js`, `backend/src/utils/architectChat.js`, `backend/src/utils/businessPlanFromBrief.js`, `backend/src/models/BusinessBlueprint.js`, `backend/src/routes/architect.js`, `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/components/ArchitectOpsHub.jsx`

## [2026-08-31 02:09] Agents + triggers show createdAt

- **Prompt Provided:** /agents and operations trigger page need date and time when created
- **Architectural Flow:** Show locale created date/time on Agents list rows and Operations Triggers list (createdAt already on Agent/Trigger models).
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/OperationsPage.jsx`

## [2026-08-31 02:05] Architect branches show [object Object]

- **Prompt Provided:** when i click generate architecture i see Conditions / branches [object Object]
- **Architectural Flow:** LLM often returns branches/failureHandling/humanApprovals as objects; String(obj) became "[object Object]". Coerce to readable if/then text; UI formats objects defensively.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/architectChat.js`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-31 01:45] Architect blueprint scrollable panel

- **Prompt Provided:** not able to scroll the architecture on /architect
- **Architectural Flow:** Blueprint moved above ops hub; internal max-h scroll panel with sticky header; chat collapsed when blueprint ready; pb for sticky build bar; auto-scroll after generate.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-31 01:35] Anthropic LLM auth headers + key validation

- **Prompt Provided:** 401 Invalid Anthropic API Key with correct base URL and claude-sonnet-4-6
- **Architectural Flow:** buildLlmAuthHeaders adds x-api-key + anthropic-version for anthropic.com; validate sk-ant- prefix; trim pasted keys; Anthropic preset in LLM profiles UI.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/llmDefaults.js`, `backend/src/utils/llmTest.js`, `backend/src/utils/llmChat.js`, `backend/src/routes/llmProfiles.js`, `frontend/src/pages/SettingsLlmProfilesPage.jsx`

## [2026-08-31 01:20] Architect Generate architecture for empty drafts

- **Prompt Provided:** Blueprint has no agents yet on saved draft — cannot build
- **Architectural Flow:** POST /api/architect/:id/design re-runs design pass with retry + JSON coercion; ops hub "Generate architecture" button with progress; stronger generateDesignBlueprint.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/architectChat.js`, `backend/src/routes/architect.js`, `frontend/src/components/ArchitectOpsHub.jsx`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-31 01:05] Architect Approve & Build in ops hub

- **Prompt Provided:** Simulation approved message but still cannot see Approve & Build — need step-by-step guide
- **Architectural Flow:** Prominent Approve & Build in ArchitectOpsHub when draft has agents; sync blueprint from doc on load; show ops hub when stage ready; onApply refetches blueprint if missing.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/ArchitectOpsHub.jsx`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-30 15:50] Architect saved businesses show createdAt

- **Prompt Provided:** /architect saved business section need date and time when those businesses are created
- **Architectural Flow:** GET /api/architect includes createdAt; Saved businesses list shows locale date/time next to status.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/architect.js`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-30 15:40] Architect Approve fix + Agent runs pages

- **Prompt Provided:** Architecture message but no Approve button / draft stuck; need status page per agent (when ran + final reply) and filtered all-agents runs page.
- **Architectural Flow:** Fixed Approve & Build (`blueprintId` bug, refetch draft, sticky amber CTA). New `GET /api/runs` + `GET /api/agents/:id/runs`. UI `/runs` and `/agents/:id/runs` with agent/status/date/search filters showing resultSummary.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/BusinessArchitectPage.jsx`, `backend/src/routes/architect.js`, `backend/src/routes/runs.js`, `backend/src/routes/agents.js`, `backend/src/index.js`, `frontend/src/pages/AgentRunsPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/AgentsPage.jsx`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-30 03:20] Architect live design progress bar

- **Prompt Provided:** no progress on page — need progress bar (preparing blueprint, sent to LLM, received response, etc.)
- **Architectural Flow:** `/api/architect/chat` with `stream:true` emits NDJSON progress events from chatArchitect; frontend `apiNdjson` + ArchitectProgressPanel shows bar + step checklist during design/chat.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/architectChat.js`, `backend/src/routes/architect.js`, `frontend/src/lib/api.js`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-30 03:10] Architect confirm → design stuck fix

- **Prompt Provided:** click Yes correct design it — stayed on same page
- **Architectural Flow:** After understandingConfirmed, if LLM does not return ready blueprint, run dedicated generateDesignBlueprint second pass. UI shows Designing… state, hides confirm card immediately, longer timeout.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/architectChat.js`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-30 03:00] Architect amber form layout fix

- **Prompt Provided:** /architect amber form makes design bad
- **Architectural Flow:** Moved pendingRequirements form out of the fixed-height chat card into its own scrollable section below; chat composer disabled while form is open; fields in responsive 2-col grid.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/BusinessArchitectPage.jsx`

## [2026-08-30 02:15] Business Architect Phase 2+ complete

- **Prompt Provided:** do all the phases and complete it
- **Architectural Flow:** Expanded BusinessBlueprint (versions, dataMaps, simulation, tests, changeHistory, businessRules, incidentPolicy) + BusinessTemplate. APIs: list, simulate, approve-simulation, tests, save-template, templates/use, change, apply-change, history, export. CompanyMemory sync. ArchitectOpsHub UI + simulation gate before build.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/BusinessBlueprint.js`, `backend/src/models/BusinessTemplate.js`, `backend/src/utils/architectPhase2.js`, `backend/src/routes/architect.js`, `frontend/src/components/ArchitectOpsHub.jsx`, `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-30 01:50] Business Architect (`/architect`) Phase 1

- **Prompt Provided:** New page like /business implementing Business Architect: understanding stage, progressive questions, diagram, why, checklist, manual map, reuse existing agents, approve before create. Keep /business.
- **Architectural Flow:** `/architect` → POST `/api/architect/chat` (stages gathering→understanding→ready) → BusinessBlueprint draft → Approve → applyBusinessPlan + blueprint status built. UI: SVG workflow, why components, checklist, uiMap, reuse. Phase 2+: simulation, impact analysis, templates, execution history.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/BusinessBlueprint.js`, `backend/src/utils/architectChat.js`, `backend/src/routes/architect.js`, `backend/src/index.js`, `frontend/src/pages/BusinessArchitectPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-30 01:40] Business setup — interactive chat + LLM profile + UI map

- **Prompt Provided:** Interactive /business chat; ask for email/password when needed; pick LLM profile for planning; show which page/fields are used so user can learn manual setup.
- **Architectural Flow:** POST `/api/business/chat` (messages + profileId + answers) → asking with pendingRequirements forms OR ready plan with uiMap. Apply merges answers (email encrypted onto agents). Frontend chat UI + Planning LLM dropdown.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/businessChat.js`, `backend/src/utils/businessPlanFromBrief.js`, `backend/src/utils/applyBusinessPlan.js`, `backend/src/routes/business.js`, `frontend/src/pages/BusinessSetupPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-30 01:20] Business setup — English brief → plan → create

- **Prompt Provided:** Big text box for plain-English business idea; AI explains agents/triggers/schedules/APIs before building; multi-agent handoffs (promo → reply → agent 2); daily schedules; API GET/POST patterns.
- **Architectural Flow:** `/business` → POST `/api/business/plan` (LLM structured plan, no side effects) → user reviews explanation/agents/triggers/apis → POST `/api/business/apply` creates Agents (schedules, httpAllowHosts) + Triggers. Sidebar + Start page entry.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/businessPlanFromBrief.js`, `backend/src/utils/applyBusinessPlan.js`, `backend/src/routes/business.js`, `backend/src/index.js`, `frontend/src/pages/BusinessSetupPage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/AppSidebar.jsx`, `frontend/src/pages/StartPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-29 16:25] System page — browser data sizes + Clear

- **Prompt Provided:** also in page /system, show the same button and size
- **Architectural Flow:** `/api/system/overview` enriches agent containers with Agent.computer.browserData + agentId/name. System table adds Browser data column and Clear cookies/cache/downloads (POST agents control). Superadmin may clear any agent.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/system.js`, `backend/src/routes/agents.js`, `frontend/src/pages/SystemPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-29 16:15] Show cookies / cache / downloads disk usage

- **Prompt Provided:** also show how much space the cookies, cache & downloads are taking
- **Architectural Flow:** Worker measureBrowserDataUsage(profile) on throttled heartbeats → stored on Agent.computer.browserData → returned by GET /agents/:id/live → Agent edit Cloud computer + Live screen show Cookies/Cache/Downloads/Profile total. Remeasure after clear_browser_data. Also fixed controlQueue enum to allow clear_browser_data.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserProfile.js`, `worker/src/agent.js`, `backend/src/models/Agent.js`, `backend/src/routes/worker.js`, `backend/src/routes/agents.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-29 16:10] Make Clear cookies button more visible

- **Prompt Provided:** cannot see clear cookies button in edit agent → cloud computer
- **Architectural Flow:** Button was already in production build (existing agents only). Made Cloud computer section amber + full-width button; duplicate control under Live cloud screen; note on New agent that save is required first.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/AgentEditPage.jsx`

## [2026-08-29 16:00] Clear cookies / cache / downloads button

- **Prompt Provided:** can we have a button to clear cookies, cache, download
- **Architectural Flow:** Agent edit → Clear cookies, cache & downloads → POST /api/agents/:id/control type=clear_browser_data → worker closes Chromium, clearCookiesCacheDownloads(profile), relaunches. Uploads kept.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/browserProfile.js`, `worker/src/agent.js`, `backend/src/routes/agents.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-29 15:50] Idle chat poll — stop Request timed out toast

- **Prompt Provided:** if doing nothing on a chat page, after sometime getting Request timed out Dismiss
- **Architectural Flow:** Background chat/live polls were stacking and calling setError on the 20s client abort. Skip overlapping polls; silent timeout on background refresh (ChatDetailPage, LiveScreen, FloatingChatWidget); isTimeoutError helper in api.js.
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/lib/api.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/components/FloatingChatWidget.jsx`

## [2026-08-29 15:40] Prefer DCL snapshot over wait_for guesses

- **Prompt Provided:** not all sites have Added to cart /checkout / Sign in; send DOM snapshot after domcontentloaded
- **Architectural Flow:** Prompt/skills tell the model not to use wait_for for page-ready or invented phrases. Navigate already DCL→snapshot. wait_for with no condition is skipped; timeout is soft (ok) so chat does not show wait_for failed UNKNOWN; classify WAIT_TIMEOUT when timed out.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/actions.js`, `worker/src/agent.js`, `worker/src/browserState/semanticWait.js`, `worker/src/browserState/skills.js`, `worker/src/browserState/failureClass.js`

## [2026-08-29 15:35] Drop fill_form preferred path (avoid FORM_NOT_FOUND)

- **Prompt Provided:** yes — remove fill_form failed FORM_NOT_FOUND path; use type/click batches
- **Architectural Flow:** Prompt/skills no longer prefer fill_form; multi-field fills use batched type+click. If the model still emits fill_form, normalizeActionList rewrites it to type/click so FORM_NOT_FOUND never wastes a turn.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/actions.js`, `worker/src/browserState/skills.js`

## [2026-08-29 15:17] Navigate trusts domcontentloaded only

- **Prompt Provided:** Skip spinner/stable after navigate; trust only domcontentloaded
- **Architectural Flow:** After navigate/open_tab (safeGoto already waited for DCL), skip waitForSemantic spinner + interactive-count settle; observe immediately and send snapshot to LLM. Click/type still use short settle.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/EXPERIMENT.md`

## [2026-08-29 15:05] Multi-action batches per LLM turn (aggressive default)

- **Prompt Provided:** Implement multi-action batches per turn (user: "lets do it")
- **Architectural Flow:** Raise default batch cap to 12 (16 with FAST_MODE); strengthen system/user prompts + examples so LLM returns `actions[]` by default; skip mid-batch re-observe on by default; raise fast `max_tokens` to 1200 so large batches don't truncate; shared `getMaxActionsPerTurn()` for prompt/parse/agent loop.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/fastMode.js`, `worker/src/actions.js`, `worker/src/agent.js`, `worker/EXPERIMENT.md`

## [2026-08-29 14:25] Agent Chrome extension for Teach skill

- **Prompt Provided:** Implement Agent Chrome extension so Teach skill tracks real page clicks/labels instead of screenshot coordinates
- **Architectural Flow:** MV3 extension + init-script recorder in agent Chrome; on Teach (activeDemoId) worker starts recorder and drains locator steps (role/name/css/xpath) into /api/worker/demos/step; Done teaching waits ~1.1s for flush; skill replay prefers locators then falls back to xNorm/yNorm. Extension copied into worker Docker image.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/extension/*`, `worker/src/teachBridge.js`, `worker/src/agent.js`, `worker/src/browserState/skillReplay.js`, `backend/src/utils/skillSuggestion.js`, `deploy/Dockerfile.worker`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/help/helpContent.js`, `worker/EXPERIMENT.md`

## [2026-08-29 13:35] Deploy experiment branch to production for speed test

- **Prompt Provided:** deploy to production with experiment branch so that i will test
- **Architectural Flow:** Pack/deploy current `experiment` tree via remote-deploy.py; enable YAMBOT_FAST_MODE=1 on server deploy/.env so computer-manager injects it into agent boxes; recreate agent container after rebuild.
- **Impacted Files:** `PROMPT_LOG.md`, `deploy/.env.example`

## [2026-08-29 13:30] Experiment — triage advanced speed ideas #2

- **Prompt Provided:** Another LLM’s “advanced” speed list (pattern library, prefetch, parallel acts, WASM, resource block, specialized models)
- **Architectural Flow:** Keep Skills as the real pattern library (no duplicate selector DSL). Add tracker/analytics route blocking + optional max_tokens in FAST_MODE. Reject parallel actions, prefetch tabs, WASM observe, hardcoded gpt-3.5 router. Document in EXPERIMENT.md. Stay on experiment branch; no prod deploy.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/EXPERIMENT.md`, `worker/src/resourceBlock.js`, `worker/src/agent.js`, `worker/src/llm.js`, `worker/src/fastMode.js`

## [2026-08-29 13:25] Experiment branch — curated speed optimizations

- **Prompt Provided:** Review other LLM’s browser-speed guide; if worth implementing, create `experiment` branch and implement
- **Architectural Flow:** Created branch `experiment`. Implemented safe subset: YAMBOT_FAST_MODE profile (settle/observe/batch/screen), skip frames+a11y in fast observe, skip mid-batch re-observe, thinner screenshots while running, step metrics logs, type retry on navigation context destroy. Rejected speculative no-LLM acts, LLM cache, stream early-exit, fake MutationObserver, predictive scaling. Documented in `worker/EXPERIMENT.md`. No production deploy from this branch.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/EXPERIMENT.md`, `worker/src/fastMode.js`, `worker/src/stepMetrics.js`, `worker/src/stepTiming.js`, `worker/src/browserState/observe.js`, `worker/src/actions.js`, `worker/src/agent.js`, `worker/src/index.js`, `computer-manager/src/index.js`

## [2026-08-29 13:10] Chats list — remove deleted thread immediately

- **Prompt Provided:** After delete on /chats the thread stays until full page refresh; should update immediately. Also do not wait ~10 minutes on shell.
- **Architectural Flow:** Delete was calling load() which mergeChats(prev, page) resurrected the deleted id from local state. Now tombstone deleted ids, filter them out of merge/poll, and remove the row from state right away (rollback + reload only on API failure).
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatsPage.jsx`

## [2026-08-29 13:00] Skills page — drop suggested drafts; Teach skill only

- **Prompt Provided:** /skills shows lots of suggested; do not save suggested — only skills from Teach skill
- **Architectural Flow:** GET /api/skills purges draft/training skills named Suggested:* or description Learned from task:. Done teaching now creates a draft skill from the demo. Convert-from-demo no longer revives task suggestions. /learn keeps intentional drafts without Suggested: prefix.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/skillSuggestion.js`, `backend/src/utils/demoSession.js`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/components/LiveScreen.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-29 12:35] Chat live screen stuck on STARTING…

- **Prompt Provided:** in chat page, the live screen showing STARTING…
- **Architectural Flow:** After deploy, agent box crash-looped (exit 255) because `worker/entrypoint.sh` had Windows CRLF; kernel looked for `/bin/bash\r`. Convert scripts to LF, add `.gitattributes` `*.sh eol=lf`, and strip CR in `Dockerfile.worker` so rebuilds stay bootable. Computer-manager can then keep the agent online and heartbeats clear STARTING….
- **Impacted Files:** `PROMPT_LOG.md`, `worker/entrypoint.sh`, `deploy/patch-caddy-body.sh`, `deploy/Dockerfile.worker`, `.gitattributes`

## [2026-08-29 12:15] Paginate chat thread — last 100, scroll up for older

- **Prompt Provided:** Show only last 100 chat threads; scroll up auto-loads previous 100
- **Architectural Flow:** GET /api/chats/:id pages messages (limit/before/after, default 100); ChatDetailPage loads newest page then prepends older on scroll-near-top while keeping scroll position; poll merges newer messages only. GET /api/chats also pages the thread list (100 + before) for the Chats page.
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/chats.js`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/pages/ChatsPage.jsx`

## [2026-08-29 12:10] Chat live screen empty during a run

- **Prompt Provided:** /chats/6a92474ba630660dc2f78b52 live screen box not receiving screenshots
- **Architectural Flow:** Worker skipped JPEGs whenever `running` was true (idle screenLoop forced screenshot:false; pushLiveScreen also required !running). Chat poll then had no dataBase64. Now capture during tasks except Take control and mid-navigation.
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `worker/src/index.js`

## [2026-08-28 18:50] LLM profiles — show clear test errors

- **Prompt Provided:** /settings/llms if llm is not connecting, show the clear error
- **Architectural Flow:** ErrorAlert now accepts error object or title/detail/hint; profiles Test failure shows provider title/detail/hint plus tried base URL/model next to the form
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/ErrorAlert.jsx`, `frontend/src/pages/SettingsLlmProfilesPage.jsx`


## [2026-08-28 18:40] LLM profiles page + agent dropdown

- **Prompt Provided:** Page to save LLM api/base/model + test; agents select saved LLM from dropdown on create
- **Architectural Flow:** LlmProfile model + /api/llm-profiles CRUD/test; Settings → LLM profiles UI; Agent.llm.profile ref; resolveLlmCredentialsForAgent prefers profile then legacy inline then Settings; Agent edit dropdown
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/LlmProfile.js`, `backend/src/routes/llmProfiles.js`, `backend/src/index.js`, `backend/src/models/Agent.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/agentEmail.js`, `backend/src/routes/agents.js`, `frontend/src/pages/SettingsLlmProfilesPage.jsx`, `frontend/src/pages/SettingsLayout.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`


## [2026-08-28 15:45] Agent edit — Save & test LLM

- **Prompt Provided:** In agent edit, after LLM credentials, need Test LLM
- **Architectural Flow:** POST /api/agents/:id/llm/test probes override via resolveLlmCredentialsForAgent + probeLlmConnection; UI Save & test (like email) then shows preview
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`


## [2026-08-28 15:15] Per-agent optional LLM override

- **Prompt Provided:** Yes, build per-agent LLM — if agent has its own LLM use only that; else Settings LLM
- **Architectural Flow:** Agent.llm {useCustom, apiKeyEnc, baseUrl, model}; encrypt like email SMTP; publicLlmSummary strips secrets; worker GET runtime-config uses resolveLlmCredentialsForAgent(user, agent); Agent edit UI checkbox + fields; copy clones override
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Agent.js`, `backend/src/utils/llmCredentials.js`, `backend/src/utils/agentEmail.js`, `backend/src/routes/agents.js`, `backend/src/routes/worker.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`


## [2026-08-28 14:55] Chat steps — announce before act (fix lag)

- **Prompt Provided:** Chat step messages appear after the live action (e.g. wait_for after login already done)
- **Architectural Flow:** Mirror Step N before executeAction; repeat LLM thought only on first batch item; post again only on failure; poll chat every 900ms while task active
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `frontend/src/pages/ChatDetailPage.jsx`


## [2026-08-28 14:40] Speed — skip post-LLM re-observe and precheck

- **Prompt Provided:** Remove re-observe + precheck after Received from LLM to act faster
- **Architectural Flow:** Act on the observation the model already saw; drop CDP runPrecheck before execute; recovery ladder still re-observes on failure
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`


## [2026-08-28 14:20] LLM traces — show timestamps

- **Prompt Provided:** Put timestamp for llm request and response threads
- **Architectural Flow:** LlmTraceMessage summary row shows formatChatMessageTime(createdAt) like other chat bubbles
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/LlmTraceMessage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/FloatingChatWidget.jsx`


## [2026-08-28 14:10] CAPTCHA — don't re-handoff after solved widget

- **Prompt Provided:** Solved CAPTCHA + Give control back still shows Needs you
- **Architectural Flow:** detectCaptcha treats filled reCAPTCHA/hCaptcha tokens as not present; after human handoff skip gate for 2m and proceed to LLM (no continue-loop re-handoff)
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/pageDom.js`, `worker/src/agent.js`


## [2026-08-28 14:05] Clear Needs you after CAPTCHA Give control back

- **Prompt Provided:** After Take control / solve CAPTCHA / Give control back, still shows Needs you
- **Architectural Flow:** CAPTCHA uses human_handoff (not waiting_user); Give control now always clearAgentNeedsAttention; worker emits human_handoff_done to clear again after resume
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/routes/agents.js`, `backend/src/routes/worker.js`, `worker/src/agent.js`


## [2026-08-28 13:55] Chat thread — embed LLM request/response

- **Prompt Provided:** Embed sent-to-LLM and received-from-LLM in chat threads
- **Architectural Flow:** trackedChatCompletion mirrors llm_request/llm_response (truncated, screenshots stripped); LlmTraceMessage collapsible UI in ChatDetailPage + FloatingChatWidget
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `frontend/src/components/LlmTraceMessage.jsx`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/FloatingChatWidget.jsx`


## [2026-08-28 13:45] Bootstrap — goal URL beats agent Start URL

- **Prompt Provided:** Looking at Google though goal was open vughy.com
- **Architectural Flow:** inferStartUrlFromGoal prefers goal domain over agent startUrl; bootstrap navigates when current tab differs (leave leftover Google); prompt labels startUrl as default-only fallback
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `backend/src/models/Agent.js`, `frontend/src/help/helpContent.js`


## [2026-08-28 10:50] Bootstrap navigate — skip about:blank LLM turn

- **Prompt Provided:** Skip Looking at about:blank; open URL from goal immediately
- **Architectural Flow:** inferStartUrlFromGoal extracts domain/URL (+ vughy signup hint); safeGoto before first LLM; mirror Opening…; note tells model page is ready
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`


## [2026-08-28 10:31] Phase 1 agent speed — multi-action + instant fill

- **Prompt Provided:** Implement Phase 1 speedups like browser-use (batch actions, fast fill)
- **Architectural Flow:** parse actions[]; batch execute with light settle; instant DOM type; defer mid-batch screenshots; prompt prefers fill_form + batches
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/actions.js`, `worker/src/agent.js`, `worker/src/stepTiming.js`


## [2026-08-28 09:37] Remove suggested workflows / trajectory Demo

- **Prompt Provided:** No suggested workflows after every run; create skills manually only
- **Architectural Flow:** Remove Trajectory → Demo button; remove Skills Suggested workflows section; trajectory is debug-only
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/TrajectoryPanel.jsx`, `frontend/src/pages/SkillsPage.jsx`, `frontend/src/help/helpContent.js`


## [2026-08-28 09:15] Agent email test — save before send + persist enabled

- **Prompt Provided:** Test email showed “Email is not enabled” after filling SMTP fields
- **Architectural Flow:** Test reads DB not form; button now PUT-saves then tests; PUT uses agent.set/markModified("email") so enabled/password stick
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, `backend/src/routes/agents.js`

## [2026-08-27 17:26] Skill create — Generate fields from plain-English brief

- **Prompt Provided:** Add Generate with AI on skills page to write skills from plain English
- **Architectural Flow:** POST /api/skills/draft-from-brief → draftSkillFromBrief → fills name/slug/description/playbookMd/triggers/steps/verification; SkillEditPage violet brief UI; create accepts newline triggers like PATCH
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/skillDraftFromBrief.js`, `backend/src/routes/skills.js`, `frontend/src/pages/SkillEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 16:15] Goal create — Generate fields from plain-English brief

- **Prompt Provided:** Add “Describe the job in plain English” + Generate with AI on create/edit goal (like agents)
- **Architectural Flow:** POST /api/goals/draft-from-brief → draftGoalFromBrief LLM → fills title/description/instructions/successCriteria; human still assigns agent
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/goalDraftFromBrief.js`, `backend/src/routes/goals.js`, `frontend/src/pages/GoalEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 15:54] Surface all Entity types in Company + docs

- **Prompt Provided:** Update all entity types in the project so Company/help/agents list the full type catalog
- **Architectural Flow:** Shared frontend ENTITY_TYPE_OPTIONS; Company filter + Add form use full enum; help + worker prompts document lead|customer|vendor|product|process|document|ticket|custom vs kind
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/lib/entityTypes.js`, `frontend/src/pages/CompanyPage.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/help/agentActionsContent.js`, `backend/src/models/Entity.js`, `backend/src/utils/agentDraftFromBrief.js`, `worker/src/actions.js`

## [2026-08-27 15:21] Custom entity tables via Entity.kind

- **Prompt Provided:** Create arbitrary tables (e.g. weather) with fields; one agent writes, another reads in same group
- **Architectural Flow:** Entity.kind = custom table slug; create/search/update accept kind/table; AI brief + help teach type custom + kind; Company type/kind filters
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/entityKind.js`, `backend/src/models/Entity.js`, `backend/src/routes/workerEntities.js`, `backend/src/routes/entities.js`, `backend/src/utils/entityContext.js`, `backend/src/utils/agentDraftFromBrief.js`, `worker/src/agent.js`, `worker/src/actions.js`, `frontend/src/pages/CompanyPage.jsx`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/help/agentActionsContent.js`

## [2026-08-27 15:14] Agent edit — upload leads into agent group territory

- **Prompt Provided:** Upload leads on the agent page so they go to that agent's database
- **Architectural Flow:** AgentEditPage CSV paste/file → POST /api/entities/import with groupId from selected Group; requires group (e.g. USA); shared with all agents in that territory
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 14:57] Agent create — Generate fields from plain-English brief

- **Prompt Provided:** Text box on create agent for plain English job; AI generates standing instructions (with entities), persona, skill, success criteria; group assigned separately
- **Architectural Flow:** POST /api/agents/draft-from-brief uses user LLM via agentDraftFromBrief; AgentEditPage job brief + Generate with AI fills form fields for review
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/agentDraftFromBrief.js`, `backend/src/routes/agents.js`, `frontend/src/pages/AgentEditPage.jsx`, `frontend/src/help/helpContent.js`

## [2026-08-27 14:50] Agent edit — Entities how-to popup beside instructions

- **Prompt Provided:** On agent create/edit, beside instructions, small link that opens popup explaining entities and how to use them in instructions
- **Architectural Flow:** HelpTooltip gains alwaysVisible + linkLabel; agent.entitiesGuide help content with copy-paste examples; AgentEditPage shows link next to Standing instructions (works even when Help toggle is off)
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/components/HelpTooltip.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/pages/AgentEditPage.jsx`

## [2026-08-27 14:39] Territory-scoped support tickets by agent group

- **Prompt Provided:** Scope Tickets by country/group like leads so support agents 4–6 share a country ticket table
- **Architectural Flow:** Ticket.group = Agent.group; create/search/update scoped; email intake tags inbox agent territory; Queues UI territory filter; mirror Entity inherits group
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Ticket.js`, `backend/src/utils/entityTerritory.js`, `backend/src/utils/ticketEngine.js`, `backend/src/routes/workerEntities.js`, `backend/src/routes/tickets.js`, `backend/src/routes/groups.js`, `worker/src/agent.js`, `worker/src/actions.js`, `frontend/src/pages/QueuesPage.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/help/agentActionsContent.js`

## [2026-08-27 14:23] Territory-scoped lead DBs by agent group

- **Prompt Provided:** Implement shared lead database per agent group (country); finder + email agents share DB; fields via instructions; status new filter; isolate countries
- **Architectural Flow:** Entity.group = Agent.group; create_entity tags territory; search/get/update scoped; campaigns enroll by campaign agent group; Company territory filter + CSV/import into group; default lead status new
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/utils/entityTerritory.js`, `backend/src/models/Entity.js`, `backend/src/routes/workerEntities.js`, `backend/src/routes/entities.js`, `backend/src/routes/groups.js`, `backend/src/utils/campaignEngine.js`, `backend/src/utils/entityContext.js`, `backend/src/utils/csvLeadsImport.js`, `worker/src/agent.js`, `worker/src/actions.js`, `frontend/src/pages/CompanyPage.jsx`, `frontend/src/help/helpContent.js`, `frontend/src/help/agentActionsContent.js`

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
