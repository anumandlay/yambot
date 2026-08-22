/**
 * @fileoverview Page observation helpers shared by extension + worker mirrors.
 * Purpose: Normalize DOM snapshots before storing on Task events for the website UI.
 * Downstream: extension `mirrorCloudEvent`; worker `sanitizePageObservation` in pageDom.
 */

/**
 * Strips observation for API/event storage (bounded text, plain objects).
 * @param {object|null|undefined} obs
 * @returns {object|null}
 */
export function sanitizePageObservation(obs) {
  if (!obs || typeof obs !== "object") return null;
  return {
    url: String(obs.url || ""),
    title: String(obs.title || ""),
    captcha: obs.captcha || { present: false, signals: [] },
    openMenus: Array.isArray(obs.openMenus) ? obs.openMenus : [],
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
        }))
      : [],
    text: String(obs.text || "").slice(0, 8000),
    interactiveCount: Array.isArray(obs.interactives) ? obs.interactives.length : 0,
    capturedAt: new Date().toISOString(),
  };
}
