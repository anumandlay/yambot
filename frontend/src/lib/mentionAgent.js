/**
 * @fileoverview Client-side @mention preview for chat compose (common + agent peer-ask).
 * Purpose: Suggest agents while typing `@` anywhere in the compose box (not only at start).
 * Downstream: ChatDetailPage agent picker + send validation.
 */

/**
 * @typedef {{ _id: string, name: string, skill?: string, mode?: string }} AgentRef
 * @typedef {{ agentId: string|null, agentName: string|null, strippedContent: string, matched: boolean }} MentionResult
 * @typedef {{ open: boolean, query: string, start: number, end: number }} MentionComposeState
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the compose box is mid-@mention at the cursor (show agent list).
 * Why: allow `check site then @Web…` — not only a leading `@`.
 * @param {string} content
 * @param {number} [cursorPos] — selection start; defaults to end of content
 * @returns {MentionComposeState}
 */
export function getMentionComposeState(content, cursorPos) {
  const raw = String(content || "");
  const pos =
    cursorPos == null || !Number.isFinite(cursorPos)
      ? raw.length
      : Math.max(0, Math.min(Number(cursorPos), raw.length));
  const before = raw.slice(0, pos);
  // Why: require start-or-whitespace before @ so emails like a@b.com do not open the picker.
  const m = before.match(/(?:^|[\s\n])@([^\s@]*)$/);
  if (!m) return { open: false, query: "", start: -1, end: pos };
  const start = before.lastIndexOf("@");
  return { open: true, query: m[1] || "", start, end: pos };
}

/**
 * Agents matching the in-progress @query (empty query = all).
 * @param {string} content
 * @param {AgentRef[]} agents
 * @param {number} [cursorPos]
 * @returns {AgentRef[]}
 */
export function listMentionSuggestions(content, agents, cursorPos) {
  const { open, query } = getMentionComposeState(content, cursorPos);
  if (!open || !agents?.length) return [];
  const q = normalizeToken(query);
  const list = [...agents].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
  if (!q) return list;
  return list.filter((agent) => {
    const nameNorm = normalizeToken(agent.name);
    const firstWord = normalizeToken(String(agent.name || "").split(/\s+/)[0]);
    const skillNorm = normalizeToken(agent.skill);
    return (
      nameNorm.includes(q) ||
      nameNorm.startsWith(q) ||
      firstWord.startsWith(q) ||
      skillNorm.includes(q)
    );
  });
}

/**
 * Replace the in-progress `@query` with `@AgentName `.
 * @param {string} content
 * @param {string} agentName
 * @param {number} start
 * @param {number} end
 * @returns {{ text: string, cursor: number }}
 */
export function insertMentionAt(content, agentName, start, end) {
  const raw = String(content || "");
  const name = String(agentName || "").trim();
  if (!name || start < 0) {
    return { text: raw, cursor: raw.length };
  }
  const before = raw.slice(0, start);
  const after = raw.slice(Math.max(end, start));
  const inserted = `@${name} `;
  const text = `${before}${inserted}${after}`;
  return { text, cursor: before.length + inserted.length };
}

/**
 * Resolve `@Agent` anywhere in the message (longest name wins).
 * strippedContent = full message with the `@Name` token removed.
 * @param {string} content
 * @param {AgentRef[]} agents
 * @returns {MentionResult}
 */
export function resolveAgentMention(content, agents) {
  const raw = String(content || "").trim();
  if (!raw.includes("@") || !agents?.length) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const sorted = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const agent of sorted) {
    const name = String(agent.name || "");
    if (!name) continue;
    const re = new RegExp(`(^|[\\s\\n])@(${escapeRegExp(name)})(?=$|[\\s\\n])`, "i");
    const m = raw.match(re);
    if (!m) continue;
    const full = m[0];
    const atIdx = raw.toLowerCase().indexOf(`@${name.toLowerCase()}`);
    if (atIdx < 0) continue;
    const leadingWs = full.startsWith("@") ? "" : full[0];
    const from = atIdx - (leadingWs ? 1 : 0);
    const to = atIdx + 1 + name.length;
    const stripped = `${raw.slice(0, Math.max(0, from))}${raw.slice(to)}`
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      agentId: String(agent._id),
      agentName: agent.name,
      strippedContent: stripped,
      matched: true,
    };
  }

  // Loose single-token @Website when unique among agents (leading or mid).
  const tokenMatch = raw.match(/(?:^|[\s\n])@(\S+)/);
  if (!tokenMatch) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }
  const token = normalizeToken(tokenMatch[1]);
  if (!token) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }
  const hits = agents.filter((agent) => {
    const nameNorm = normalizeToken(agent.name);
    const firstWord = normalizeToken(String(agent.name || "").split(/\s+/)[0]);
    return nameNorm.startsWith(token) || firstWord.startsWith(token) || token.startsWith(firstWord);
  });
  if (hits.length !== 1) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }
  const agent = hits[0];
  const name = String(agent.name || "");
  const atIdx = raw.toLowerCase().indexOf(`@${String(tokenMatch[1]).toLowerCase()}`);
  const tokenLen = String(tokenMatch[1]).length;
  const from = atIdx > 0 && /\s/.test(raw[atIdx - 1]) ? atIdx - 1 : atIdx;
  const to = atIdx + 1 + tokenLen;
  const stripped = `${raw.slice(0, Math.max(0, from))}${raw.slice(to)}`
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    agentId: String(agent._id),
    agentName: name,
    strippedContent: stripped || raw,
    matched: true,
  };
}
