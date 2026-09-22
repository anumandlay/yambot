/**
 * @fileoverview Hermes-style capture via Python cua-driver MCP sidecar.
 * Purpose: Sticky Chrome target + numbered elements for CUA turns — no Playwright.
 * Downstream: computerUse.js when CUA is active.
 */

/**
 * @param {ReturnType<import('./cuaHermesBridge.js').createCuaHermesBridge>} bridge
 */
export function createHermesCuaCapture(bridge) {
  /** @type {{ pid: number, windowId: number, title: string, appName: string }|null} */
  let sticky = null;
  /** @type {Map<number, object>} */
  let lastElements = new Map();

  return {
    getSticky() {
      return sticky;
    },
    getElement(index) {
      return lastElements.get(Number(index)) || null;
    },
    getElements() {
      return [...lastElements.values()];
    },

    /**
     * @returns {Promise<{ ok: boolean, sticky?: object, error?: string }>}
     */
    async resolveTarget() {
      const out = await bridge.call("resolve_target", {}, 25000);
      if (!out?.ok) return { ok: false, error: out?.error || "resolve_target failed" };
      sticky = {
        pid: Number(out.pid),
        windowId: Number(out.window_id ?? out.windowId),
        title: String(out.title || ""),
        appName: String(out.app_name || out.appName || ""),
      };
      return { ok: true, sticky };
    },

    /**
     * @param {{ mode?: string }} [opts]
     */
    async capture(opts = {}) {
      const out = await bridge.call("capture", { mode: opts.mode || "som" }, 40000);
      if (!out?.ok) return { ok: false, error: out?.error || "capture failed", via: "hermes_python" };
      sticky = {
        pid: Number(out.pid),
        windowId: Number(out.windowId ?? out.window_id),
        title: String(out.title || ""),
        appName: String(out.appName || out.app_name || ""),
      };
      lastElements = new Map();
      for (const el of out.elements || []) {
        const idx = Number(el.element_index ?? el.index);
        if (!Number.isFinite(idx)) continue;
        lastElements.set(idx, el);
      }
      return {
        ok: true,
        pid: sticky.pid,
        windowId: sticky.windowId,
        title: sticky.title,
        appName: sticky.appName,
        elements: [...lastElements.values()],
        treeMarkdown: out.treeMarkdown || "",
        screenshotB64: out.screenshotB64 || null,
        snapshot_id: out.snapshot_id,
        via: "hermes_python",
      };
    },

    /**
     * @param {object} cap
     * @returns {string}
     */
    formatForPrompt(cap) {
      if (!cap?.ok) return `CUA CAPTURE FAILED: ${cap?.error || "unknown"}`;
      const lines = [
        "CUA CAPTURE (Hermes / cua-driver — click by element index via computer_use):",
        `Window: ${cap.title || "(untitled)"} · ${cap.appName || ""} · pid=${cap.pid} win=${cap.windowId}`,
      ];
      const els = Array.isArray(cap.elements) ? cap.elements : [];
      const ranked = [...els].sort((a, b) => {
        const score = (e) => {
          const role = String(e.role || "").toLowerCase();
          if (/button|link|textbox|entry|checkbox|menuitem|tab/.test(role)) return 2;
          if (e.label) return 1;
          return 0;
        };
        return score(b) - score(a);
      });
      const show = ranked.slice(0, 80);
      for (const el of show) {
        const idx = el.element_index ?? el.index;
        const label = String(el.label || "").slice(0, 80);
        const role = String(el.role || "");
        lines.push(`  [${idx}] ${role}${label ? ` “${label}”` : ""}`);
      }
      if (els.length > show.length) {
        lines.push(`  … ${els.length - show.length} more elements`);
      }
      lines.push(
        "Use: {\"type\":\"computer_use\",\"action\":\"click\",\"element\":N} — driver hits AT-SPI directly (Hermes path)."
      );
      return lines.join("\n");
    },
  };
}
