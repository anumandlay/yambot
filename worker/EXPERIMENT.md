# Experiment branch — browser automation speed

Branch: `experiment` (from `feature/playwright-chrome`)

## What we took from the other LLM (and what we rejected)

### Implemented (architecture-safe)

| Idea | How |
|------|-----|
| Fast mode env preset | `YAMBOT_FAST_MODE=1` via `worker/src/fastMode.js` |
| Shorter settles | `stepTiming.js` lowers settle/fill/recovery when fast |
| Bigger batches | max actions 12; stronger SPEED wording in `actions.js` |
| Cheaper observe | skip frames + skip a11y in fast; smaller prompt projection (30 / 1000) |
| Skip mid-batch re-observe | light fill actions in a batch only settle; full observe on last item |
| Decouple screenshots | while running: longer interval + JPEG only every Nth heartbeat |
| Step metrics | `[metrics]` console averages (observe/llm/act/settle) |
| Type nav race retry | one retry after `domcontentloaded` on “execution context destroyed” |
| Manager passthrough | manager forwards `YAMBOT_FAST_MODE` / `YAMBOT_OBSERVE_LIMIT` into agent boxes |

### Rejected (unsafe or wrong for YamBot)

- **Speculative no-LLM actions** — proposed `selector`/`value` schema ≠ our `ref`/`type` contract; blind login submit is dangerous
- **LLM response cache** — same last-3-messages hash with different DOM → wrong clicks
- **Stream early-terminate on partial JSON** — incomplete actions
- **MutationObserver on Playwright `page` object** — invalid API usage
- **Predictive worker scaling / prewarm in computer-manager** — wrong layer; boxes already stay warm
- **Claimed 60s→15s** — marketing; measure with `[metrics]` first

## Enable locally

```bash
# worker/.env.local
YAMBOT_FAST_MODE=1
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
3. Metrics show real improvement without more ask_user / recovery loops
