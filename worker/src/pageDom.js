/**
 * @fileoverview In-page DOM observe/execute helpers for Playwright `page.evaluate`.
 * Purpose: Same ref model as the Chrome content script (`data-ba-ref`) so LLM prompts stay identical.
 * Why these are plain functions: Playwright serializes them into the browser; no Node closures.
 * Locators: ref → role+name → label/name → css → xpath (first visible match wins).
 * Why overlay-aware: custom dropdowns/calendars (e.g. Vughy) render options outside <select>.
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

  /**
   * Whether any ARIA menu panel is open (Gmail bulk actions, nested submenus, etc.).
   * @returns {boolean}
   */
  function hasOpenMenus() {
    return [...document.querySelectorAll('[role="menu"]')].some(isVisible);
  }

  /**
   * Whether an element is list/grid row noise while menus are open (e.g. Gmail email rows).
   * @param {Element} el
   * @returns {boolean}
   */
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

  /**
   * Structured summary of every visible menu panel (for LLM + nested submenu flows).
   * @returns {object[]}
   */
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

  /**
   * Leaf-ish clickable rows inside open dropdowns / menus (Passport, Gmail submenus, etc.).
   * @returns {Element[]}
   */
  function collectOverlayOptions() {
    const seen = new Set();
    const out = [];

    /**
     * @param {Element} el
     */
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

    // Why: Gmail/MUI render each submenu as its own `[role="menu"]` sibling — collect every panel.
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

  /**
   * Calendar day cells + quick picks (Today / Tomorrow / day numbers).
   * @returns {Element[]}
   */
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
        // Why: day numbers + quick chips (Today / Tomorrow / In 3 days).
        if (/^(today|tomorrow|in \d+ days?|in \d+ weeks?|\d{1,2})$/i.test(text)) {
          out.push(el);
        }
      }
    }
    return out;
  }

  function clearRefs() {
    document.querySelectorAll(`[${REF_ATTR}], [data-ba-xpath]`).forEach((el) => {
      el.removeAttribute(REF_ATTR);
      el.removeAttribute("data-ba-xpath");
    });
  }

  /**
   * Escapes a string for use inside an XPath literal.
   * @param {string} value
   * @returns {string}
   */
  function xpathLiteral(value) {
    const s = String(value || "");
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return `concat('${s.split("'").join(`', "'", '`)}')`;
  }

  /**
   * Builds a stable XPath (attribute-based), not brittle DevTools `/html/body/div[6]/...` paths.
   * @param {Element} el
   * @returns {string}
   */
  function buildSmartXPath(el) {
    if (!el || el.nodeType !== 1) return "";

    if (el.id && /^[A-Za-z][\w.-]*$/.test(el.id)) {
      const xp = `//*[@id=${xpathLiteral(el.id)}]`;
      try {
        const found = document.evaluate(
          xp,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        if (found.snapshotLength === 1) return xp;
      } catch {
        /* try other strategies */
      }
    }

    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    if (testId) {
      return `//*[@data-testid=${xpathLiteral(testId)}]`;
    }

    const aria = el.getAttribute("aria-label");
    if (aria && aria.length <= 120) {
      const tag = el.tagName.toLowerCase();
      return `//${tag}[@aria-label=${xpathLiteral(aria)}]`;
    }

    const nameAttr = el.getAttribute("name");
    if (nameAttr && /^(input|select|textarea|button)$/i.test(el.tagName)) {
      return `//${el.tagName.toLowerCase()}[@name=${xpathLiteral(nameAttr)}]`;
    }

    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href && href.length <= 160) {
        return `//a[@href=${xpathLiteral(href)}]`;
      }
    }

    const role = el.getAttribute("role");
    const text = cleanText(el.innerText || el.textContent || "", 48);
    if (role && text.length >= 2) {
      return `//*[@role=${xpathLiteral(role)}][contains(normalize-space(.), ${xpathLiteral(text.slice(0, 40))})]`;
    }

    const segments = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && depth < 8) {
      const tag = node.tagName.toLowerCase();
      let seg = tag;
      const nid = node.id;
      if (nid && /^[A-Za-z][\w.-]*$/.test(nid)) {
        segments.unshift(`${tag}[@id=${xpathLiteral(nid)}]`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) {
          seg = `${tag}[${sameTag.indexOf(node) + 1}]`;
        }
      }
      segments.unshift(seg);
      node = parent;
      depth += 1;
    }
    return segments.length ? `/${segments.join("/")}` : "";
  }

  /**
   * Nearest heading or row label for disambiguating repeated buttons (e.g. Delete in a table).
   * @param {Element} el
   * @returns {string|undefined}
   */
  function nearbyTextFor(el) {
    const row = el.closest('[role="row"], tr, li, [class*="row"]');
    if (row) {
      const t = cleanText(row.innerText || "", 80);
      if (t) return t.split("\n")[0];
    }
    const heading = el.closest("section, article, div")?.querySelector("h1,h2,h3,h4,h5,h6");
    if (heading) return cleanText(heading.innerText, 80);
    return undefined;
  }

  /**
   * Parent landmark role for fingerprint matching inside dialogs/forms.
   * @param {Element} el
   * @returns {string|undefined}
   */
  function parentRoleFor(el) {
    const parent = el.closest(
      '[role="dialog"], [role="form"], form, [role="menu"], [role="grid"], [aria-modal="true"]'
    );
    if (!parent) return undefined;
    return parent.getAttribute("role") || (parent.tagName === "FORM" ? "form" : undefined);
  }

  /**
   * Shadow host label when element lives inside a web component.
   * @param {Element} el
   * @returns {string|undefined}
   */
  function shadowHostFor(el) {
    const root = el.getRootNode?.();
    if (root && root instanceof ShadowRoot) {
      const host = root.host;
      if (!host) return "shadow";
      const tag = host.tagName?.toLowerCase();
      const id = host.id ? `#${host.id}` : "";
      const testId = host.getAttribute("data-testid");
      return testId ? `${tag}[data-testid=${testId}]` : `${tag}${id}` || "shadow-host";
    }
    return undefined;
  }

  function toItem(el, ref, xpath) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const smartXPath = xpath || buildSmartXPath(el);
    const role = impliedRole(el);
    const name = labelFor(el);
    const formEl = el.closest("form");
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    const ariaLabel = el.getAttribute("aria-label") || undefined;
    const nearbyText = nearbyTextFor(el);
    const parentRole = parentRoleFor(el);
    const shadowHost = shadowHostFor(el);
    const disabled =
      el.disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("disabled") != null;
    const invalid =
      el.getAttribute("aria-invalid") === "true" ||
      el.matches?.(":invalid") ||
      false;
    const autoComplete = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
    const searchable =
      autoComplete === "list" ||
      autoComplete === "both" ||
      (role === "combobox" &&
        (el.tagName === "INPUT" ||
          el.isContentEditable ||
          /select|autocomplete|typeahead|search/i.test(
            `${el.className || ""} ${el.getAttribute("placeholder") || ""}`
          )));

    return {
      ref,
      tag,
      type: type || undefined,
      role,
      name,
      cssHint: cssHintFor(el),
      xpath: smartXPath || undefined,
      overlay: Boolean(overlayRoot(el) || el.closest('[role="menu"]')),
      hasSubmenu: hasSubmenu(el) || undefined,
      searchable: searchable || undefined,
      href: tag === "a" ? el.href?.slice(0, 200) : undefined,
      value: "value" in el && el.value ? cleanText(el.value, 80) : undefined,
      id: el.id || undefined,
      testid: testId || undefined,
      ariaLabel,
      nearbyText,
      parentRole,
      shadowHost,
      inForm: Boolean(formEl),
      formId: formEl?.id || formEl?.getAttribute("name") || undefined,
      formName: formEl?.getAttribute("aria-label") || formEl?.id || undefined,
      required: el.required || el.getAttribute("aria-required") === "true" || undefined,
      disabled: disabled || undefined,
      visible: true,
      invalid: invalid || undefined,
      validationMessage: invalid ? el.validationMessage || undefined : undefined,
      fingerprint: {
        tag,
        role,
        name,
        text: name,
        aria_label: ariaLabel,
        href: tag === "a" ? el.href?.slice(0, 200) : undefined,
        id: el.id || undefined,
        testid: testId || undefined,
        nearby_text: nearbyText,
        parent_role: parentRole,
        shadow_host: shadowHost,
        type: type || undefined,
      },
    };
  }

  /**
   * Lightweight page-state hints computed in-page (modal, loading, blocking overlay).
   * @returns {object}
   */
  function collectPageHints() {
    const modalOpen = Boolean(
      document.querySelector(
        '[role="dialog"][aria-modal="true"], [role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]'
      ) &&
        [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some(isVisible)
    );
    const loading = Boolean(
      document.querySelector(
        '[aria-busy="true"], .loading, .spinner, [class*="skeleton"], [class*="Spinner"]'
      )
    );
    let blockingOverlay;
    const cookie = [...document.querySelectorAll("button, a, [role='button']")].find((el) => {
      if (!isVisible(el)) return false;
      const t = cleanText(el.innerText || el.getAttribute("aria-label") || "", 80).toLowerCase();
      return /accept all|accept cookies|agree|i agree|got it/.test(t);
    });
    if (cookie) {
      blockingOverlay = cleanText(cookie.innerText || cookie.getAttribute("aria-label") || "", 80);
    }
    const dropdownOpen = Boolean(
      document.querySelector(
        '[role="listbox"]:not([hidden]), [role="menu"]:not([hidden]), [data-state="open"]'
      )
    );
    let application;
    const host = location.hostname.toLowerCase();
    if (host.includes("mail.google")) application = "gmail";
    else if (host.includes("amazon.")) application = "amazon";
    else if (host.includes("google.")) application = "google";

    return {
      modalOpen,
      loading,
      blockingOverlay,
      dropdownOpen,
      application,
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

    // Why: open popovers first so Passport / day-21 appear before buried page controls.
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

    // Why: Web Components hide controls inside shadow roots — pierce one level deep per host.
    const shadowBucket = [];
    function walkShadow(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.shadowRoot) {
        for (const el of node.shadowRoot.querySelectorAll(selectors)) {
          if (seen.has(el)) continue;
          const type = (el.getAttribute("type") || "").toLowerCase();
          if (type === "hidden") continue;
          if (!isVisible(el)) continue;
          accept(el, shadowBucket);
        }
        for (const child of node.shadowRoot.querySelectorAll("*")) {
          if (child.shadowRoot) walkShadow(child);
        }
      }
      for (const child of node.children) walkShadow(child);
    }
    if (document.body) walkShadow(document.body);

    const ordered = [...overlays, ...shop, ...chrome, ...body, ...shadowBucket];
    const items = [];
    let i = 0;
    for (const el of ordered) {
      const ref = `e${i}`;
      const xpath = buildSmartXPath(el);
      el.setAttribute(REF_ATTR, ref);
      if (xpath) el.setAttribute("data-ba-xpath", xpath);
      items.push(toItem(el, ref, xpath));
      i += 1;
    }
    return items;
  }

  /**
   * Forms, dialogs, and tables — structured view for the LLM (refs already stamped).
   * @param {object[]} interactives
   * @returns {object}
   */
  function collectStructures(interactives) {
    const forms = new Map();
    for (const item of interactives) {
      if (!item.inForm && !item.formId) continue;
      const key = item.formId || item.formName || "form";
      if (!forms.has(key)) {
        forms.set(key, { id: key, name: item.formName || key, fields: [], actions: [] });
      }
      const form = forms.get(key);
      const entry = {
        ref: item.ref,
        name: item.name,
        type: item.type || item.role,
        required: item.required,
        value: item.value,
      };
      if (
        item.role === "button" ||
        item.type === "submit" ||
        /submit|send|sign in|continue|apply/i.test(item.name || "")
      ) {
        form.actions.push(entry);
      } else {
        form.fields.push(entry);
      }
    }

    const dialogs = [];
    const modalOpen = Boolean(
      [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some(isVisible)
    );
    if (modalOpen) {
      const inDialog = interactives.filter(
        (i) => i.parentRole === "dialog" || (i.overlay && i.parentRole)
      );
      if (inDialog.length) {
        const fields = inDialog
          .filter((i) => ["textbox", "combobox", "checkbox", "radio"].includes(i.role || ""))
          .map((i) => ({
            ref: i.ref,
            name: i.name,
            role: i.role,
            required: i.required,
          }));
        const actions = inDialog
          .filter((i) => i.role === "button" || i.tag === "button")
          .map((i) => ({ ref: i.ref, name: i.name, role: i.role }));
        const titleEl = document.querySelector(
          '[role="dialog"] h1, [role="dialog"] h2, [aria-modal="true"] [aria-label]'
        );
        dialogs.push({
          title: cleanText(
            titleEl?.innerText || titleEl?.getAttribute("aria-label") || "Dialog",
            80
          ),
          fields: fields.slice(0, 12),
          actions: actions.slice(0, 8),
        });
      }
    }

    const tables = [];
    for (const root of [...document.querySelectorAll('table, [role="grid"]')]
      .filter(isVisible)
      .slice(0, 5)) {
      const title = cleanText(
        root.querySelector("caption")?.innerText ||
          root.getAttribute("aria-label") ||
          root.getAttribute("aria-labelledby") ||
          "Table",
        80
      );
      const rows = [];
      for (const row of [...root.querySelectorAll('tr, [role="row"]')]
        .filter(isVisible)
        .slice(0, 25)) {
        const cells = [...row.querySelectorAll('td, th, [role="gridcell"], [role="cell"]')]
          .filter(isVisible)
          .map((c) => cleanText(c.innerText, 60))
          .filter(Boolean);
        const rowLabel = cells[0] || cleanText(row.innerText, 80);
        const actions = [];
        for (const el of row.querySelectorAll(`[${REF_ATTR}]`)) {
          actions.push({
            ref: el.getAttribute(REF_ATTR),
            name: labelFor(el),
            role: impliedRole(el),
          });
        }
        if (rowLabel || actions.length) {
          rows.push({ label: rowLabel, cells: cells.slice(0, 6), actions });
        }
      }
      if (rows.length) tables.push({ title, rows });
    }

    return {
      forms: [...forms.values()].slice(0, 5),
      dialogs: dialogs.slice(0, 3),
      tables: tables.slice(0, 4),
    };
  }

  /**
   * Visible iframe metadata for cross-origin payment/login embeds.
   * @returns {object[]}
   */
  function collectIframeMeta() {
    return [...document.querySelectorAll("iframe")]
      .filter(isVisible)
      .slice(0, 10)
      .map((f, index) => ({
        index,
        src: (f.src || f.getAttribute("src") || "").slice(0, 200),
        title: f.title || f.getAttribute("aria-label") || f.getAttribute("name") || "",
        name: f.getAttribute("name") || undefined,
      }));
  }

  function isCaptchaVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 24 && rect.height > 24;
  }

  function hasVisibleSelector(selector) {
    return Array.from(document.querySelectorAll(selector)).some(isCaptchaVisible);
  }

  /**
   * Why: solved reCAPTCHA keeps the iframe/#g-recaptcha-response in the DOM — without this
   * we re-handoff forever after the user already checked “I'm not a robot”.
   */
  function isRecaptchaSolved() {
    const areas = document.querySelectorAll(
      "#g-recaptcha-response, textarea[name='g-recaptcha-response'], textarea.g-recaptcha-response"
    );
    for (const el of areas) {
      if (String(el.value || "").trim().length > 20) return true;
    }
    try {
      if (typeof window.grecaptcha?.getResponse === "function") {
        const token = window.grecaptcha.getResponse();
        if (String(token || "").trim().length > 20) return true;
      }
    } catch {
      /* cross-origin / not ready */
    }
    return false;
  }

  function isHcaptchaSolved() {
    const areas = document.querySelectorAll(
      "textarea[name='h-captcha-response'], textarea[name='g-recaptcha-response'][data-hcaptcha]," +
        " [name='h-captcha-response']"
    );
    for (const el of areas) {
      if (String(el.value || "").trim().length > 20) return true;
    }
    try {
      if (typeof window.hcaptcha?.getResponse === "function") {
        const token = window.hcaptcha.getResponse();
        if (String(token || "").trim().length > 20) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function detectCaptcha() {
    const signals = [];
    if (
      hasVisibleSelector(".g-recaptcha") ||
      hasVisibleSelector("iframe[src*='recaptcha']") ||
      hasVisibleSelector("iframe[src*='google.com/recaptcha']") ||
      document.querySelector("#g-recaptcha-response")
    ) {
      signals.push("recaptcha");
    }
    if (hasVisibleSelector(".h-captcha") || hasVisibleSelector("iframe[src*='hcaptcha']")) {
      signals.push("hcaptcha");
    }
    if (
      hasVisibleSelector("iframe[src*='opfcaptcha']") ||
      hasVisibleSelector("iframe[src*='arkoselabs']") ||
      hasVisibleSelector("iframe[src*='funcaptcha']")
    ) {
      signals.push("iframe_captcha");
    }
    // Why: Amazon login uses image/CVF captchas — not Google reCAPTCHA sitekeys.
    if (
      document.querySelector(
        [
          "#auth-captcha-image",
          "#captchacharacters",
          'input[name="cvf_captcha_input"]',
          'form[action*="validateCaptcha"]',
          "#cvf-page-content",
          ".cvf-widget-form",
        ].join(",")
      ) ||
      hasVisibleSelector('img[src*="captcha"]') ||
      hasVisibleSelector('iframe[src*="opfcaptcha"]')
    ) {
      signals.push("amazon_captcha");
    }
    if (/\/ap\/cvf|\/errors\/validateCaptcha|\/ap\/signin/i.test(location.pathname + location.search)) {
      // Only flag signin URL if captcha UI is also present — avoid false positives on normal login.
      if (signals.includes("amazon_captcha") || document.querySelector('img[src*="Captcha"]')) {
        signals.push("amazon_url");
      }
    }
    const bodyText = (document.body?.innerText || "").slice(0, 5000).toLowerCase();
    if (
      /verify you are human|i'?m not a robot|complete the captcha|security check|type the characters|enter the characters you see|solve this puzzle|unusual activity|robot check|opfcaptcha/.test(
        bodyText
      ) &&
      (/captcha|puzzle|characters you see|robot/i.test(bodyText) || signals.length > 0)
    ) {
      signals.push("text_hint");
    }

    const unique = [...new Set(signals)];
    if (unique.includes("recaptcha") && isRecaptchaSolved()) {
      return { present: false, signals: [], solved: true, solvedKind: "recaptcha" };
    }
    if (unique.includes("hcaptcha") && isHcaptchaSolved()) {
      return { present: false, signals: [], solved: true, solvedKind: "hcaptcha" };
    }
    // Why: badge-only / leftover textarea without a visible challenge should not block the agent.
    if (unique.length === 1 && unique[0] === "recaptcha") {
      const challengeUi =
        hasVisibleSelector(".g-recaptcha") ||
        hasVisibleSelector("iframe[src*='recaptcha/']") ||
        hasVisibleSelector("iframe[title*='reCAPTCHA']");
      if (!challengeUi && document.querySelector("#g-recaptcha-response")) {
        return { present: false, signals: [], solved: false, badgeOnly: true };
      }
    }
    return { present: unique.length > 0, signals: unique };
  }

  function pageText(max = 6000) {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    return cleanText(clone.innerText, max);
  }

  const pageHints = collectPageHints();
  const interactives = collectInteractives();
  const structures = collectStructures(interactives);
  const iframes = collectIframeMeta();

  return {
    url: location.href,
    title: document.title,
    openMenus: collectOpenMenusMeta(),
    interactives,
    structures,
    iframes,
    captcha: detectCaptcha(),
    text: pageText(),
    pageHints,
    modalOpen: pageHints.modalOpen,
  };
}

/**
 * Strips observation for API/event storage (bounded text, plain objects).
 * @param {object|null|undefined} obs
 * @returns {object|null}
 */
export function sanitizePageObservation(obs, extras = {}) {
  if (!obs || typeof obs !== "object") return null;
  return {
    url: String(obs.url || ""),
    title: String(obs.title || ""),
    captcha: obs.captcha || { present: false, signals: [] },
    openMenus: Array.isArray(obs.openMenus) ? obs.openMenus : [],
    iframes: Array.isArray(obs.iframes) ? obs.iframes.slice(0, 12) : undefined,
    frames: Array.isArray(obs.frames) ? obs.frames.slice(0, 12) : undefined,
    a11y: obs.a11y?.yaml
      ? { yaml: String(obs.a11y.yaml).slice(0, 2000), truncated: Boolean(obs.a11y.truncated) }
      : undefined,
    interactives: Array.isArray(obs.interactives)
      ? obs.interactives.map((el) => ({
          ref: el.ref,
          tag: el.tag,
          type: el.type,
          role: el.role,
          name: el.name,
          cssHint: el.cssHint,
          xpath: el.xpath,
          overlay: el.overlay,
          hasSubmenu: el.hasSubmenu,
          href: el.href,
          value: el.value,
          fingerprint: el.fingerprint,
          disabled: el.disabled,
          nearbyText: el.nearbyText,
          frameId: el.frameId,
          frameUrl: el.frameUrl,
          shadowHost: el.shadowHost,
        }))
      : [],
    text: String(obs.text || "").slice(0, 8000),
    interactiveCount: Array.isArray(obs.interactives) ? obs.interactives.length : 0,
    pageState: extras.pageState || undefined,
    stateDiff: extras.stateDiff || undefined,
    structures: obs.structures || undefined,
    plan: extras.plan || undefined,
    progress: extras.progress || undefined,
    visionAttached: extras.visionAttached || undefined,
    telemetry: extras.telemetry || undefined,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Pre-action locator checks: exists, visible, enabled (runs in page context).
 * @param {object} action - Enriched locator action with ref/role/name/css/xpath.
 * @returns {object}
 */
export function precheckLocatorInPage(action) {
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

  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  let el = null;
  if (action.ref) {
    el = document.querySelector(`[${REF_ATTR}="${action.ref}"]`);
  }
  if (!el && action.css) {
    try {
      el = document.querySelector(String(action.css));
    } catch {
      /* ignore */
    }
  }

  if (!el) {
    return { ok: false, exists: false, visible: false, enabled: false, error: "TARGET_NOT_FOUND" };
  }

  const visible = isVisible(el);
  const enabled = isEnabled(el);
  if (visible) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }

  return {
    ok: visible && enabled,
    exists: true,
    visible,
    enabled,
    error: !visible ? "TARGET_HIDDEN" : !enabled ? "TARGET_DISABLED" : undefined,
    ref: action.ref,
    name: el.getAttribute("aria-label") || el.innerText?.slice(0, 80),
  };
}

/**
 * Pollable wait condition for semantic wait_for (runs in page context).
 * @param {object} condition
 * @returns {{ matched: boolean, detail?: string }}
 */
export function waitForConditionInPage(condition) {
  const c = condition || {};

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const href = location.href;
  if (c.url_matches) {
    try {
      if (!new RegExp(String(c.url_matches), "i").test(href)) {
        return { matched: false, detail: "url_regex" };
      }
    } catch {
      return { matched: false, detail: "url_regex_invalid" };
    }
  } else if (c.url && !href.includes(String(c.url))) {
    return { matched: false, detail: "url" };
  }

  if (c.text) {
    const body = (document.body?.innerText || "").toLowerCase();
    if (!body.includes(String(c.text).toLowerCase())) {
      return { matched: false, detail: "text" };
    }
  }

  if (c.ref) {
    const el = document.querySelector(`[data-ba-ref="${c.ref}"]`);
    if (!el || !isVisible(el)) return { matched: false, detail: "ref" };
  }

  if (c.role || c.name) {
    const wantedRole = String(c.role || "").toLowerCase();
    const wantedName = String(c.name || "").toLowerCase();
    const pool = [...document.querySelectorAll("[data-ba-ref], [role], button, a, input, textarea, select")];
    const hit = pool.some((el) => {
      if (!isVisible(el)) return false;
      const role = (el.getAttribute("role") || el.tagName || "").toLowerCase();
      const name = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.getAttribute("placeholder") ||
        ""
      ).toLowerCase();
      const roleOk = !wantedRole || role.includes(wantedRole) || el.tagName.toLowerCase() === wantedRole;
      const nameOk = !wantedName || name.includes(wantedName);
      return roleOk && nameOk;
    });
    if (!hit) return { matched: false, detail: "role_name" };
  }

  if (c.loading_gone) {
    const loading = document.querySelector(
      '[aria-busy="true"], .loading, .spinner, [class*="skeleton"], [class*="Spinner"]'
    );
    if (loading && isVisible(loading)) return { matched: false, detail: "loading" };
  }

  return { matched: true, detail: "ok", url: href };
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
    if (r === "textbox" && (actual === "textbox" || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
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

    if (action.xpath) {
      tried.push(`xpath=${action.xpath}`);
      try {
        const el = byXPath(String(action.xpath));
        if (el && isVisible(el)) return el;
      } catch {
        /* invalid xpath */
      }
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

    // Why: custom selects often need the option text in `value`.
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

    throw new Error(
      `Element not found (tried: ${tried.join(" → ") || "nothing"}). Re-observe and use a fresh ref or name/css/xpath.`
    );
  }

  /**
   * React-friendly click: full pointer/mouse sequence at element center.
   * @param {Element} el
   */
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
      /* older engines */
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

  function isContentEditableEl(el) {
    return Boolean(el?.isContentEditable || el?.getAttribute?.("contenteditable") === "true");
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

  /**
   * Gmail/Outlook compose bodies use contenteditable divs — not input.value.
   * @param {Element} el
   * @param {string} value
   */
  function setContentEditableValue(el, value) {
    const text = String(value ?? "");
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      el.textContent = text;
    }
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText",
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function pageText(max = 8000) {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    return cleanText(clone.innerText, max);
  }

  function detectCaptcha() {
    function isCaptchaVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 24 && rect.height > 24;
    }
    function hasVisibleSelector(selector) {
      return Array.from(document.querySelectorAll(selector)).some(isCaptchaVisible);
    }
    function isRecaptchaSolved() {
      const areas = document.querySelectorAll(
        "#g-recaptcha-response, textarea[name='g-recaptcha-response'], textarea.g-recaptcha-response"
      );
      for (const el of areas) {
        if (String(el.value || "").trim().length > 20) return true;
      }
      try {
        if (typeof window.grecaptcha?.getResponse === "function") {
          const token = window.grecaptcha.getResponse();
          if (String(token || "").trim().length > 20) return true;
        }
      } catch {
        /* ignore */
      }
      return false;
    }
    function isHcaptchaSolved() {
      const areas = document.querySelectorAll(
        "textarea[name='h-captcha-response'], [name='h-captcha-response']"
      );
      for (const el of areas) {
        if (String(el.value || "").trim().length > 20) return true;
      }
      try {
        if (typeof window.hcaptcha?.getResponse === "function") {
          const token = window.hcaptcha.getResponse();
          if (String(token || "").trim().length > 20) return true;
        }
      } catch {
        /* ignore */
      }
      return false;
    }
    const signals = [];
    if (
      hasVisibleSelector(".g-recaptcha") ||
      hasVisibleSelector("iframe[src*='recaptcha']") ||
      hasVisibleSelector("iframe[src*='google.com/recaptcha']") ||
      document.querySelector("#g-recaptcha-response")
    ) {
      signals.push("recaptcha");
    }
    if (hasVisibleSelector(".h-captcha") || hasVisibleSelector("iframe[src*='hcaptcha']")) {
      signals.push("hcaptcha");
    }
    const unique = [...new Set(signals)];
    if (unique.includes("recaptcha") && isRecaptchaSolved()) {
      return { present: false, signals: [], solved: true, solvedKind: "recaptcha" };
    }
    if (unique.includes("hcaptcha") && isHcaptchaSolved()) {
      return { present: false, signals: [], solved: true, solvedKind: "hcaptcha" };
    }
    return { present: unique.length > 0, signals: unique };
  }

  function findRecaptchaSitekey() {
    const el = document.querySelector(".g-recaptcha[data-sitekey]");
    if (el?.getAttribute("data-sitekey")) return el.getAttribute("data-sitekey");
    for (const iframe of document.querySelectorAll(
      "iframe[src*='recaptcha'], iframe[src*='google.com/recaptcha']"
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
        const m = json.match(/["'](6L[0-9A-Za-z_-]{20,})["']/);
        if (m?.[1]) return m[1];
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function findHcaptchaSitekey() {
    const el = document.querySelector(".h-captcha[data-sitekey], [data-sitekey]");
    return el?.getAttribute("data-sitekey") || null;
  }

  switch (action.type) {
    case "resolve_point": {
      const el = resolveElement(action);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return {
        ok: true,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        name: labelFor(el),
        role: impliedRole(el),
        contentEditable: isContentEditableEl(el),
      };
    }
    case "click": {
      const el = resolveElement(action);
      const point = robustClick(el);
      return { ok: true, ...point, name: labelFor(el) };
    }
    case "type": {
      const el = resolveElement(action);
      robustClick(el);
      el.focus();
      const text = String(action.text ?? "");
      if (isContentEditableEl(el)) {
        setContentEditableValue(el, text);
        return { ok: true, contentEditable: true, name: labelFor(el) };
      }
      setNativeValue(el, text);
      // Why: React controlled inputs often need InputEvent as well.
      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: "insertText",
          })
        );
      } catch {
        /* ignore */
      }
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
      // Native <select>
      try {
        const el = resolveElement({ ...action, name: action.name || action.label });
        if (el.tagName === "SELECT") {
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
        /* fall through to custom option click */
      }
      // Custom dropdown: resolve option then let the worker mouse-click (or robustClick in extension).
      const opt = resolveElement({
        type: "click",
        ref: action.ref,
        role: action.role || "option",
        name: action.value || action.name || action.label,
        label: action.label,
        css: action.css,
        xpath: action.xpath,
      });
      if (action.__domClick) {
        const point = robustClick(opt);
        return { ok: true, selected: labelFor(opt), custom: true, ...point };
      }
      opt.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = opt.getBoundingClientRect();
      return {
        ok: true,
        selected: labelFor(opt),
        custom: true,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      };
    }
    case "press_key": {
      const key = action.key || "Enter";
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
      return { ok: true };
    }
    case "scroll": {
      const rawAmount = Number(action.amount);
      const rawDy = Number(action.dy);
      let delta =
        Number.isFinite(rawDy) && !Number.isFinite(rawAmount)
          ? rawDy
          : Number.isFinite(rawAmount)
            ? rawAmount
            : 600;
      if (action.direction === "up") delta = -Math.abs(delta);
      else if (action.direction === "down") delta = Math.abs(delta);

      /** @param {Element|null|undefined} el */
      function isScrollableEl(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el === document.body || el === document.documentElement) return false;
        if (el.scrollHeight <= el.clientHeight + 4) return false;
        const style = window.getComputedStyle(el);
        const oy = style.overflowY;
        if (oy === "auto" || oy === "scroll" || oy === "overlay") return true;
        // Vughy-style side nav: overflow hidden on wrapper but scrollTop still works.
        if (el.scrollHeight > el.clientHeight + 4 && oy !== "visible") return true;
        return false;
      }

      /** @param {Element} el */
      function navScore(el) {
        const r = el.getBoundingClientRect();
        let score = 0;
        if (r.left < window.innerWidth * 0.4) score += 20;
        score += Math.min(r.height, window.innerHeight) / Math.max(window.innerHeight, 1);
        score += (el.scrollHeight - el.clientHeight) / 200;
        return score;
      }

      /** @returns {Element|null} */
      function findScrollableTarget() {
        /** @type {Element[]} */
        const candidates = [];

        if (action.ref) {
          try {
            const el = resolveElement(action);
            let node = el;
            while (node && node !== document.body) {
              if (isScrollableEl(node)) candidates.push(node);
              node = node.parentElement;
            }
          } catch {
            /* fall through */
          }
        }

        const px = Number(action.xNorm);
        const py = Number(action.yNorm);
        const cx = Number.isFinite(px) ? px * window.innerWidth : window.innerWidth * 0.08;
        const cy = Number.isFinite(py) ? py * window.innerHeight : window.innerHeight * 0.5;
        let hit = document.elementFromPoint(cx, cy);
        while (hit && hit !== document.body) {
          if (isScrollableEl(hit)) candidates.push(hit);
          hit = hit.parentElement;
        }

        const selectors = [
          "nav",
          "aside",
          '[role="navigation"]',
          '[class*="sidebar"]',
          '[class*="side-menu"]',
          '[class*="sidemenu"]',
          '[class*="menu-scroll"]',
          '[class*="nav-scroll"]',
          '[class*="left-menu"]',
          '[class*="leftmenu"]',
        ];
        for (const sel of selectors) {
          try {
            for (const node of document.querySelectorAll(sel)) {
              if (!isVisible(node)) continue;
              if (isScrollableEl(node)) candidates.push(node);
              for (const child of node.querySelectorAll("*")) {
                if (isScrollableEl(child)) candidates.push(child);
              }
            }
          } catch {
            /* invalid selector */
          }
        }

        // Scan left strip — Vughy agency nav often lives here.
        for (const node of document.querySelectorAll("div, ul, section")) {
          if (!isVisible(node)) continue;
          const r = node.getBoundingClientRect();
          if (r.width < 40 || r.height < 120) continue;
          if (r.right > window.innerWidth * 0.42) continue;
          if (isScrollableEl(node)) candidates.push(node);
        }

        const unique = [...new Set(candidates)];
        unique.sort((a, b) => navScore(b) - navScore(a));
        return unique[0] || null;
      }

      /** @param {Element} target */
      function applyScroll(target) {
        const before = target.scrollTop;
        target.scrollTop = before + delta;
        if (target.scrollTop === before && delta !== 0) {
          target.scrollBy({ top: delta, behavior: "instant" });
        }
        try {
          const r = target.getBoundingClientRect();
          target.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: delta,
              deltaMode: 0,
              bubbles: true,
              cancelable: true,
              clientX: r.left + Math.min(24, r.width / 2),
              clientY: r.top + r.height / 2,
            })
          );
        } catch {
          /* ignore */
        }
        return { ok: true, target: target.tagName.toLowerCase(), scrollTop: target.scrollTop, before };
      }

      const target = findScrollableTarget();
      if (target) {
        return applyScroll(target);
      }
      window.scrollBy({ top: delta, behavior: "instant" });
      return { ok: true, target: "window" };
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

        // Why: many React/login forms only accept the token through the widget callback.
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

        return { ok: true, injected: "token", areas: areas.length };
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
  function isCaptchaVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 24 && rect.height > 24;
  }
  function hasVisibleSelector(selector) {
    return Array.from(document.querySelectorAll(selector)).some(isCaptchaVisible);
  }
  function detectCaptcha() {
    const signals = [];
    if (
      hasVisibleSelector(".g-recaptcha") ||
      hasVisibleSelector("iframe[src*='recaptcha']") ||
      hasVisibleSelector("iframe[src*='google.com/recaptcha']") ||
      document.querySelector("#g-recaptcha-response")
    ) {
      signals.push("recaptcha");
    }
    if (hasVisibleSelector(".h-captcha") || hasVisibleSelector("iframe[src*='hcaptcha']")) {
      signals.push("hcaptcha");
    }
    if (
      hasVisibleSelector("iframe[src*='opfcaptcha']") ||
      hasVisibleSelector("iframe[src*='arkoselabs']") ||
      hasVisibleSelector("iframe[src*='funcaptcha']")
    ) {
      signals.push("iframe_captcha");
    }
    if (
      document.querySelector(
        [
          "#auth-captcha-image",
          "#captchacharacters",
          'input[name="cvf_captcha_input"]',
          'form[action*="validateCaptcha"]',
          "#cvf-page-content",
          ".cvf-widget-form",
        ].join(",")
      ) ||
      hasVisibleSelector('img[src*="captcha"]')
    ) {
      signals.push("amazon_captcha");
    }
    const bodyText = (document.body?.innerText || "").slice(0, 5000).toLowerCase();
    if (
      /verify you are human|i'?m not a robot|complete the captcha|security check|type the characters|enter the characters you see|solve this puzzle|unusual activity|robot check|opfcaptcha/.test(
        bodyText
      ) &&
      (/captcha|puzzle|characters you see|robot/i.test(bodyText) || signals.length > 0)
    ) {
      signals.push("text_hint");
    }
    return { present: signals.length > 0, signals: [...new Set(signals)] };
  }
  function findRecaptchaSitekey() {
    const el = document.querySelector(".g-recaptcha[data-sitekey]");
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
        const m2 = json.match(/["'](6[L][0-9A-Za-z_-]{20,})["']/);
        if (m2?.[1]) return m2[1];
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  function findHcaptchaSitekey() {
    const el = document.querySelector(".h-captcha[data-sitekey]");
    const key = el?.getAttribute("data-sitekey");
    if (key && !key.startsWith("6L")) return key;
    const h = document.querySelector(".h-captcha[data-sitekey]");
    return h?.getAttribute("data-sitekey") || null;
  }
  return {
    captcha: detectCaptcha(),
    recaptchaSitekey: findRecaptchaSitekey(),
    hcaptchaSitekey: findHcaptchaSitekey(),
    pageurl: location.href,
  };
}

/**
 * Finds a visible menu item by name and returns click coordinates (macro helper).
 * @param {string} segmentName
 * @returns {object}
 */
export function clickMenuSegmentInPage(segmentName) {
  const wanted = String(segmentName || "")
    .toLowerCase()
    .trim();
  if (!wanted) return { ok: false, error: "EMPTY_SEGMENT" };

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const menus = [...document.querySelectorAll('[role="menu"]')].filter(isVisible);
  for (const menu of menus) {
    const items = menu.querySelectorAll(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
    );
    for (const el of items) {
      if (!isVisible(el)) continue;
      const name = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const lower = name.toLowerCase();
      if (lower === wanted || lower.includes(wanted) || wanted.includes(lower)) {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        const rect = el.getBoundingClientRect();
        const popup = el.getAttribute("aria-haspopup");
        const hasSubmenu = popup === "menu" || popup === "true";
        return {
          ok: true,
          name,
          hasSubmenu,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    }
  }
  return { ok: false, error: "MENU_ITEM_NOT_FOUND", segment: segmentName };
}

/**
 * Finds the filter/search field for an open searchable dropdown (React Select, Ant, MUI, etc.).
 * Why: After opening a combobox, focus may be on the combobox itself or a nested search input.
 * @returns {{ ok: boolean, x?: number, y?: number, method?: string, error?: string }}
 */
export function findSearchableFilterInPage() {
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return !["hidden", "checkbox", "radio", "file", "submit", "button", "image"].includes(type);
    }
    if (el.isContentEditable) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    return role === "textbox" || role === "searchbox" || role === "combobox";
  }

  function pointFor(el, method) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    return {
      ok: true,
      method,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  }

  const active = document.activeElement;
  if (isEditable(active) && isVisible(active)) {
    return pointFor(active, "active_element");
  }

  const overlaySelectors = [
    '[role="listbox"]',
    '[role="menu"]',
    '[role="dialog"]',
    '[data-radix-popper-content-wrapper]',
    '[data-radix-select-content]',
    '[class*="dropdown"]',
    '[class*="Dropdown"]',
    '[class*="select__menu"]',
    '[class*="Select-menu"]',
    '[class*="MuiAutocomplete-popper"]',
    '[class*="ant-select-dropdown"]',
  ];

  const overlays = overlaySelectors
    .flatMap((sel) => [...document.querySelectorAll(sel)])
    .filter(isVisible);

  for (const root of overlays) {
    const candidates = [
      ...root.querySelectorAll(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]'
      ),
    ].filter((el) => isVisible(el) && isEditable(el));
    if (candidates.length) {
      const searchy =
        candidates.find((el) =>
          /search|filter|typeahead|combobox/i.test(
            `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""} ${el.className || ""}`
          )
        ) || candidates[0];
      return pointFor(searchy, "overlay_input");
    }
  }

  const expanded = [
    ...document.querySelectorAll(
      '[role="combobox"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"], input[aria-autocomplete="list"], input[aria-autocomplete="both"]'
    ),
  ].filter((el) => isVisible(el) && isEditable(el));
  if (expanded.length) return pointFor(expanded[0], "expanded_combobox");

  return { ok: false, error: "FILTER_INPUT_NOT_FOUND" };
}

/**
 * Clicks a filtered option in an open listbox/menu/dropdown (searchable select).
 * @param {string} optionName
 * @returns {object}
 */
export function clickSearchableOptionInPage(optionName) {
  const wanted = String(optionName || "")
    .toLowerCase()
    .trim();
  if (!wanted) return { ok: false, error: "EMPTY_OPTION" };

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreMatch(name) {
    const lower = name.toLowerCase();
    if (!lower || lower === "…" || lower === "...") return -1;
    if (lower === wanted) return 100;
    if (lower.startsWith(wanted)) return 80;
    if (lower.includes(wanted)) return 60;
    if (wanted.includes(lower) && lower.length >= 3) return 40;
    return -1;
  }

  const optionSelectors = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="listbox"] [role="treeitem"]',
    "li[id]",
    '[class*="option"]',
    '[class*="Option"]',
    '[class*="MenuItem"]',
    '[class*="menu-item"]',
    '[data-value]',
  ];

  const roots = [
    ...document.querySelectorAll(
      [
        '[role="listbox"]',
        '[role="menu"]',
        '[role="dialog"]',
        '[data-radix-popper-content-wrapper]',
        '[data-radix-select-content]',
        '[class*="dropdown"]',
        '[class*="select__menu"]',
        '[class*="Select-menu"]',
        '[class*="MuiAutocomplete-popper"]',
        '[class*="ant-select-dropdown"]',
        '[data-state="open"]',
      ].join(", ")
    ),
  ].filter(isVisible);

  /** @type {{ el: Element, name: string, score: number }[]} */
  const hits = [];
  const pools = roots.length ? roots : [document.body];
  for (const root of pools) {
    for (const sel of optionSelectors) {
      for (const el of root.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        if (el.closest('input, textarea, [contenteditable="true"]')) continue;
        const name = labelOf(el);
        const score = scoreMatch(name);
        if (score < 0) continue;
        hits.push({ el, name, score });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  const best = hits[0];
  if (!best) return { ok: false, error: "OPTION_NOT_FOUND", option: optionName };

  best.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = best.el.getBoundingClientRect();
  return {
    ok: true,
    name: best.name,
    score: best.score,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}
