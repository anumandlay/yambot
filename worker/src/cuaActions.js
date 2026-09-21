/**
 * @fileoverview Hermes-parity input actions via cua-driver MCP (click / type / key / scroll).
 * Purpose: Element-index and coordinate actions against the sticky Chrome window.
 * Downstream: agent.js computer_use execute path; pairs with xCursor for visible demo glide.
 */

import { moveXCursorVisible, viewportToScreen } from "./xCursor.js";

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
   * Glide OS cursor for live demos after a successful CUA click.
   * @param {import('playwright').Page|null} page
   * @param {number|null} element
   * @param {number|null} x
   * @param {number|null} y
   */
  async function maybeShowCursor(page, element, x, y) {
    try {
      let vx = x;
      let vy = y;
      if ((vx == null || vy == null) && element != null) {
        const el = capture.getElement(element);
        const f = el?.frame;
        if (f && f.x != null && f.y != null) {
          vx = Number(f.x) + Number(f.w || 0) / 2;
          vy = Number(f.y) + Number(f.h || 0) / 2;
        }
      }
      if (vx == null || vy == null || !Number.isFinite(vx) || !Number.isFinite(vy)) {
        return { cursorMoved: false };
      }
      if (page && !page.isClosed()) {
        const mapped = await viewportToScreen(page, vx, vy);
        const moved = await moveXCursorVisible(mapped.screenX, mapped.screenY);
        return {
          cursorMoved: moved.ok,
          screenX: moved.screenX,
          screenY: moved.screenY,
          x: vx,
          y: vy,
        };
      }
      const moved = await moveXCursorVisible(vx, vy);
      return { cursorMoved: moved.ok, screenX: moved.screenX, screenY: moved.screenY, x: vx, y: vy };
    } catch {
      return { cursorMoved: false };
    }
  }

  return {
    /**
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
      const args = targetArgs(sticky, {
        button: String(opts.button || "left").toLowerCase(),
        ...(element != null ? { element_index: element } : { x, y }),
      });
      const res = await session.callTool("click", args, 20000);
      const cursor = res.ok
        ? await maybeShowCursor(opts.page || null, element, x, y)
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
      // cua-driver `key` / `press_key` naming — try keypress then press_key.
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
