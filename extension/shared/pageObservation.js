/**
 * @fileoverview Page observation helpers shared by extension + worker mirrors.
 * Purpose: Normalize DOM snapshots before storing on Task events for the website UI.
 * Downstream: extension `mirrorCloudEvent`; worker `sanitizePageObservation` in pageDom.
 */

/**
 * Strips observation for API/event storage (bounded text, plain objects).
 * @param {object|null|undefined} obs
 * @param {object} [extras]
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
    structures: obs.structures || undefined,
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
          frameId: el.frameId,
          shadowHost: el.shadowHost,
          nearbyText: el.nearbyText,
        }))
      : [],
    text: String(obs.text || "").slice(0, 8000),
    interactiveCount: Array.isArray(obs.interactives) ? obs.interactives.length : 0,
    plan: extras.plan || undefined,
    progress: extras.progress || undefined,
    capturedAt: new Date().toISOString(),
  };
}
