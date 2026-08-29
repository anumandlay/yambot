/**
 * @fileoverview Skill replay — deterministic playback of demo-captured actions.
 * Purpose: Phase 3 runs click/type/navigate steps before the LLM loop when executionMode is replay.
 * Prefer role/name/css/xpath from Teach extension; fall back to screenshot coordinates.
 * Downstream: worker/src/agent.js runTask.
 */

const REPLAY_TYPES = new Set(["navigate", "click", "type", "key", "scroll", "select"]);

/**
 * Extracts machine-runnable steps from a skill document (objects or legacy strings).
 * @param {object|null} skill
 * @returns {object[]}
 */
export function extractReplayableSteps(skill) {
  const out = [];
  for (const raw of skill?.steps || []) {
    const step = normalizeOneReplayStep(raw);
    if (step) out.push(step);
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
function normalizeOneReplayStep(raw) {
  if (!raw) return null;
  let action = raw;
  if (typeof raw === "object" && raw.action?.type) action = raw.action;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type) return sanitizeReplayAction(parsed);
      if (parsed?.action?.type) return sanitizeReplayAction(parsed.action);
    } catch {
      const click = text.match(/^Click at (\d+)%, (\d+)%$/i);
      if (click) {
        return sanitizeReplayAction({
          type: "click",
          xNorm: Number(click[1]) / 100,
          yNorm: Number(click[2]) / 100,
        });
      }
      if (text.startsWith("Type: ")) {
        return sanitizeReplayAction({ type: "type", text: text.slice(6) });
      }
      if (text.startsWith("Press key: ")) {
        return sanitizeReplayAction({ type: "key", key: text.slice(11) });
      }
      if (/^Scroll (down|up)$/i.test(text)) {
        return sanitizeReplayAction({
          type: "scroll",
          dy: /^Scroll down/i.test(text) ? 400 : -400,
        });
      }
    }
    return null;
  }
  if (typeof action === "object" && action.type) {
    return sanitizeReplayAction(action);
  }
  return null;
}

/**
 * @param {object} action
 * @returns {object|null}
 */
function sanitizeReplayAction(action) {
  const type = String(action.type || "").trim();
  if (!REPLAY_TYPES.has(type) || type === "session") return null;
  if (type === "navigate") {
    const url = String(action.url || "").trim();
    return url ? { type, url } : null;
  }
  if (type === "click" || type === "type" || type === "select" || type === "key") {
    const out = { type };
    if (action.css) out.css = String(action.css);
    if (action.xpath) out.xpath = String(action.xpath);
    if (action.id) out.id = String(action.id);
    if (action.name) out.name = String(action.name);
    if (action.role) out.role = String(action.role);
    if (action.ariaLabel) out.ariaLabel = String(action.ariaLabel);
    if (action.placeholder) out.placeholder = String(action.placeholder);
    if (action.textLabel) out.textLabel = String(action.textLabel);
    if (action.href) out.href = String(action.href);
    if (type === "type") out.text = String(action.text ?? "");
    if (type === "select") out.value = String(action.value ?? action.text ?? "");
    if (type === "key") out.key = String(action.key || "Enter");
    const xNorm = Number(action.xNorm);
    const yNorm = Number(action.yNorm);
    if (Number.isFinite(xNorm) && Number.isFinite(yNorm)) {
      out.xNorm = xNorm;
      out.yNorm = yNorm;
    }
    const hasLocator =
      out.css || out.xpath || out.id || out.name || out.role || out.ariaLabel || out.placeholder;
    if (type === "click" && !hasLocator && (out.xNorm == null || out.yNorm == null)) return null;
    if (type === "type" && !hasLocator && out.xNorm == null && !String(out.text || "")) return null;
    return out;
  }
  if (type === "scroll") {
    return { type, dy: Number(action.dy) || 400 };
  }
  return null;
}

/**
 * Human label for a replay step (chat mirror / logs).
 * @param {object} step
 * @returns {string}
 */
