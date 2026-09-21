/**
 * @fileoverview Hermes-parity input actions via cua-driver MCP (click / type / key / scroll).
 * Purpose: Element-index actions against the sticky Chrome window; coordinate clicks stay on
 * Playwright viewport space (matching the attached screenshot) so hits land correctly.
 * Downstream: agent.js computer_use execute path; pairs with xCursor for visible demo glide.
 */

import {
  moveXCursorVisible,
  viewportToScreen,
  atspiFrameCenterToViewport,
} from "./xCursor.js";

/**
 * @param {import('./cuaMcpSession.js').CuaMcpSession} session
 * @param {ReturnType<import('./cuaCapture.js').createCuaCapture>} capture
 */
export function createCuaActions(session, capture) {
  /**
   * @param {object} sticky
   * @param {object} extra
   */
  function targetArgs(sticky, extra = {}) {
    return {
      pid: sticky.pid,
      window_id: sticky.windowId,
      ...extra,
    };
  }

  /**
   * Glide OS cursor after a CUA action.
   * AT-SPI frames are desktop/screen pixels — do NOT run them through viewportToScreen.
   * Explicit x/y from the model are Playwright viewport CSS.
   * @param {import('playwright').Page|null} page
   * @param {number|null} element
   * @param {number|null} x
   * @param {number|null} y
   * @param {"viewport"|"screen"} [xySpace]
   */
  async function maybeShowCursor(page, element, x, y, xySpace = "viewport") {
    try {
      if (element != null) {
        const el = capture.getElement(element);
        const f = el?.frame;
        if (f && f.x != null && f.y != null) {
          const sx = Number(f.x) + Number(f.w || 0) / 2;
          const sy = Number(f.y) + Number(f.h || 0) / 2;
          if (Number.isFinite(sx) && Number.isFinite(sy)) {
            const moved = await moveXCursorVisible(sx, sy);
            return {
              cursorMoved: moved.ok,
              screenX: moved.screenX,
              screenY: moved.screenY,
              x: sx,
              y: sy,
            };
          }
        }
      }
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { cursorMoved: false };
      }
      if (xySpace === "screen") {
        const moved = await moveXCursorVisible(x, y);
        return { cursorMoved: moved.ok, screenX: moved.screenX, screenY: moved.screenY, x, y };
      }
      if (page && !page.isClosed()) {
        const mapped = await viewportToScreen(page, x, y);
        const moved = await moveXCursorVisible(mapped.screenX, mapped.screenY);
        return {
          cursorMoved: moved.ok,
          screenX: moved.screenX,
          screenY: moved.screenY,
          x,
          y,
        };
      }
      const moved = await moveXCursorVisible(x, y);
      return { cursorMoved: moved.ok, screenX: moved.screenX, screenY: moved.screenY, x, y };
    } catch {
      return { cursorMoved: false };
    }
  }

  return {
    /**
     * Prefer element_index via MCP. Raw x/y are viewport CSS — caller should use Playwright.
     * @param {{
     *   element?: number,
     *   x?: number,
     *   y?: number,
     *   button?: string,
     *   page?: import('playwright').Page|null,
     * }} opts
     */
    async click(opts = {}) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const element = opts.element != null ? Number(opts.element) : null;
      const x = opts.x != null ? Number(opts.x) : null;
      const y = opts.y != null ? Number(opts.y) : null;
      if (element == null && (x == null || y == null)) {
        return { ok: false, error: "computer_use click requires element or x/y" };
      }

      // Why: model x/y match the Playwright viewport screenshot — MCP window coords miss.
      if (element == null) {
        return {
          ok: false,
          error: "use_playwright_viewport",
          action: "click",
          x,
          y,
          computerUse: true,
        };
      }

      const args = targetArgs(sticky, {
        button: String(opts.button || "left").toLowerCase(),
        element_index: element,
      });
      const res = await session.callTool("click", args, 20000);
      const cursor = res.ok
        ? await maybeShowCursor(opts.page || null, element, null, null)
        : { cursorMoved: false };
      return {
        ok: res.ok,
        action: "click",
        element,
        x,
        y,
        error: res.ok ? undefined : res.error || "click failed",
        via: res.via,
        computerUse: true,
        ...cursor,
      };
    },

    /**
     * Convert AT-SPI element frame → viewport CSS for Playwright fallback.
     * @param {import('playwright').Page} page
     * @param {number} elementIndex
     */
    async elementCenterViewport(page, elementIndex) {
      const el = capture.getElement(elementIndex);
      return atspiFrameCenterToViewport(page, el?.frame || null);
    },

    /**
     * @param {{ text: string, page?: import('playwright').Page|null }} opts
     */
    async typeText(opts) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const text = String(opts.text ?? "");
      const res = await session.callTool(
        "type_text",
        targetArgs(sticky, { text }),
        30000
      );
      return {
        ok: res.ok,
        action: "type",
        textLength: text.length,
        error: res.ok ? undefined : res.error || "type_text failed",
        via: res.via,
        computerUse: true,
      };
    },

    /**
     * @param {{ keys: string }} opts
     */
    async key(opts) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const keys = String(opts.keys || "").trim();
      if (!keys) return { ok: false, error: "computer_use key requires keys" };
      let res = await session.callTool("keypress", targetArgs(sticky, { keys }), 15000);
      if (!res.ok) {
        res = await session.callTool("press_key", targetArgs(sticky, { key: keys }), 15000);
      }
      if (!res.ok) {
        res = await session.callTool("key", targetArgs(sticky, { keys }), 15000);
      }
      return {
        ok: res.ok,
        action: "key",
        keys,
        error: res.ok ? undefined : res.error || "key failed",
        via: res.via,
        computerUse: true,
      };
    },

    /**
     * @param {{ direction?: string, amount?: number, element?: number, x?: number, y?: number }} opts
     */
    async scroll(opts = {}) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const args = targetArgs(sticky, {
        direction: String(opts.direction || "down"),
        amount: Math.max(1, Math.min(50, Number(opts.amount) || 3)),
        ...(opts.element != null ? { element_index: Number(opts.element) } : {}),
        ...(opts.x != null && opts.y != null ? { x: Number(opts.x), y: Number(opts.y) } : {}),
      });
      const res = await session.callTool("scroll", args, 15000);
      return {
        ok: res.ok,
        action: "scroll",
        error: res.ok ? undefined : res.error || "scroll failed",
        via: res.via,
        computerUse: true,
      };
    },
  };
}
