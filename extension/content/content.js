/**
 * Content script: observe page + execute agent actions.
 * Injected on all URLs; talks to the service worker via chrome.runtime.
 * Locators: ref → role+name → label/name → css → xpath (mirrors worker pageDom).
 * Why overlay-aware: custom dropdowns/calendars need option/day cells in the snapshot.
 */

(() => {
  if (window.__browserAgentLoaded) return;
  window.__browserAgentLoaded = true;

  const REF_ATTR = "data-ba-ref";

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(s, max = 120) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return cleanText(aria);
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const t = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText)
        .filter(Boolean)
        .join(" ");
      if (t) return cleanText(t);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return cleanText(lab.innerText);
    }
    const wrapped = el.closest("label");
    if (wrapped && wrapped !== el) return cleanText(wrapped.innerText);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return cleanText(placeholder);
    const name = el.getAttribute("name");
    if (name) return cleanText(name);
    const title = el.getAttribute("title");
    if (title) return cleanText(title);
    return cleanText(el.innerText || el.value || el.alt || el.tagName);
  }

  function impliedRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset" || type === "image") {
        return "button";
      }
      return "textbox";
    }
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    if (el.closest('[role="listbox"], [role="menu"]')) return "option";
    if (el.closest('[role="grid"]') && /^\d{1,2}$/.test(labelFor(el))) return "gridcell";
    return undefined;
  }

  function cssHintFor(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const name = el.getAttribute("name");
    if (name) {
      const tag = el.tagName.toLowerCase();
      return `${tag}[name="${CSS.escape(name)}"]`;
    }
    return undefined;
  }

  function overlayRoot(el) {
    return el.closest(
      [
        '[role="listbox"]',
        '[role="menu"]',
        '[role="dialog"]',
        '[role="grid"]',
        '[aria-modal="true"]',
        "[data-radix-popper-content-wrapper]",
        "[data-headlessui-state]",
        '[data-state="open"]',
        ".flatpickr-calendar",
        "[class*='datepicker']",
        "[class*='DatePicker']",
        "[class*='calendar']",
        "[class*='popover']",
        "[class*='dropdown']",
      ].join(",")
    );
  }

  function collectOverlayOptions() {
    const roots = [
      ...document.querySelectorAll(
        [
          '[role="listbox"]',
          '[role="menu"]',
          "[data-radix-popper-content-wrapper]",
          '[data-state="open"]',
          "[class*='popover']",
          "[class*='dropdown']",
          "[class*='menu']",
        ].join(",")
      ),
    ].filter((el) => isVisible(el) && overlayRoot(el));

    const seen = new Set();
    const out = [];
    for (const root of roots) {
      const container = overlayRoot(root) || root;
      if (seen.has(container)) continue;
      seen.add(container);
      const candidates = [
        ...container.querySelectorAll(
          '[role="option"], [role="menuitem"], li, button, [data-value], [data-radix-collection-item]'
        ),
      ];
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = cleanText(el.innerText || el.getAttribute("data-value") || "", 80);
        if (!text || text.length > 80) continue;
        if (
          el.querySelector('[role="option"], [role="menuitem"], li button, li [role="option"]') &&
          el.tagName !== "LI"
        ) {
          continue;
        }
        out.push(el);
      }
    }
    return out;
  }

  function collectCalendarTargets() {
    const roots = [
      ...document.querySelectorAll(
        [
          '[role="grid"]',
          ".flatpickr-calendar",
          "[class*='datepicker']",
          "[class*='DatePicker']",
          "[class*='calendar']",
        ].join(",")
      ),
    ].filter(isVisible);

    const out = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll(
        '[role="gridcell"], button, [role="button"], td, div[data-day], span[data-day]'
      )) {
        if (!isVisible(el)) continue;
        const text = cleanText(el.innerText || el.getAttribute("aria-label") || "", 40);
        if (!text) continue;
        if (/^(today|tomorrow|in \d+ days?|in \d+ weeks?|\d{1,2})$/i.test(text)) {
          out.push(el);
        }
      }
    }
    return out;
  }

  function clearRefs() {
    document.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
  }

  function toItem(el, ref) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    return {
      ref,
      tag,
      type: type || undefined,
      role: impliedRole(el),
      name: labelFor(el),
      cssHint: cssHintFor(el),
      overlay: Boolean(overlayRoot(el)),
      href: tag === "a" ? el.href?.slice(0, 200) : undefined,
      value: "value" in el && el.value ? cleanText(el.value, 80) : undefined,
    };
  }

  function collectInteractives(limit = 120) {
    clearRefs();
    const ordered = [];
    const seen = new Set();

    function pushAll(list) {
      for (const el of list) {
        if (!el || seen.has(el)) continue;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type === "hidden") continue;
        if (!isVisible(el)) continue;
        seen.add(el);
        ordered.push(el);
      }
    }

    pushAll(collectOverlayOptions());
    pushAll(collectCalendarTargets());

    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='combobox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='option']",
      "[role='menuitem']",
      "[role='gridcell']",
      "[role='tab']",
      "[role='switch']",
      "[contenteditable='true']",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    pushAll([...document.querySelectorAll(selectors)]);

    const items = [];
    let i = 0;
    for (const el of ordered) {
      if (i >= limit) break;
      const ref = `e${i}`;
      el.setAttribute(REF_ATTR, ref);
      items.push(toItem(el, ref));
      i += 1;
    }
    return items;
  }

  function detectCaptcha() {
    const signals = [];
    if (document.querySelector(".g-recaptcha, iframe[src*='recaptcha'], #g-recaptcha-response")) {
      signals.push("recaptcha");
    }
    if (document.querySelector(".h-captcha, iframe[src*='hcaptcha']")) {
      signals.push("hcaptcha");
    }
    if (document.querySelector("iframe[src*='challenge'], iframe[src*='captcha']")) {
      signals.push("iframe_captcha");
    }
    if (
      document.querySelector(
        [
          "#auth-captcha-image",
          "#captchacharacters",
          'img[src*="captcha"]',
          'input[name="cvf_captcha_input"]',
          'form[action*="validateCaptcha"]',
          "#cvf-page-content",
          ".cvf-widget-form",
          'iframe[src*="opfcaptcha"]',
        ].join(",")
      )
    ) {
      signals.push("amazon_captcha");
    }
    if (/\/ap\/cvf|\/errors\/validateCaptcha/i.test(location.pathname + location.search)) {
      signals.push("amazon_url");
    }
    const bodyText = (document.body?.innerText || "").slice(0, 5000).toLowerCase();
    if (
      /verify you are human|i'?m not a robot|complete the captcha|security check|type the characters|enter the characters you see|solve this puzzle|unusual activity|robot check/.test(
        bodyText
      )
    ) {
      signals.push("text_hint");
    }
    return { present: signals.length > 0, signals: [...new Set(signals)] };
  }

  function pageText(max = 6000) {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    return cleanText(clone.innerText, max);
  }

  function observe() {
    return {
      url: location.href,
      title: document.title,
      interactives: collectInteractives(),
      captcha: detectCaptcha(),
      text: pageText(),
    };
  }

  function nameScore(el, wanted) {
    const w = cleanText(wanted, 200).toLowerCase();
    if (!w) return 0;
    const n = labelFor(el).toLowerCase();
    if (n === w) return 3;
    if (n.startsWith(w) || w.startsWith(n)) return 2;
    if (n.includes(w) || w.includes(n)) return 1;
    return 0;
  }

  function roleMatches(el, role) {
    if (!role) return true;
    const r = String(role).toLowerCase();
    const actual = (impliedRole(el) || "").toLowerCase();
    if (actual === r) return true;
    if (r === "button" && (actual === "button" || el.tagName === "BUTTON")) return true;
    if (r === "link" && (actual === "link" || el.tagName === "A")) return true;
    if (r === "option" && (actual === "option" || actual === "menuitem" || el.tagName === "LI")) {
      return true;
    }
    if (r === "gridcell" && (actual === "gridcell" || /^\d{1,2}$/.test(labelFor(el)))) return true;
    if (r === "textbox" && (actual === "textbox" || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      return true;
    }
    if (r === "combobox" && (actual === "combobox" || el.tagName === "SELECT")) return true;
    return false;
  }

  function candidatePool() {
    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role]",
      "[contenteditable='true']",
      "summary",
      "label",
      "li",
      "td",
      "[data-value]",
      "[data-day]",
      "[data-radix-collection-item]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    return [...document.querySelectorAll(selectors)].filter(isVisible);
  }

  function bestByName(wanted, role) {
    let best = null;
    let bestScore = 0;
    for (const el of candidatePool()) {
      if (role && !roleMatches(el, role)) continue;
      const score = nameScore(el, wanted);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function byXPath(xpath) {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < result.snapshotLength; i += 1) {
      const node = result.snapshotItem(i);
      if (node && node.nodeType === 1 && isVisible(node)) return node;
    }
    return null;
  }

  function resolveElement(action) {
    const tried = [];

    if (action.ref) {
      tried.push(`ref=${action.ref}`);
      const el = document.querySelector(`[${REF_ATTR}="${CSS.escape(String(action.ref))}"]`);
      if (el && isVisible(el)) return el;
    }

    const role = action.role ? String(action.role) : "";
    const name = action.name ? String(action.name) : "";
    if (role && name) {
      tried.push(`role=${role}+name=${name}`);
      const hit = bestByName(name, role);
      if (hit) return hit;
    }

    const label = action.label ? String(action.label) : name;
    if (label) {
      tried.push(`label=${label}`);
      const hit = bestByName(label, role || "");
      if (hit) return hit;
    }

    if (action.value && action.type === "select") {
      tried.push(`option=${action.value}`);
      const hit =
        bestByName(String(action.value), "option") || bestByName(String(action.value), "");
      if (hit) return hit;
    }

    if (action.css) {
      tried.push(`css=${action.css}`);
      try {
        const el = document.querySelector(String(action.css));
        if (el && isVisible(el)) return el;
      } catch {
        /* invalid selector */
      }
    }

    if (action.xpath) {
      tried.push(`xpath=${action.xpath}`);
      try {
        const el = byXPath(String(action.xpath));
        if (el) return el;
      } catch {
        /* invalid xpath */
      }
    }

    throw new Error(
      `Element not found (tried: ${tried.join(" → ") || "nothing"}). Re-observe and use a fresh ref or name/css/xpath.`
    );
  }

  function robustClick(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(Math.max(r.width / 2, 2), r.width - 2));
    const y = Math.round(r.top + Math.min(Math.max(r.height / 2, 2), r.height - 2));
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };
    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse" })
      );
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new MouseEvent("mousedown", common));
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse", buttons: 0 })
      );
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
    if (typeof el.click === "function") el.click();
    return { x, y };
  }

  function highlight(el) {
    const prev = el.style.outline;
    el.style.outline = "2px solid #0f766e";
    setTimeout(() => {
      el.style.outline = prev;
    }, 800);
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: String(value ?? ""),
          inputType: "insertText",
        })
      );
    } catch {
      /* ignore */
    }
  }

  async function execute(action) {
    switch (action.type) {
      case "click": {
        const el = resolveElement(action);
        highlight(el);
        robustClick(el);
        return { ok: true, name: labelFor(el) };
      }
      case "type": {
        const el = resolveElement(action);
        highlight(el);
        robustClick(el);
        el.focus();
        setNativeValue(el, action.text ?? "");
        if (action.submit) {
          const form = el.closest("form");
          if (form) form.requestSubmit?.() || form.submit();
          else
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
        }
        return { ok: true };
      }
      case "select": {
        try {
          const el = resolveElement({ ...action, name: action.name || action.label });
          if (el.tagName === "SELECT") {
            highlight(el);
            const wanted = String(action.value ?? "");
            const opt = [...el.options].find(
              (o) => o.value === wanted || o.text.trim() === wanted || o.text.includes(wanted)
            );
            if (!opt) throw new Error(`Option not found: ${wanted}`);
            el.value = opt.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: true, selected: opt.text, native: true };
          }
        } catch {
          /* custom */
        }
        const opt = resolveElement({
          type: "select",
          ref: action.ref,
          role: action.role || "option",
          name: action.value || action.name || action.label,
          label: action.label,
          css: action.css,
          xpath: action.xpath,
          value: action.value,
        });
        highlight(opt);
        robustClick(opt);
        return { ok: true, selected: labelFor(opt), custom: true };
      }
      case "press_key": {
        const key = action.key || "Enter";
        const target = document.activeElement || document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
        return { ok: true };
      }
      case "scroll": {
        const amount = Number(action.amount) || 600;
        const dir = action.direction === "up" ? -1 : 1;
        window.scrollBy({ top: dir * amount, behavior: "smooth" });
        return { ok: true };
      }
      case "extract": {
        return {
          ok: true,
          focus: action.focus || "main content",
          url: location.href,
          title: document.title,
          text: pageText(8000),
          links: [...document.querySelectorAll("a[href]")]
            .filter(isVisible)
            .slice(0, 30)
            .map((a) => ({ text: cleanText(a.innerText, 80), href: a.href })),
        };
      }
      case "solve_captcha": {
        return injectCaptchaSolution(action);
      }
      default:
        throw new Error(`Content script cannot run action: ${action.type}`);
    }
  }

  function findRecaptchaSitekey() {
    const el = document.querySelector(".g-recaptcha[data-sitekey], [data-sitekey]");
    if (el?.getAttribute("data-sitekey")) return el.getAttribute("data-sitekey");
    const iframe = document.querySelector("iframe[src*='recaptcha']");
    if (iframe?.src) {
      try {
        const u = new URL(iframe.src);
        return u.searchParams.get("k");
      } catch {
        return null;
      }
    }
    return null;
  }

  function findHcaptchaSitekey() {
    const el = document.querySelector(".h-captcha[data-sitekey], [data-sitekey]");
    return el?.getAttribute("data-sitekey") || null;
  }

  async function injectCaptchaSolution(action) {
    const token = action.token;
    const text = action.text;
    if (token) {
      const area =
        document.querySelector("#g-recaptcha-response") ||
        document.querySelector("[name='g-recaptcha-response']") ||
        document.querySelector("[name='h-captcha-response']") ||
        document.querySelector("textarea[name='h-captcha-response']");
      if (area) {
        area.style.display = "block";
        area.value = token;
        area.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return { ok: true, injected: "token", note: "Token injected; click continue/submit if needed." };
    }
    if (text) {
      const inputs = [...document.querySelectorAll("input[type='text'], input:not([type])")].filter(
        isVisible
      );
      const captchaInput =
        inputs.find((el) => /captcha|code|verify/i.test(labelFor(el) + (el.name || ""))) ||
        inputs[0];
      if (!captchaInput) throw new Error("No captcha text input found");
      setNativeValue(captchaInput, text);
      return { ok: true, injected: "text" };
    }
    return {
      ok: false,
      error: "No token/text provided",
      sitekey: findRecaptchaSitekey() || findHcaptchaSitekey(),
      pageurl: location.href,
      captcha: detectCaptcha(),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== "content") return;

    (async () => {
      if (msg.type === "OBSERVE") {
        return observe();
      }
      if (msg.type === "EXECUTE") {
        return execute(msg.action);
      }
      if (msg.type === "CAPTCHA_META") {
        return {
          captcha: detectCaptcha(),
          recaptchaSitekey: findRecaptchaSitekey(),
          hcaptchaSitekey: findHcaptchaSitekey(),
          pageurl: location.href,
        };
      }
      throw new Error(`Unknown content message: ${msg.type}`);
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

    return true;
  });
})();
