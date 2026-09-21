/**
 * @fileoverview Visible cursor for CUA mode on the live noVNC screen.
 * Purpose: Playwright CDP clicks do not move the OS cursor; xdotool does. Chrome often hides
 * the X pointer over web content, so we paint a CUA-style gradient arrow overlay in the page
 * that noVNC always shows. (cua-driver’s native compositor overlay is often unavailable on
 * headless Xvfb containers — Hermes even auto-disables it there.)
 *
 * Why not innerHTML SVG: many sites enable Trusted Types / CSP which throw on innerHTML and
 * silently killed the previous ✕/SVG overlay — Zoom looked cursor-less.
 *
 * Coordinate spaces must not be mixed:
 * - viewport CSS: Playwright page.mouse + attached vision screenshot (origin = content top-left)
 * - screen/desktop: AT-SPI frames + xdotool (origin = X root)
 * Downstream: agent.js click / click_at / type / type_at / computer_use when CUA is active.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Overlay size in CSS px — large enough to spot on Zoom / Live Wall. */
const ARROW_SIZE = 56;

/**
 * Compact CUA-like arrow (no SVG filters — those break under some CSPs).
 * Tip is at (2,2) in the viewBox; positioned at the click hotspot.
 */
const CUA_ARROW_SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ARROW_SIZE}" height="${ARROW_SIZE}" viewBox="0 0 48 48">`,
  `<defs><linearGradient id="g" x1="4" y1="2" x2="36" y2="40" gradientUnits="userSpaceOnUse">`,
  `<stop stop-color="#8B5CFF"/><stop offset=".5" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3A6"/>`,
  `</linearGradient></defs>`,
  `<path d="M3 2 L3 38 L13.5 28.5 L22 44 L28 41 L19.5 25.5 L33 25.5 Z"`,
  ` fill="url(#g)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>`,
  `</svg>`,
].join("");

const CUA_ARROW_DATA_URI = `data:image/svg+xml,${encodeURIComponent(CUA_ARROW_SVG)}`;

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
 * Ensures the arrow overlay node exists (CSP-safe: no innerHTML).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function ensureArrowOverlay(page) {
  try {
    return await page.evaluate(
      ({ id, uri, size }) => {
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          el.setAttribute("aria-hidden", "true");
          el.setAttribute("data-yambot-cua-cursor", "1");
          document.documentElement.appendChild(el);
        }
        el.style.position = "fixed";
        el.style.zIndex = "2147483647";
        el.style.pointerEvents = "none";
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.margin = "0";
        el.style.padding = "0";
        el.style.border = "0";
        el.style.display = "block";
        el.style.opacity = "1";
        el.style.backgroundImage = `url("${uri}")`;
        el.style.backgroundRepeat = "no-repeat";
        el.style.backgroundSize = "contain";
        el.style.backgroundPosition = "0 0";
        el.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,.55))";
        el.style.transition = "none";
        return true;
      },
      { id: "__yambot_cua_cursor", uri: CUA_ARROW_DATA_URI, size: ARROW_SIZE }
    );
  } catch {
    return false;
  }
}

