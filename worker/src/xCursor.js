/**
 * @fileoverview Visible X11 cursor moves for CUA mode on the live noVNC screen.
 * Purpose: Playwright CDP clicks do not move the OS cursor; xdotool does — so Take control
 * viewers can see the pointer glide to each target while CUA is active.
 * Downstream: agent.js click / click_at / type / type_at when computerUse.isActive().
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string }>}
 */
async function xdotool(args, opts = {}) {
  const timeoutMs = Math.max(500, Number(opts.timeoutMs) || 4000);
  try {
    const { stdout, stderr } = await execFileAsync("xdotool", args, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
      },
      maxBuffer: 256 * 1024,
    });
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout || ""),
      stderr: String(err?.stderr || err?.message || err),
    };
  }
}

/**
 * Maps a viewport CSS point to X11 screen coordinates for the focused Chrome window.
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<{ screenX: number, screenY: number, ok: boolean }>}
 */
export async function viewportToScreen(page, x, y) {
  try {
    const m = await page.evaluate(
      ({ vx, vy }) => {
        const sx = Number(window.screenX ?? window.screenLeft ?? 0);
        const sy = Number(window.screenY ?? window.screenTop ?? 0);
        const ow = Number(window.outerWidth || window.innerWidth || 1);
        const oh = Number(window.outerHeight || window.innerHeight || 1);
        const iw = Number(window.innerWidth || 1);
        const ih = Number(window.innerHeight || 1);
        const borderX = Math.max(0, (ow - iw) / 2);
        const chromeY = Math.max(0, oh - ih - borderX);
        return {
          screenX: Math.round(sx + borderX + (Number(vx) || 0)),
          screenY: Math.round(sy + chromeY + (Number(vy) || 0)),
        };
      },
      { vx: x, vy: y }
    );
    return {
      screenX: Number(m.screenX) || 0,
      screenY: Number(m.screenY) || 0,
      ok: true,
    };
  } catch {
    return { screenX: Math.round(x), screenY: Math.round(y), ok: false };
  }
}

/**
 * Reads current X pointer position.
 * @returns {Promise<{ x: number, y: number }|null>}
 */
async function getMouseLocation() {
  const r = await xdotool(["getmouselocation", "--shell"]);
  if (!r.ok) return null;
  const mx = /X=(\d+)/.exec(r.stdout);
  const my = /Y=(\d+)/.exec(r.stdout);
  if (!mx || !my) return null;
  return { x: Number(mx[1]), y: Number(my[1]) };
}

/**
 * Glides the real X cursor so noVNC shows motion (not an instant teleport).
 * @param {number} screenX
 * @param {number} screenY
 * @param {{ steps?: number, stepMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, screenX: number, screenY: number, error?: string }>}
 */
export async function moveXCursorVisible(screenX, screenY, opts = {}) {
  const tx = Math.round(Number(screenX) || 0);
  const ty = Math.round(Number(screenY) || 0);
  const steps = Math.max(1, Math.min(24, Number(opts.steps) || 10));
  const stepMs = Math.max(8, Math.min(80, Number(opts.stepMs) || 18));

  // Why: ensure a visible pointer theme on bare Xvfb/fluxbox sessions.
  await xdotool(["mousemove_relative", "--", "0", "0"]);

  const cur = await getMouseLocation();
  const fromX = cur?.x ?? tx;
  const fromY = cur?.y ?? ty;

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const ix = Math.round(fromX + (tx - fromX) * t);
    const iy = Math.round(fromY + (ty - fromY) * t);
    const moved = await xdotool(["mousemove", "--sync", String(ix), String(iy)]);
    if (!moved.ok && i === steps) {
      return { ok: false, screenX: tx, screenY: ty, error: moved.stderr };
    }
    if (i < steps) {
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
  return { ok: true, screenX: tx, screenY: ty };
}

/**
 * Moves the visible OS cursor to a viewport point, then Playwright-clicks (reliable hit).
 * @param {import('playwright').Page} page
 * @param {number} x - viewport CSS x
 * @param {number} y - viewport CSS y
 * @param {{ delayMs?: number, steps?: number }} [opts]
 * @returns {Promise<{ ok: boolean, x: number, y: number, screenX?: number, screenY?: number, cursorMoved: boolean }>}
 */
export async function clickWithVisibleCursor(page, x, y, opts = {}) {
  const vx = Number(x);
  const vy = Number(y);
  const mapped = await viewportToScreen(page, vx, vy);
  const moved = await moveXCursorVisible(mapped.screenX, mapped.screenY, {
    steps: opts.steps,
  });
  const delayMs = Math.max(0, Number(opts.delayMs) ?? 40);
  await page.mouse.click(vx, vy, { delay: delayMs });
  return {
    ok: true,
    x: vx,
    y: vy,
    screenX: moved.screenX,
    screenY: moved.screenY,
    cursorMoved: moved.ok,
  };
}
