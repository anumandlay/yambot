# Experiment branch — browser automation speed

Branch: `experiment` (from `feature/playwright-chrome`)

## What we took from the other LLM (and what we rejected)

### Implemented (architecture-safe)

| Idea | How |
|------|-----|
| Fast mode env preset | `YAMBOT_FAST_MODE=1` via `worker/src/fastMode.js` |
| Shorter settles | `stepTiming.js` lowers settle/fill/recovery when fast |
| Bigger batches | max actions 12; stronger SPEED wording in `actions.js` |
| Cheaper observe | skip frames + a11y in fast; smaller prompt projection (30 / 1000) |
| Skip mid-batch re-observe | light fill actions in a batch only settle; full observe on last item |
| Decouple screenshots | while running: longer interval + JPEG only every Nth heartbeat |
| Step metrics | `[metrics]` console averages (observe/llm/act/settle) |
| Type nav race retry | one retry after `domcontentloaded` on “execution context destroyed” |
| Manager passthrough | manager forwards `YAMBOT_FAST_MODE` / `YAMBOT_OBSERVE_LIMIT` into agent boxes |
| Tracker/analytics blocking | `resourceBlock.js` aborts GA/GTM/FB/Hotjar/etc. (not first-party) when fast / `YAMBOT_BLOCK_ANALYTICS=1` |
| Shorter LLM completions | `max_tokens≈600` in fast mode via `chatCompletion` |
| **Teach Chrome extension** | `worker/extension` loaded into agent Chrome; records role/name/css/xpath; replay uses locators |

### Rejected from “advanced” reply #2

| Proposal | Why rejected |
|----------|----------------|
| New Pattern Library (`selector`/`{{EMAIL}}`) | **Duplicate of Skills** — Teach skill + production `replay` already bypasses LLM for known flows. Wrong action schema for YamBot. |
| Predictive prefetch (background tabs) | Breaks single-tab policy, burns RAM, races the live page |
| Parallel try-many-actions | Corrupts one shared Playwright page; not safe |
| DiffObserver / WASM DOM | Observe already runs **inside** Chromium via `page.evaluate`; Node WASM doesn’t help; we already reuse obs when URL unchanged |
| gpt-3.5 specialized router | Product uses per-user LLM profiles; don’t hardcode OpenAI model names |
| Smart retry on CSS selectors | We use `ref` + fingerprints + recovery ladder already |
| Block all images/fonts | Breaks real sites / CAPTCHA / branding; we only block trackers |
| “3–5s login” marketing targets | Unverified; measure with `[metrics]` first |

### Use Skills as the pattern library (intended design)

1. Chat → **Teach skill** on a login/search flow  
2. Edit skill → status **production**, `executionMode: replay`  
3. Next matching goal skips most LLM steps for that sequence  

That is the correct YamBot equivalent of “pre-computed action sequences.”

## Enable locally

```bash
# worker/.env.local
YAMBOT_FAST_MODE=1
# optional overrides:
# YAMBOT_BLOCK_ANALYTICS=1
# YAMBOT_LLM_MAX_TOKENS=600
# YAMBOT_SKIP_FRAMES=0   # if payment iframes break
```

## Enable on VPS (when you intentionally deploy this branch)

In `deploy/.env` (server-local, not committed):

```
YAMBOT_FAST_MODE=1
```

Then ensure computer-manager compose passes that env through (already reads `process.env.YAMBOT_FAST_MODE`).

## Measure

Watch worker logs:

```
[metrics] step=… this={obs:… llm:… act:… settle:…} avg={…}
```

Compare llmMs vs observeMs vs settleMs — LLM usually dominates.

## Do not merge to production until

1. Login + captcha + Take control still work with frames/a11y skipped  
2. Payment iframes still reachable (may need `YAMBOT_SKIP_FRAMES=0`)  
3. OAuth/login not broken by tracker blocking (disable with `YAMBOT_BLOCK_ANALYTICS=0` if needed)  
4. Metrics show real improvement without more ask_user / recovery loops  
