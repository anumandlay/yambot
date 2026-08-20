/**
 * @fileoverview In-page DOM observe/execute helpers for Playwright `page.evaluate`.
 * Purpose: Same ref model as the Chrome content script (`data-ba-ref`) so LLM prompts stay identical.
 * Why these are plain functions: Playwright serializes them into the browser; no Node closures.
 */

/**
 * Observes the current document and stamps interactive refs.
 * @returns {object}
 */
export function observeInPage() {
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
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return cleanText(placeholder);
    const name = el.getAttribute("name");
    if (name) return cleanText(name);
    const title = el.getAttribute("title");
    if (title) return cleanText(title);
    return cleanText(el.innerText || el.value || el.alt || el.tagName);
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
      "[contenteditable='true']",
      "summary",
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
        role: el.getAttribute("role") || undefined,
        name: labelFor(el),
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

  return {
    url: location.href,
    title: document.title,
    interactives: collectInteractives(),
    captcha: detectCaptcha(),
    text: pageText(),
  };
}

/**
 * @param {object} action
 */
export function executeInPage(action) {
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
    return cleanText(el.innerText || el.value || el.tagName);
  }

  function byRef(ref) {
    const el = document.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
    if (!el) throw new Error(`Element not found for ref: ${ref}`);
    return el;
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

  function pageText(max = 8000) {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    return cleanText(clone.innerText, max);
  }

  function detectCaptcha() {
    const signals = [];
    if (document.querySelector(".g-recaptcha, iframe[src*='recaptcha'], #g-recaptcha-response")) {
      signals.push("recaptcha");
    }
    if (document.querySelector(".h-captcha, iframe[src*='hcaptcha']")) {
      signals.push("hcaptcha");
    }
    return { present: signals.length > 0, signals };
  }

  function findRecaptchaSitekey() {
    const el = document.querySelector(".g-recaptcha[data-sitekey], [data-sitekey]");
    if (el?.getAttribute("data-sitekey")) return el.getAttribute("data-sitekey");
    const iframe = document.querySelector("iframe[src*='recaptcha']");
    if (iframe?.src) {
      try {
        return new URL(iframe.src).searchParams.get("k");
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

  switch (action.type) {
    case "click": {
      const el = byRef(action.ref);
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.click();
      return { ok: true };
    }
    case "type": {
      const el = byRef(action.ref);
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
      const el = byRef(action.ref);
      if (el.tagName !== "SELECT") throw new Error("ref is not a select");
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
      window.scrollBy({ top: dir * amount, behavior: "instant" });
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
      const token = action.token;
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
        return { ok: true, injected: "token" };
      }
      return {
        ok: false,
        error: "No token provided",
        sitekey: findRecaptchaSitekey() || findHcaptchaSitekey(),
        pageurl: location.href,
        captcha: detectCaptcha(),
      };
    }
    default:
      throw new Error(`Page cannot run action: ${action.type}`);
  }
}

/**
 * Captcha sitekey metadata for DBC.
 */
export function captchaMetaInPage() {
  function findRecaptchaSitekey() {
    const el = document.querySelector(".g-recaptcha[data-sitekey], [data-sitekey]");
    if (el?.getAttribute("data-sitekey")) return el.getAttribute("data-sitekey");
    const iframe = document.querySelector("iframe[src*='recaptcha']");
    if (iframe?.src) {
      try {
        return new URL(iframe.src).searchParams.get("k");
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
  const signals = [];
  if (document.querySelector(".g-recaptcha, iframe[src*='recaptcha'], #g-recaptcha-response")) {
    signals.push("recaptcha");
  }
  if (document.querySelector(".h-captcha, iframe[src*='hcaptcha']")) {
    signals.push("hcaptcha");
  }
  return {
    captcha: { present: signals.length > 0, signals },
    recaptchaSitekey: findRecaptchaSitekey(),
    hcaptchaSitekey: findHcaptchaSitekey(),
    pageurl: location.href,
  };
}