export function describeReplayStep(step) {
  if (!step?.type) return "step";
  if (step.type === "navigate") return `navigate ${step.url}`;
  if (step.type === "click") {
    if (step.name || step.ariaLabel || step.textLabel) {
      return `click "${step.name || step.ariaLabel || step.textLabel}"`;
    }
    if (step.css) return `click ${step.css}`;
    if (step.xNorm != null) {
      return `click ${Math.round(step.xNorm * 100)}%,${Math.round(step.yNorm * 100)}%`;
    }
    return "click";
  }
  if (step.type === "type") return `type "${String(step.text || "").slice(0, 40)}"`;
  if (step.type === "select") return `select ${step.value}`;
  if (step.type === "key") return `key ${step.key}`;
  if (step.type === "scroll") return `scroll ${step.dy > 0 ? "down" : "up"}`;
  return step.type;
}

/**
 * @param {import('playwright').Page} page
 * @param {object} step
 * @returns {Promise<import('playwright').Locator|null>}
 */
async function locatorForStep(page, step) {
  /** @type {import('playwright').Locator[]} */
  const candidates = [];
  if (step.css) candidates.push(page.locator(step.css).first());
  if (step.id) candidates.push(page.locator(`[id=${JSON.stringify(String(step.id))}]`).first());
  if (step.xpath) candidates.push(page.locator(`xpath=${step.xpath}`).first());
  if (step.role && (step.name || step.ariaLabel || step.textLabel)) {
    const name = step.name || step.ariaLabel || step.textLabel;
    candidates.push(page.getByRole(step.role, { name: String(name), exact: false }).first());
  }
  if (step.placeholder) {
    candidates.push(page.getByPlaceholder(String(step.placeholder)).first());
  }
  if (step.name && !step.role) {
    candidates.push(page.locator(`[name="${String(step.name).replace(/"/g, '\\"')}"]`).first());
  }
  if (step.ariaLabel) {
    candidates.push(page.getByLabel(String(step.ariaLabel), { exact: false }).first());
  }
  for (const loc of candidates) {
    try {
      if (await loc.count()) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Plays back replayable skill steps on the live Playwright page.
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {object} opts.skill
 * @param {{ width?: number, height?: number }} [opts.viewport]
 * @param {(ms: number) => Promise<void>} opts.sleep
 * @param {(info: { index: number, step: object, ok: boolean, error?: string }) => Promise<void>} [opts.onStep]
 * @returns {Promise<{ completed: number, total: number, failed: boolean, failedStep?: number, error?: string, skipped?: boolean }>}
 */
export async function runSkillReplay({ page, skill, viewport, sleep, onStep }) {
  const steps = extractReplayableSteps(skill);
  if (!steps.length) {
    return { completed: 0, total: 0, failed: false, skipped: true };
  }
  const vw = viewport?.width || 1280;
  const vh = viewport?.height || 800;
  let completed = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    try {
      if (step.type === "navigate") {
        await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } else if (step.type === "click") {
        const loc = await locatorForStep(page, step);
        if (loc) {
          await loc.click({ timeout: 10_000 });
        } else if (step.xNorm != null && step.yNorm != null) {
          const x = Math.round(step.xNorm * vw);
          const y = Math.round(step.yNorm * vh);
          await page.mouse.click(x, y, { delay: 40 });
        } else {
          throw new Error("No locator or coordinates for click");
        }
      } else if (step.type === "type") {
        const loc = await locatorForStep(page, step);
        if (loc) {
          await loc.click({ timeout: 8_000 });
          await loc.fill(String(step.text || ""));
        } else {
          await page.keyboard.type(String(step.text || ""), { delay: 18 });
        }
      } else if (step.type === "select") {
        const loc = await locatorForStep(page, step);
        if (loc) {
          await loc.selectOption({ value: String(step.value || "") }).catch(async () => {
            await loc.selectOption({ label: String(step.value || "") });
          });
        } else {
          throw new Error("No locator for select");
        }
      } else if (step.type === "key") {
        await page.keyboard.press(String(step.key || "Enter"));
      } else if (step.type === "scroll") {
        await page.mouse.wheel(0, Number(step.dy) || 400);
      }
      completed += 1;
      await onStep?.({ index: i, step, ok: true });
      await sleep(450);
    } catch (err) {
      const message = String(err?.message || err);
      await onStep?.({ index: i, step, ok: false, error: message });
      return {
        completed,
        total: steps.length,
        failed: true,
        failedStep: i + 1,
        error: message,
      };
    }
  }
  return { completed, total: steps.length, failed: false };
}
