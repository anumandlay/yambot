# YamBot experiment branch — feature audit

Audited against the Business OS / “AI builds & runs the business” checklist.  
Status: **PASS** = runtime-wired · **PARTIAL** = exists but incomplete · **MISSING** = not meaningfully present.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Business AI conversational planner | PASS | Architect chat loop |
| 2 | Business blueprint generation | PASS | BusinessBlueprint + design pass |
| 3 | AI clarification / questions | PASS | pendingRequirements |
| 4 | Missing credentials detection | PASS | Sealed answers + sync-mailbox |
| 5 | AI-generated agents | PASS | applyBusinessPlan |
| 6 | AI-generated schedules | PASS | Plan → Agent.schedule |
| 7 | AI-generated triggers | PASS | Create + live sync |
| 8 | Agent-to-agent handoffs | PASS | Handoff compile → triggers + correlationId |
| 9 | API GET→act→POST workflows | PASS | WorkflowDefinition + ApiWorkflowRunner |
| 10 | Capability discovery | PASS | /api/capabilities + CEO discover |
| 11 | Skill/tool reuse | PASS | Catalog + Skills library |
| 12 | Simulation | PASS | Synthetic dry-run |
| 13 | Automated tests | PASS | Sandbox suite gates Architect build |
| 14 | Approval before build | PASS | Simulation gate + Approve & Build |
| 15 | Natural-language changes | PASS | /change → apply-change |
| 16 | Change-impact analysis | PASS | computeChangeImpact |
| 17 | Versioning / rollback | PASS | versions + restore (blueprint JSON) |
| 18 | Company memory | PASS | CompanyMemory + CEO injection |
| 19 | CEO AI | PASS | Command Center + /api/ceo |
| 20 | Department / workforce creation | PASS | One-shot: agents+goals+KPIs+skills+escalation+workflow stub |
| 21 | KPI / business monitoring | PASS | Goals + dashboard + autonomy gaps |
| 22 | Failure recovery / self-healing | PASS | HealController + playbooks + loop guard |
| 23 | Cost / model optimization | PASS | Scored modelRouter + auto-apply in autonomous |
| 24 | Agent health / readiness | PASS | agentReadiness |
| 25 | Natural-language debugging | PASS | diagnoseCeo + Explain chain UI on Runs |
| 26 | Company-wide audit | PASS | Structural + NL `/api/ceo/audit-company` |
| 27 | Emergency / escalation | PASS | emergency-stop + task escalation |
| 28 | Continuous optimization | PASS | Auto experiment start/measure/promote/rollback |
| 29 | Goal autonomy loop | PASS | tickGoalAutonomy |
| 30 | Manager / workforce autonomy | PASS | tickManagerAutonomy + pick v2 |
| 31 | Event bus / CompanyEvent | PASS | eventBus → triggers |
| 32 | SOP → hire | PASS | from-sop (+ complete department hire) |
| 33 | Watch-me / demo → skill | PASS | Demonstration → draft Skill; pulse surfaces drafts |
| 34 | Decision journal / authority | PASS | DecisionJournal + maxAuthorityLevel |
| 35 | Learning mode | PASS | Explain chains + HOW-TO-configure + CEO WHY |
| 36 | Connections hub | PASS | /connections |
| 37 | CEO decide/execute loop | PASS | tickCeoAutonomy + /api/ceo/loop |
| 38 | Sandbox→canary→production | PASS | promote/rollback + auto canary rollback |
| 39 | Workflow resume on agent step | PASS | Task.workflowRunId → resumeWorkflowRun |
| 40 | AI employee → SOP | PASS | /api/ceo/sop-from-agent |

## Outer loop (ChatGPT “missing”)

Seeds existed; **Autonomous Business Loop v1** wires Observe → Decide → Act → Measure into Command Center + scheduler (`businessPulse.js`).

## E2E proofs

Runtime proofs at `POST /api/proofs/run` (`suite`: `bos` | `harden` | `all`) and `npm run test:bos`:

**BOS (5)**  
1. API GET→map→POST→verify  
2. Multi-agent handoff + `email.replied` triggers  
3. Failure→diagnose→modify→heal→retry  
4. Goal KPI gap→workforce pick→CEO loop→measure  
5. Deterioration→pulse→recovery→routing→optimize  

**Harden (9)** — ChatGPT “break it” phase  
1. Durable delay + crash resume (`waiting_delay` + `wakeAt`)  
2. `await_approval` → resume on approve  
3. Event dedupe + DLQ + replay  
4. POST-once idempotency after crash/retry  
5. Canary KPI deterioration auto-rollback  
6. Cost ceiling + CEO oscillation guards  
7. Security adversarial (SSRF / HTTP allowlist)  
8. Chaos (bad assert, DLQ, kill mid-wait)  
9. Outcome attribution + causal memory  

## Hardening runtime (PASS)

| Capability | Status | Notes |
|---|---|---|
| Durable waits (days) | PASS | `delay` / `wait_until` → `waiting_delay` + scheduler `tickWorkflowWaits` |
| WAITING_FOR_APPROVAL | PASS | `await_approval` + Approval.workflowRunId → resume |
| Event retry / DLQ / dedupe / replay | PASS | `eventDelivery.js` + `/api/events/dead-letters` + `/:id/replay` |
| Cost / loop runaway guards | PASS | `runawayGuards` on CEO + enqueue + optimize; Policies UI |
| Canary KPI rollback | PASS | `canaryKpi*` fields + `tickCanaryMonitor` |
| Attribution + causal memory | PASS | `/api/ceo/attribution`, `/api/ceo/causal-memory` |
| Real-world live mailbox/API | PARTIAL | Scaffold: `npm run test:live-bos` + `POST /api/proofs/run` `{suite:"live"}`. Copy `backend/.live-bos.env.example` → `.live-bos.env`, set `LIVE_BOS=1`. Without creds all scenarios SKIP (not fail). |

## LIVE_BOS (scaffold)

Controlled live harness maps the 14 sandbox proofs to real API / IMAP / browser / crash probes.

| Mode | Behavior |
|---|---|
| Default (`LIVE_BOS` unset/0) | Entire suite SKIP — CI-safe |
| `LIVE_BOS=1` + partial creds | Probes that have creds run; others SKIP; mongo-mapped harden/BOS re-run when userId present |
| Full creds later | Fill API + IMAP (+ optional browser/crash flags) — same suite, no architecture change |