/**
 * Places the arrow tip at a viewport point (no animation).
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 */
async function placeArrowOverlay(page, x, y) {
  try {
    await page.evaluate(
      ({ id, x, y }) => {
        const el = document.getElementById(id);
        if (!el) return false;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(y)}px`;
        el.style.display = "block";
        el.style.opacity = "1";
        return true;
      },
      { id: "__yambot_cua_cursor", x, y }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Glides a CUA-style arrow overlay (Node-driven steps — reliable + visible on noVNC).
 * Hotspot is the arrow tip (top-left).
 * @param {import('playwright').Page} page
 * @param {number} x
 * @param {number} y
 * @param {{ fromX?: number, fromY?: number, steps?: number, stepMs?: number }} [opts]
 */
async function glidePageOverlay(page, x, y, opts = {}) {
  if (!page || page.isClosed()) return { ok: false, error: "page_closed" };
  const tx = Math.round(Number(x) || 0);
  const ty = Math.round(Number(y) || 0);
  const steps = Math.max(3, Math.min(16, Number(opts.steps) || 8));
  const stepMs = Math.max(12, Math.min(40, Number(opts.stepMs) || 16));

  const ready = await ensureArrowOverlay(page);
  if (!ready) return { ok: false, error: "overlay_inject_failed" };

  let fromX = Number(opts.fromX);
  let fromY = Number(opts.fromY);
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) {
    try {
      const cur = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el || el.style.display === "none") return null;
        return {
          x: Number.parseFloat(el.style.left),
          y: Number.parseFloat(el.style.top),
        };
      }, "__yambot_cua_cursor");
      fromX = Number.isFinite(cur?.x) ? cur.x : Math.max(0, tx - 120);
      fromY = Number.isFinite(cur?.y) ? cur.y : Math.max(0, ty - 80);
    } catch {
      fromX = Math.max(0, tx - 120);
      fromY = Math.max(0, ty - 80);
    }
  }

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    // Ease-out so the tip settles visibly on the target.
    const e = 1 - (1 - t) * (1 - t);
    const ix = Math.round(fromX + (tx - fromX) * e);
    const iy = Math.round(fromY + (ty - fromY) * e);
    const placed = await placeArrowOverlay(page, ix, iy);
    if (!placed) return { ok: false, error: "overlay_place_failed" };
    if (i < steps) await new Promise((r) => setTimeout(r, stepMs));
  }
  // Hold so Zoom / Take control viewers can see the arrow on target (keep short — long holds stall goals).
  await new Promise((r) => setTimeout(r, 70));
  return { ok: true };
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
  const steps = Math.max(1, Math.min(24, Number(opts.steps) || 14));
  const stepMs = Math.max(8, Math.min(80, Number(opts.stepMs) || 22));

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
  await new Promise((r) => setTimeout(r, 60));
  return { ok: true, screenX: tx, screenY: ty };
}

/**
 * Moves the visible OS cursor + CUA-style arrow overlay to a viewport point, then Playwright-clicks.
 * @param {import('playwright').Page} page
 * @param {number} x - viewport CSS x
 * @param {number} y - viewport CSS y
 * @param {{ delayMs?: number, steps?: number }} [opts]
 * @returns {Promise<{ ok: boolean, x: number, y: number, screenX?: number, screenY?: number, cursorMoved: boolean, overlayMoved?: boolean, overlayError?: string }>}
 */
export async function clickWithVisibleCursor(page, x, y, opts = {}) {
  const vx = Number(x);
  const vy = Number(y);
  const mapped = await viewportToScreen(page, vx, vy);
  // Run page arrow + OS pointer together so Zoom shows motion immediately.
  const [overlay, moved] = await Promise.all([
    glidePageOverlay(page, vx, vy, { steps: opts.steps }),
    moveXCursorVisible(mapped.screenX, mapped.screenY, { steps: opts.steps }),
  ]);
  // Brief settle after both motions land.
  await new Promise((r) => setTimeout(r, 40));
  const delayMs = Math.max(0, Number(opts.delayMs) ?? 40);
  await page.mouse.click(vx, vy, { delay: delayMs });
  // Keep arrow visible briefly after the click.
  await placeArrowOverlay(page, vx, vy).catch(() => false);
  await new Promise((r) => setTimeout(r, 60));
  return {
    ok: true,
    x: vx,
    y: vy,
    screenX: moved.screenX,
    screenY: moved.screenY,
    cursorMoved: moved.ok || overlay.ok,
    overlayMoved: overlay.ok,
    overlayError: overlay.ok ? undefined : overlay.error,
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
  const mapped = await viewportToScreen(page, vx, vy);
  const [overlay, moved] = await Promise.all([
    glidePageOverlay(page, vx, vy, { steps: opts.steps }),
    moveXCursorVisible(mapped.screenX, mapped.screenY, { steps: opts.steps }),
  ]);
  await new Promise((r) => setTimeout(r, 120));
  return {
    ok: moved.ok || overlay.ok,
    x: vx,
    y: vy,
    screenX: moved.screenX,
    screenY: moved.screenY,
    cursorMoved: moved.ok || overlay.ok,
    overlayMoved: overlay.ok,
    overlayError: overlay.ok ? undefined : overlay.error,
  };
}
