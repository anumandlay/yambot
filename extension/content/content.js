/**
 * Content script: observe page + execute agent actions.
 * Injected on all URLs; talks to the service worker via chrome.runtime.
 * Locators: ref → role+name → label/name → css → xpath (mirrors worker pageDom).
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

  function clearRefs() {
    document.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
  }

  function collectInteractives(limit = 80) {
    clearRefs();
    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='option']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='switch']",
      "[contenteditable='true']",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const nodes = [...document.querySelectorAll(selectors)].filter(isVisible);
    const items = [];
    let i = 0;
    for (const el of nodes) {
      if (i >= limit) break;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "hidden") continue;

      const ref = `e${i}`;
      el.setAttribute(REF_ATTR, ref);
      i += 1;

      items.push({
        ref,
        tag,
        type: type || undefined,
        role: impliedRole(el),
        name: labelFor(el),
        cssHint: cssHintFor(el),
        href: tag === "a" ? el.href?.slice(0, 200) : undefined,
        value: "value" in el && el.value ? cleanText(el.value, 80) : undefined,
      });
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
    const bodyText = (document.body?.innerText || "").slice(0, 4000).toLowerCase();
    if (/verify you are human|i'?m not a robot|complete the captcha|security check/.test(bodyText)) {
      signals.push("text_hint");
    }
    return { present: signals.length > 0, signals };
  }

  function pageText(max = 6000) {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    return cleanText(clone.innerText, max);
  }

  function observe() {
    const interactives = collectInteractives();
    const captcha = detectCaptcha();
    return {
      url: location.href,
      title: document.title,
      interactives,
      captcha,
      text: pageText(),
    };
  }

  function nameMatches(el, wanted) {
    const w = cleanText(wanted, 200).toLowerCase();
    if (!w) return false;
    const n = labelFor(el).toLowerCase();
    return n === w || n.includes(w) || w.includes(n);
  }

  function roleMatches(el, role) {
    if (!role) return true;
    const r = String(role).toLowerCase();
    const actual = (impliedRole(el) || "").toLowerCase();
    if (actual === r) return true;
    if (r === "button" && (actual === "button" || el.tagName === "BUTTON")) return true;
    if (r === "link" && (actual === "link" || el.tagName === "A")) return true;
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
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    return [...document.querySelectorAll(selectors)].filter(isVisible);
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

  /**
   * Multi-strategy resolve: ref → role+name → label/name → css → xpath.
   * @param {object} action
   * @returns {Element}
   */
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
      const hit = candidatePool().find((el) => roleMatches(el, role) && nameMatches(el, name));
      if (hit) return hit;
    }

    const label = action.label ? String(action.label) : name;
    if (label) {
      tried.push(`label=${label}`);
      const hit = candidatePool().find((el) => {
        if (role && !roleMatches(el, role)) return false;
        return nameMatches(el, label);
      });
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

  function highlight(el) {
    const prev = el.style.outline;
    el.style.outline = "2px solid #0f766e";
    el.scrollIntoView({ block: "center", behavior: "smooth" });
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
  }

  async function execute(action) {
    switch (action.type) {
      case "click": {
        const el = resolveElement(action);
        highlight(el);
        el.click();
        return { ok: true };
      }
      case "type": {
        const el = resolveElement(action);
        highlight(el);
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
        const el = resolveElement(action);
        highlight(el);
        if (el.tagName !== "SELECT") throw new Error("resolved element is not a select");
        const wanted = String(action.value ?? "");
        const opt = [...el.options].find(
          (o) => o.value === wanted || o.text.trim() === wanted || o.text.includes(wanted)
        );
        if (!opt) throw new Error(`Option not found: ${wanted}`);
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, selected: opt.text };
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
        const focus = action.focus || "main content";
        return {
          ok: true,
          focus,
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
      try {
        if (window.___grecaptcha_cfg?.clients) {
          // Sites vary; user may still need to click verify/submit
        }
      } catch {
        /* ignore */
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
