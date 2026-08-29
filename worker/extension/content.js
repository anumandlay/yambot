/**
 * @fileoverview Content script — records click/type/select/key while Teach skill is on.
 * Purpose: Capture stable element descriptors (role, name, id, css, xpath), not screenshot %.
 * Control: window.__yambotTeachRecorder or window.postMessage from the Playwright worker.
 */
(function yambotTeachRecorder() {
  if (window.__yambotTeachRecorderInstalled) return;
  window.__yambotTeachRecorderInstalled = true;

  /** @type {object[]} */
  let steps = [];
  let recording = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let typeTimer = null;
  /** @type {{ el: Element, step: object }|null} */
  let pendingType = null;

  /**
   * @param {Element|null|undefined} el
   * @returns {string}
   */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
      if (node && node.tagName === "BODY") {
        parts.unshift("body");
        break;
      }
    }
    return parts.join(" > ");
  }

  /**
   * @param {Element|null|undefined} el
   * @returns {string}
   */
  function xpathOf(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return `//*[@id=${JSON.stringify(el.id)}]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      let ix = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) ix += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${ix}]`);
      node = node.parentElement;
      if (node && node.tagName === "BODY") {
        parts.unshift("body");
        break;
      }
    }
    return "/" + parts.join("/");
  }

  /**
   * @param {Element|null|undefined} el
   * @returns {object}
   */
  function describe(el) {
    if (!el || el.nodeType !== 1) {
      return { tag: "", id: "", name: "", role: "", text: "", css: "", xpath: "" };
    }
    const text = String(
      el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? ""
          : el.innerText || el.textContent || "") ||
        el.getAttribute("value") ||
        ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const role =
      el.getAttribute("role") ||
      (el instanceof HTMLInputElement ? el.type || "textbox" : "") ||
      el.tagName.toLowerCase();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      name: el.getAttribute("name") || text || "",
      role: String(role),
      ariaLabel: el.getAttribute("aria-label") || "",
      placeholder: el.getAttribute("placeholder") || "",
      typeAttr: el.getAttribute("type") || "",
      text,
      css: cssPath(el),
      xpath: xpathOf(el),
      href: el instanceof HTMLAnchorElement ? String(el.href || "").slice(0, 300) : "",
    };
  }

  /**
   * @param {Element|null|undefined} el
   * @returns {Element|null}
   */
  function actionable(el) {
    if (!el || el.nodeType !== 1) return null;
    const hit = el.closest(
      "a,button,input,select,textarea,summary,label,[role='button'],[role='link'],[role='option'],[role='menuitem'],[role='tab'],[contenteditable='true'],[onclick]"
    );
    return hit || el;
  }

  function flushPendingType() {
    if (!pendingType) return;
    steps.push(pendingType.step);
    pendingType = null;
    if (typeTimer) {
      clearTimeout(typeTimer);
      typeTimer = null;
    }
  }

  /**
   * @param {object} step
   */
  function pushStep(step) {
    if (!recording) return;
    flushPendingType();
    steps.push({
      ...step,
      url: String(location.href || ""),
      at: Date.now(),
      source: "extension",
    });
  }

  window.__yambotTeachRecorder = {
    start() {
      recording = true;
      steps = [];
      pendingType = null;
      return { ok: true, recording: true };
    },
    stop() {
      flushPendingType();
      recording = false;
      return { ok: true, recording: false, pending: steps.length };
    },
    /**
     * @returns {object[]}
     */
    drain() {
      flushPendingType();
      const out = steps.slice();
      steps = [];
      return out;
    },
    isRecording() {
      return recording;
    },
    peekCount() {
      return steps.length + (pendingType ? 1 : 0);
    },
  };

  window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || data.source !== "yambot-worker") return;
    if (data.type === "TEACH_START") window.__yambotTeachRecorder.start();
    if (data.type === "TEACH_STOP") window.__yambotTeachRecorder.stop();
  });

  document.addEventListener(
    "click",
    (ev) => {
      if (!recording) return;
      const el = actionable(/** @type {Element} */ (ev.target));
      const d = describe(el);
      pushStep({
        type: "click",
        ...d,
      });
    },
    true
  );

  document.addEventListener(
    "change",
    (ev) => {
      if (!recording) return;
      const el = /** @type {HTMLElement|null} */ (ev.target);
      if (!el) return;
      const d = describe(el);
      if (el.tagName === "SELECT") {
        pushStep({
          type: "select",
          value: /** @type {HTMLSelectElement} */ (el).value,
          ...d,
        });
        return;
      }
      if ("value" in el) {
        pushStep({
          type: "type",
          text: String(/** @type {HTMLInputElement} */ (el).value ?? ""),
          ...d,
        });
      }
    },
    true
  );

  document.addEventListener(
    "input",
    (ev) => {
      if (!recording) return;
      const el = /** @type {HTMLElement|null} */ (ev.target);
      if (!el || !("value" in el)) return;
      const d = describe(el);
      const step = {
        type: "type",
        text: String(/** @type {HTMLInputElement} */ (el).value ?? ""),
        ...d,
        url: String(location.href || ""),
        at: Date.now(),
        source: "extension",
      };
      if (pendingType && pendingType.el === el) {
        pendingType.step = step;
      } else {
        flushPendingType();
        pendingType = { el, step };
      }
      if (typeTimer) clearTimeout(typeTimer);
      typeTimer = setTimeout(() => flushPendingType(), 450);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (ev) => {
      if (!recording) return;
      const special = ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
      if (!special.includes(ev.key)) return;
      const el = actionable(/** @type {Element} */ (ev.target));
      pushStep({
        type: "key",
        key: ev.key,
        ...describe(el),
      });
    },
    true
  );
})();
