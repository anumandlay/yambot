/**
 * @fileoverview @mention parsing for agent dispatch / peer-ask (anywhere in the message).
 * Purpose: Resolve `@Agent Name` mid-message so chat can name a peer without leading-only @.
 * Downstream: `POST /api/chats/:id/messages` dispatch / peer_ask resolution.
 */

/**
 * @typedef {{ _id: import("mongoose").Types.ObjectId | string, name: string }} AgentRef
 * @typedef {{ agentId: string|null, agentName: string|null, strippedContent: string, matched: boolean }} MentionResult
 */

/**
 * Normalizes agent names for loose single-token @mention matching.
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
 * Parses an `@agent` mention anywhere in the message (longest name match first).
 * strippedContent = message with the `@Name` token removed.
 *
 * @param {string} content Raw user message
 * @param {AgentRef[]} agents User's agents (active)
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
    const atIdx = raw.toLowerCase().indexOf(`@${name.toLowerCase()}`);
    if (atIdx < 0) continue;
    const leadingWs = m[0].startsWith("@") ? "" : m[0][0];
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
  const atIdx = raw.toLowerCase().indexOf(`@${String(tokenMatch[1]).toLowerCase()}`);
  const tokenLen = String(tokenMatch[1]).length;
  const from = atIdx > 0 && /\s/.test(raw[atIdx - 1]) ? atIdx - 1 : atIdx;
  const to = atIdx + 1 + tokenLen;
  const stripped = `${raw.slice(0, Math.max(0, from))}${raw.slice(to)}`
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    agentId: String(agent._id),
    agentName: agent.name,
    strippedContent: stripped || raw,
    matched: true,
  };
}
