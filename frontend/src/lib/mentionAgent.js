/**
 * @fileoverview Client-side @mention preview for common chat compose box.
 * Purpose: Mirror server dispatch rules so the picker updates as the user types.
 * Downstream: ChatDetailPage agent picker + send validation.
 */

/**
 * @typedef {{ _id: string, name: string }} AgentRef
 * @typedef {{ agentId: string|null, agentName: string|null, strippedContent: string, matched: boolean }} MentionResult
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
 * @param {string} content
 * @param {AgentRef[]} agents
 * @returns {MentionResult}
 */
export function resolveAgentMention(content, agents) {
  const raw = String(content || "").trim();
  if (!raw.startsWith("@") || !agents?.length) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const sorted = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const agent of sorted) {
    const prefix = `@${agent.name}`;
    if (!raw.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const tail = raw.slice(prefix.length);
    if (tail.length > 0 && !tail.startsWith(" ")) continue;
    return {
      agentId: String(agent._id),
      agentName: agent.name,
      strippedContent: tail.trimStart(),
      matched: true,
    };
  }

  const tokenMatch = raw.match(/^@(\S+)(?:\s+([\s\S]*))?$/);
  if (!tokenMatch) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const token = normalizeToken(tokenMatch[1]);
  const rest = String(tokenMatch[2] || "").trim();
  if (!token) {
    return { agentId: null, agentName: null, strippedContent: raw, matched: false };
  }

  const hits = agents.filter((agent) => {
    const nameNorm = normalizeToken(agent.name);
    const firstWord = normalizeToken(agent.name.split(/\s+/)[0]);
    return nameNorm.startsWith(token) || firstWord.startsWith(token) || token.startsWith(firstWord);
  });

  if (hits.length === 1) {
    return {
      agentId: String(hits[0]._id),
      agentName: hits[0].name,
      strippedContent: rest,
      matched: true,
    };
  }

  return { agentId: null, agentName: null, strippedContent: raw, matched: false };
}
