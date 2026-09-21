/**
 * @fileoverview Visible cursor for CUA mode on the live noVNC screen.
 * Purpose: Playwright CDP clicks do not move the OS cursor; xdotool does. Chrome often hides
 * the X pointer over web content, so we also paint a fixed ✕ overlay in the page that noVNC
 * always shows. Coordinate spaces must not be mixed:
 * - viewport CSS: Playwright page.mouse + attached vision screenshot (origin = content top-left)
 * - screen/desktop: AT-SPI frames + xdotool (origin = X root)
 * Downstream: agent.js click / click_at / type / type_at / computer_use when CUA is active.
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
 * @returns {Promise<{ screenX: number, screenY: number, contentScreenX?: number, contentScreenY?: number, ok: boolean }>}
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
          contentScreenX: Math.round(sx + borderX),
          contentScreenY: Math.round(sy + chromeY),
        };
      },
      { vx: x, vy: y }
    );
    return {
      screenX: Number(m.screenX) || 0,
      screenY: Number(m.screenY) || 0,
      contentScreenX: Number(m.contentScreenX) || 0,
      contentScreenY: Number(m.contentScreenY) || 0,
      ok: true,
    };
  } catch {
    return { screenX: Math.round(x), screenY: Math.round(y), ok: false };
  }
}

/**
 * Inverse of viewportToScreen — AT-SPI / desktop pixels → Playwright viewport CSS.
 * @param {import('playwright').Page} page
 * @param {number} screenX
 * @param {number} screenY
 * @returns {Promise<{ x: number, y: number, ok: boolean }>}
 */
export async function screenToViewport(page, screenX, screenY) {
  const origin = await viewportToScreen(page, 0, 0);
  if (!origin.ok) {
    return { x: Math.round(screenX), y: Math.round(screenY), ok: false };
  }
  const ox = origin.contentScreenX ?? origin.screenX;
  const oy = origin.contentScreenY ?? origin.screenY;
  return {
    x: Math.round(Number(screenX) - ox),
    y: Math.round(Number(screenY) - oy),
    ok: true,
  };
}

/**
 * AT-SPI frame {x,y,w,h} is desktop/screen space — convert center to viewport CSS for Playwright.
 * @param {import('playwright').Page} page
 * @param {{ x?: number, y?: number, w?: number, h?: number }|null} frame
 * @returns {Promise<{ x: number, y: number, screenX: number, screenY: number, ok: boolean }|null>}
 */
export async function atspiFrameCenterToViewport(page, frame) {
  if (!frame || frame.x == null || frame.y == null) return null;
  const screenX = Number(frame.x) + Number(frame.w || 0) / 2;
  const screenY = Number(frame.y) + Number(frame.h || 0) / 2;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  const vp = await screenToViewport(page, screenX, screenY);
  return {
    x: vp.x,
    y: vp.y,
    screenX: Math.round(screenX),
    screenY: Math.round(screenY),
    ok: vp.ok,
  };
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
 * Glides a bright ✕ overlay inside the page (always visible on noVNC even when Chrome hides X pointer).
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 * @param {{ fromX?: number, fromY?: number, steps?: number, stepMs?: number }} [opts]
 */
async function glidePageOverlay(page, x, y, opts = {}) {
  if (!page || page.isClosed()) return { ok: false };
  const tx = Math.round(Number(x) || 0);
  const ty = Math.round(Number(y) || 0);
  const steps = Math.max(1, Math.min(20, Number(opts.steps) || 12));
  const stepMs = Math.max(12, Math.min(60, Number(opts.stepMs) || 22));
  try {
    await page.evaluate(
      ({ tx, ty, steps, stepMs, fromX, fromY }) => {
        const ID = "__yambot_cua_cursor";
        let el = document.getElementById(ID);
        if (!el) {
          el = document.createElement("div");
          el.id = ID;
          el.setAttribute("aria-hidden", "true");
          el.textContent = "✕";
          el.style.cssText = [
            "position:fixed",
            "z-index:2147483647",
            "pointer-events:none",
            "width:32px",
            "height:32px",
            "margin-left:-16px",
            "margin-top:-16px",
            "font:800 28px/32px ui-monospace,monospace",
            "color:#e11",
            "text-shadow:0 0 2px #fff,0 0 6px #000,1px 1px 0 #fff",
            "left:0",
            "top:0",
            "display:block",
          ].join(";");
          document.documentElement.appendChild(el);
        }
        const startX =
          Number.isFinite(fromX) ? fromX : Number.parseFloat(el.style.left) || tx;
        const startY =
          Number.isFinite(fromY) ? fromY : Number.parseFloat(el.style.top) || ty;
        el.style.display = "block";
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            i += 1;
            const t = i / steps;
            el.style.left = `${Math.round(startX + (tx - startX) * t)}px`;
            el.style.top = `${Math.round(startY + (ty - startY) * t)}px`;
            if (i >= steps) {
              resolve(true);
              return;
            }
            setTimeout(tick, stepMs);
          };
          tick();
        });
      },
      {
        tx,
        ty,
        steps,
        stepMs,
        fromX: opts.fromX,
        fromY: opts.fromY,
      }
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
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
  const steps = Math.max(1, Math.min(24, Number(opts.steps) || 12));
  const stepMs = Math.max(8, Math.min(80, Number(opts.stepMs) || 22));

  // Why: bare Xvfb sometimes has no cursor glyph until left_ptr is set again.
  await execFileAsync("xsetroot", ["-cursor_name", "left_ptr"], {
    timeout: 2000,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
  }).catch(() => null);

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
  // Hold on target so Take control viewers can see the pointer before the click.
  await new Promise((r) => setTimeout(r, 80));
  return { ok: true, screenX: tx, screenY: ty };
}

/**
 * Moves the visible OS cursor + page ✕ overlay to a viewport point, then Playwright-clicks.
 * @param {import('playwright').Page} page
 * @param {number} x - viewport CSS x
 * @param {number} y - viewport CSS y
 * @param {{ delayMs?: number, steps?: number }} [opts]
 * @returns {Promise<{ ok: boolean, x: number, y: number, screenX?: number, screenY?: number, cursorMoved: boolean, overlayMoved?: boolean }>}
 */
export async function clickWithVisibleCursor(page, x, y, opts = {}) {
  const vx = Number(x);
  const vy = Number(y);
  const mapped = await viewportToScreen(page, vx, vy);
  const overlay = await glidePageOverlay(page, vx, vy, { steps: opts.steps });
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
    cursorMoved: moved.ok || overlay.ok,
    overlayMoved: overlay.ok,
  };
}

/**
 * Glide visible cursors to a viewport point without clicking (e.g. before MCP actions).
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 * @param {{ steps?: number }} [opts]
 */
export async function showCursorAtViewport(page, x, y, opts = {}) {
  const vx = Number(x);
  const vy = Number(y);
  const overlay = await glidePageOverlay(page, vx, vy, { steps: opts.steps });
  const mapped = await viewportToScreen(page, vx, vy);
  const moved = await moveXCursorVisible(mapped.screenX, mapped.screenY, {
    steps: opts.steps,
  });
  return {
    ok: moved.ok || overlay.ok,
    x: vx,
    y: vy,
    screenX: moved.screenX,
    screenY: moved.screenY,
    cursorMoved: moved.ok || overlay.ok,
    overlayMoved: overlay.ok,
  };
}
