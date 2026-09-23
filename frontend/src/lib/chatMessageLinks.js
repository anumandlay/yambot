/**
 * @fileoverview Turn plain URLs in chat text into clickable links (Composio OAuth, etc.).
 * Purpose: Phase-2 Composio connect replies include https redirect URLs; users must click them.
 * Downstream: ChatMessageBody.
 */

/**
 * Split text into text/link segments for React rendering.
 * @param {string} text
 * @returns {{ type: "text"|"link", value: string }[]}
 */
export function splitTextWithUrls(text) {
  const raw = String(text || "");
  if (!raw) return [];
  const re = /(https?:\/\/[^\s<>"')\]]+)/g;
  /** @type {{ type: "text"|"link", value: string }[]} */
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push({ type: "text", value: raw.slice(last, m.index) });
    }
    let url = m[1];
    let trailing = "";
    const edge = url.match(/^(.*?)([.,;:!?]+)$/);
    if (edge && edge[1].length > 12) {
      url = edge[1];
      trailing = edge[2];
    }
    parts.push({ type: "link", value: url });
    if (trailing) parts.push({ type: "text", value: trailing });
    last = m.index + m[1].length;
  }
  if (last < raw.length) parts.push({ type: "text", value: raw.slice(last) });
  return parts.length ? parts : [{ type: "text", value: raw }];
}

/**
 * Whether a URL looks like a Composio / OAuth connect link.
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikeComposioConnectUrl(url) {
  return /composio|oauth|accounts\.google|slack\.com\/oauth|github\.com\/login\/oauth/i.test(
    String(url || "")
  );
}
