/**
 * @fileoverview Vision attachment policy — when to send viewport screenshots to the LLM.
 * Purpose: Correlate refs with visual layout on failure or ambiguous steps (not every step).
 * Downstream: agent.js LLM message builder.
 */

/**
 * Decides whether this step should include a viewport image for the LLM.
 * @param {{ step: number, result?: object, verificationFailed?: boolean, force?: boolean, interval?: number }} params
 * @returns {boolean}
 */
export function shouldAttachVision({
  step,
  result,
  verificationFailed = false,
  force = false,
  interval = 12,
}) {
  if (force) return true;
  if (verificationFailed) return true;
  if (result?.verification?.passed === false) return true;
  if (result?.failure_class && result.failure_class !== "UNKNOWN") return true;
  if (result?.recovery === false && result?.recovery_attempts?.length) return true;
  if (interval > 0 && step > 0 && step % interval === 0) return true;
  return false;
}

/**
 * Captures viewport JPEG as base64 for multimodal LLM input.
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
export async function captureViewportBase64(page) {
  if (!page || page.isClosed()) return "";
  const buf = await page.screenshot({ type: "jpeg", quality: 48, fullPage: false });
  return Buffer.from(buf).toString("base64");
}

/**
 * Builds OpenAI-compatible multimodal user content.
 * @param {string} text
 * @param {string} imageBase64
 * @returns {object[]}
 */
export function buildVisionUserContent(text, imageBase64) {
  if (!imageBase64) return text;
  return [
    { type: "text", text: `${text}\n\n[Viewport screenshot attached — correlate refs with visible UI.]` },
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
    },
  ];
}
