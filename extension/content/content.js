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

  function hasOpenMenus() {
    return [...document.querySelectorAll('[role="menu"]')].some(isVisible);
  }

  function isListRowNoise(el) {
    if (!hasOpenMenus()) return false;
    if (el.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="toolbar"]')) {
      return false;
    }
    if (el.closest("header, nav, [role='banner'], [role='navigation']")) return false;
    return Boolean(
      el.closest(
        [
          '[role="row"]',
          '[role="grid"]',
          '[role="rowgroup"]',
          "table tbody tr",
          "tr.zA",
          "[data-message-id]",
          "[data-legacy-message-id]",
        ].join(",")
      )
    );
  }

  function hasSubmenu(el) {
    const popup = (el.getAttribute("aria-haspopup") || "").toLowerCase();
    return popup === "menu" || popup === "true";
  }

  function collectOpenMenusMeta() {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(isVisible);
    return menus.map((menu, menuIndex) => ({
      menuIndex,
      items: [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')]
        .filter(isVisible)
        .map((el) => ({
          name: labelFor(el),
          hasSubmenu: hasSubmenu(el),
          checked: el.getAttribute("aria-checked") || undefined,
        })),
    }));
  }

  function collectOverlayOptions() {
    const seen = new Set();
    const out = [];

    function pushItem(el) {
      if (!el || seen.has(el)) return;
      if (!isVisible(el)) return;
      const name = cleanText(
        el.getAttribute("aria-label") || el.innerText || el.getAttribute("data-value") || "",
        120
      );
      if (!name) return;
      seen.add(el);
      out.push(el);
    }

    for (const menu of [...document.querySelectorAll('[role="menu"]')].filter(isVisible)) {
      for (const el of menu.querySelectorAll(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]'
      )) {
        pushItem(el);
      }
    }

    const roots = [
      ...document.querySelectorAll(
        [
          '[role="listbox"]',
          "[data-radix-popper-content-wrapper]",
          '[data-state="open"]',
          "[class*='popover']",
          "[class*='dropdown']",
        ].join(",")
      ),
    ].filter((el) => isVisible(el) && overlayRoot(el));

    for (const root of roots) {
      const container = overlayRoot(root) || root;
      if (container.getAttribute("role") === "menu") continue;
      const candidates = [
        ...container.querySelectorAll(
          '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], li, button, [data-value], [data-radix-collection-item]'
        ),
      ];
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = cleanText(el.innerText || el.getAttribute("data-value") || "", 120);
        if (!text) continue;
        if (
          el.querySelector(
            '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], li button, li [role="option"]'
          ) &&
          el.tagName !== "LI" &&
          !hasSubmenu(el)
        ) {
          continue;
        }
        pushItem(el);
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
      overlay: Boolean(overlayRoot(el) || el.closest('[role="menu"]')),
      hasSubmenu: hasSubmenu(el) || undefined,
      href: tag === "a" ? el.href?.slice(0, 200) : undefined,
      value: "value" in el && el.value ? cleanText(el.value, 80) : undefined,
    };
  }

  /**
   * Whether an element looks like cart / checkout / line-item remove.
   * Why: retail homes bury Cart under product links — same on Amazon, Shopify, Walmart, etc.
   * @param {Element} el
   * @returns {boolean}
   */
  function isShopPriority(el) {
    const href = String(el.href || el.getAttribute("href") || "").toLowerCase();
    const blob = [
      el.id,
      el.getAttribute("aria-label"),
      el.getAttribute("name"),
      el.getAttribute("title"),
      el.getAttribute("data-testid"),
      el.getAttribute("data-action"),
      el.getAttribute("data-automation-id"),
      typeof el.className === "string" ? el.className : "",
      href,
      el.innerText,
    ]
      .join(" ")
      .toLowerCase();
    return (
      /\b(cart|basket|bag|trolley|checkout|panier|warenkorb|carrito|carrinho|delete|remove|save for later|move to wishlist)\b/.test(
        blob
      ) ||
      /nav-cart|mini[-_]?cart|cart[-_]?icon|cart[-_]?link|shopping[-_]?cart|view[-_]?cart|cart-drawer|cartDrawer|\/gp\/cart|\/cart\b|\/basket\b|\/bag\b|cart\.html|basket\.html|checkout\/cart|order\/basket|wl\/cart/.test(
        blob
      )
    );
  }

  /**
   * Header / primary nav chrome (sitewide Cart usually lives here).
   * @param {Element} el
   * @returns {boolean}
   */
  function inPageChrome(el) {
    return Boolean(
      el.closest(
        [
          "header",
          "nav",
          '[role="banner"]',
          '[role="navigation"]',
          "#navbar",
          "#nav-belt",
          "#nav-main",
          "#nav-flyout-anchor",
          "#desktop-header",
          "#gh",
          "#site-header",
          "#shopify-section-header",
          ".header",
          ".site-header",
          "[data-nav-role='signin']",
        ].join(",")
      )
    );
  }

  /**
   * Collect all visible interactive controls (no hard cap).
   * Why: shopping pages bury Cart/Delete among product links — prioritize shop + chrome first.
   */
  function collectInteractives() {
    clearRefs();
    const seen = new Set();
    const overlays = [];
    const shop = [];
    const chrome = [];
    const body = [];

    function accept(el, bucket) {
      if (!el || seen.has(el)) return;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "hidden") return;
      if (!isVisible(el)) return;
      seen.add(el);
      bucket.push(el);
    }

    for (const el of collectOverlayOptions()) accept(el, overlays);
    for (const el of collectCalendarTargets()) accept(el, overlays);

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
      "[role='menuitemcheckbox']",
      "[role='menuitemradio']",
      "[role='gridcell']",
      "[role='tab']",
      "[role='switch']",
      "[contenteditable='true']",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    for (const el of document.querySelectorAll(selectors)) {
      if (!el || seen.has(el)) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "hidden") continue;
      if (!isVisible(el)) continue;
      if (isListRowNoise(el)) continue;
      if (isShopPriority(el)) accept(el, shop);
      else if (inPageChrome(el)) accept(el, chrome);
      else accept(el, body);
    }

    const ordered = [...overlays, ...shop, ...chrome, ...body];
    const items = [];
    let i = 0;
    for (const el of ordered) {
      const ref = `e${i}`;
      el.setAttribute(REF_ATTR, ref);
      items.push(toItem(el, ref));
      i += 1;
    }
    return items;
  }

  function detectCaptcha() {
    const signals = [];
    if (
      document.querySelector(
        ".g-recaptcha, .captcha-recaptcha, iframe[src*='recaptcha'], iframe[src*='google.com/recaptcha'], #g-recaptcha-response, [data-sitekey]"
      )
    ) {
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
      openMenus: collectOpenMenusMeta(),
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
    for (const iframe of document.querySelectorAll(
      "iframe[src*='recaptcha'], iframe[src*='google.com/recaptcha'], iframe[title*='reCAPTCHA']"
    )) {
      if (!iframe?.src) continue;
      try {
        const k = new URL(iframe.src).searchParams.get("k");
        if (k) return k;
      } catch {
        /* ignore */
      }
    }
    try {
      const clients = window.___grecaptcha_cfg?.clients;
      if (clients) {
        const json = JSON.stringify(clients);
        const m = json.match(/sitekey["']?\s*:\s*["']([^"']+)["']/i);
        if (m?.[1]) return m[1];
        const m2 = json.match(/["'](6L[0-9A-Za-z_-]{20,})["']/);
        if (m2?.[1]) return m2[1];
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function findHcaptchaSitekey() {
    const h = document.querySelector(".h-captcha[data-sitekey]");
    if (h?.getAttribute("data-sitekey")) return h.getAttribute("data-sitekey");
    const el = document.querySelector("[data-sitekey]");
    const key = el?.getAttribute("data-sitekey");
    if (key && !String(key).startsWith("6L")) return key;
    return null;
  }

  async function injectCaptchaSolution(action) {
    const token = action.token;
    const text = action.text;
    if (token) {
      const areas = [
        ...document.querySelectorAll(
          "#g-recaptcha-response, textarea[name='g-recaptcha-response'], [name='g-recaptcha-response'], [name='h-captcha-response'], textarea[name='h-captcha-response']"
        ),
      ];
      for (const area of areas) {
        area.style.display = "block";
        const proto =
          area.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(area, token);
        else area.value = token;
        area.dispatchEvent(new Event("input", { bubbles: true }));
        area.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const widgets = document.querySelectorAll(
        ".g-recaptcha[data-callback], [data-sitekey][data-callback], .h-captcha[data-callback]"
      );
      for (const w of widgets) {
        const cbName = w.getAttribute("data-callback");
        if (cbName && typeof window[cbName] === "function") {
          try {
            window[cbName](token);
          } catch {
            /* ignore */
          }
        }
      }
      try {
        const clients = window.___grecaptcha_cfg?.clients;
        if (clients) {
          const seen = new Set();
          const visit = (node, depth) => {
            if (!node || depth > 5 || seen.has(node)) return;
            if (typeof node === "object") seen.add(node);
            if (typeof node === "function") {
              try {
                node(token);
              } catch {
                /* ignore */
              }
              return;
            }
            if (node && typeof node === "object") {
              for (const k of Object.keys(node)) {
                if (k === "callback" || k === "promise-callback" || /callback/i.test(k)) {
                  visit(node[k], depth + 1);
                } else if (depth < 3 && typeof node[k] === "object") {
                  visit(node[k], depth + 1);
                }
              }
            }
          };
          for (const key of Object.keys(clients)) visit(clients[key], 0);
        }
      } catch {
        /* ignore */
      }
      return { ok: true, injected: "token", areas: areas.length, note: "Token injected; submit if needed." };
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

  /**
   * Google SERP extractors — ported from Desktop/api.py for live-DOM capture.
   * Why: class names are brittle; keep multiple fallbacks like the Python scraper.
   */
  function captureSerp() {
    return {
      url: location.href,
      title: document.title,
      ai_overview: extractAiOverview(),
      sponsored_results: extractSponsoredResults(),
      organic_results: extractOrganicResults(),
      people_also_search_for: extractPeopleAlsoSearchFor(),
    };
  }

  function extractSponsoredResults() {
    const sponsored = [];
    let position = 0;

    function processAdBlock(block) {
      const link = block.querySelector("a[href]");
      if (!link) return;
      let url = link.getAttribute("href") || "";
      if (!(url.startsWith("/aclk") || url.startsWith("http"))) return;
      position += 1;

      const titleTag =
        [...block.querySelectorAll("div, span")].find((el) =>
          /CCgQ5/.test(el.className || "")
        ) ||
        block.querySelector('[role="heading"]') ||
        link;
      const title = (titleTag?.innerText || "").trim();

      const cite =
        block.querySelector("cite") ||
        [...block.querySelectorAll("span")].find((el) => /VuuXrf/.test(el.className || ""));
      const displayUrl = (cite?.innerText || "").trim();

      const snippetTag = [...block.querySelectorAll("div")].find(
        (el) => /MUxGbd|yDYNvb/.test(el.className || "")
      );
      const snippet = (snippetTag?.innerText || "").replace(/\s+/g, " ").trim();

      if (url.startsWith("/aclk")) {
        try {
          const u = new URL(url, location.origin);
          url = u.searchParams.get("adurl") || url;
        } catch {
          /* keep */
        }
      }

      sponsored.push({
        position,
        title,
        url,
        site_name: displayUrl.split(/\s+/)[0] || "",
        display_url: displayUrl,
        snippet,
      });
    }

    const tads = document.querySelector("#tads");
    if (tads) {
      const blocks =
        [...tads.querySelectorAll("div")].filter((el) => /uEierd/.test(el.className || "")) ||
        [...tads.querySelectorAll('[data-text-ad="1"]')];
      const list = blocks.length ? blocks : [...tads.children].filter((n) => n.tagName === "DIV");
      for (const block of list) processAdBlock(block);
    }

    const tadsb = document.querySelector("#tadsb");
    if (tadsb) {
      for (const block of [...tadsb.children].filter((n) => n.tagName === "DIV")) {
        processAdBlock(block);
      }
    }

    return sponsored;
  }

  function extractAiOverview() {
    const aiData = { available: false, heading: "", sections: [], sources: [] };

    const notAvailable = document.querySelector('span[jsname="lGsj1"]');
    if (notAvailable && !/display:\s*none/i.test(notAvailable.getAttribute("style") || "")) {
      return aiData;
    }

    let aiContainer =
      document.querySelector('[id^="B2Jtyd"]') ||
      [...document.querySelectorAll("div")].find((el) => /EyBRub/.test(el.className || ""));

    if (!aiContainer) {
      const headingTag =
        document.querySelector(".cUzNTd, .Fzsovc") ||
        document.querySelector('[jsname="cUzNTd"]');
      if (headingTag) {
        aiContainer =
          headingTag.closest("div") &&
          [...headingTag.parentElement?.querySelectorAll("div") || []].find((el) =>
            /EyBRub/.test(el.className || "")
          );
        if (!aiContainer) aiContainer = headingTag.closest("div");
      }
    }

    if (!aiContainer) return aiData;

    const headingTag =
      aiContainer.querySelector(".cUzNTd, .Fzsovc") || document.querySelector(".cUzNTd, .Fzsovc");
    if (headingTag) aiData.heading = headingTag.innerText.trim();

    if (!aiData.heading) {
      for (const tag of aiContainer.querySelectorAll("div, span")) {
        const txt = tag.innerText.trim();
        if (/^ai overviews?$/i.test(txt)) {
          aiData.heading = txt;
          break;
        }
      }
    }

    if (!aiData.heading) return aiData;
    aiData.available = true;

    for (const block of aiContainer.querySelectorAll("div.n6owBd")) {
      const text = block.innerText.replace(/\s+/g, " ").trim();
      if (text) aiData.sections.push({ type: "text", content: text });
    }

    for (const heading of aiContainer.querySelectorAll("div.otQkpb")) {
      const headingText = heading.innerText.replace(/\s+/g, " ").trim();
      const parent = heading.closest('div[data-bfc]');
      const items = [];
      if (parent) {
        const sibling = parent.nextElementSibling;
        if (sibling?.matches?.('div[data-bfc]')) {
          for (const li of sibling.querySelectorAll("li.Z1qcYe")) {
            const t = li.innerText.replace(/\s+/g, " ").trim();
            if (t) items.push(t);
          }
          if (!items.length) {
            const t = sibling.innerText.replace(/\s+/g, " ").trim();
            if (t) items.push(t);
          }
        }
      }
      if (headingText || items.length) {
        aiData.sections.push({ type: "section", heading: headingText, items });
      }
    }

    for (const table of aiContainer.querySelectorAll("table.NRefec")) {
      const rows = [];
      for (const tr of table.querySelectorAll("tr")) {
        const cells = [...tr.querySelectorAll("th, td")].map((td) =>
          td.innerText.replace(/\s+/g, " ").trim()
        );
        if (cells.length) rows.push(cells);
      }
      if (rows.length) aiData.sections.push({ type: "table", rows });
    }

    const seen = new Set();
    for (const link of aiContainer.querySelectorAll("a.muU3oe")) {
      const href = link.getAttribute("href") || "";
      if (href && !seen.has(href)) {
        seen.add(href);
        aiData.sources.push(href);
      }
    }

    return aiData;
  }

  function extractPeopleAlsoSearchFor() {
    const pasf = { available: false, heading: "", results: [] };
    const bres = document.querySelector("#bres");
    if (!bres) return pasf;

    const headingTag = [...bres.querySelectorAll("span, div")].find((el) =>
      /mgAbYb/.test(el.className || "")
    );
    if (headingTag) pasf.heading = headingTag.innerText.replace(/\s+/g, " ").trim();

    const seen = new Set();
    let position = 0;
    for (const card of [...bres.querySelectorAll("a")].filter((a) =>
      /ngTNl/.test(a.className || "")
    )) {
      const href = card.getAttribute("href") || "";
      if (!href) continue;
      const textTag = [...card.querySelectorAll("span")].find((el) =>
        /dg6jd/.test(el.className || "")
      );
      const query = (textTag?.innerText || "").replace(/\s+/g, " ").trim();
      if (!query || seen.has(query)) continue;
      seen.add(query);
      position += 1;
      pasf.results.push({
        position,
        query,
        url: href.startsWith("http") ? href : `https://www.google.com${href}`,
      });
    }
    if (pasf.results.length) pasf.available = true;
    return pasf;
  }

  function extractOrganicResults() {
    const allData = [];
    const results = [...document.querySelectorAll("div")].filter((el) =>
      /tF2Cxc/.test(el.className || "")
    );
    for (let idx = 0; idx < results.length && allData.length < 50; idx++) {
      const result = results[idx];
      const linkTag = result.querySelector("a[href]");
      let url = linkTag?.getAttribute("href") || "";
      if (url.startsWith("/url?")) {
        try {
          url = new URL(url, location.origin).searchParams.get("q") || url;
        } catch {
          /* keep */
        }
      }
      const title = (result.querySelector("h3")?.innerText || "").trim();
      const siteTag = [...result.querySelectorAll("span")].find((el) =>
        /VuuXrf/.test(el.className || "")
      );
      const citeTag = result.querySelector("cite");
      const snippetTag = result.querySelector("div.VwiC3b");
      let snippet = "";
      if (snippetTag) {
        const clone = snippetTag.cloneNode(true);
        clone.querySelectorAll("a").forEach((a) => a.remove());
        snippet = clone.innerText.replace(/\s+/g, " ").trim();
      }
      if (title && url) {
        allData.push({
          position: allData.length + 1,
          url,
          title,
          site_name: (siteTag?.innerText || "").trim(),
          display_url: (citeTag?.innerText || "").replace(/\s+/g, " ").trim(),
          snippet,
        });
      }
    }
    return allData;
  }

  function clickNextSerp() {
    const next =
      document.querySelector("#pnnext") ||
      document.querySelector('a[aria-label="Next page"]') ||
      document.querySelector('a[aria-label="Next"]');
    if (!next) return { clicked: false };
    next.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    next.click();
    return { clicked: true };
  }

  // Why: cloud Playwright prefers extension-injected helpers when the MV3 package is loaded.
  try {
    window.__yambotCaptureSerp = captureSerp;
    window.__yambotClickNextSerp = clickNextSerp;
  } catch {
    /* ignore */
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
      if (msg.type === "CAPTURE_SERP") {
        return captureSerp();
      }
      if (msg.type === "CLICK_NEXT_SERP") {
        return clickNextSerp();
      }
      throw new Error(`Unknown content message: ${msg.type}`);
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

    return true;
  });
})();
