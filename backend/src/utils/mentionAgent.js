/**
 * @fileoverview @mention parsing for common-chat agent dispatch.
 * Purpose: Resolve `@Agent Name goal text` to a worker without manual picker every time.
 * Downstream: `POST /api/chats/:id/messages` dispatch resolution.
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
 * Parses a leading `@agent` mention against the user's active agents.
 * Why: longest name match first so `@CRM Bot` wins over `@CRM`.
 *
 * @param {string} content Raw user message
 * @param {AgentRef[]} agents User's agents (active)
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
    const stripped = tail.trimStart();
    return {
      agentId: String(agent._id),
      agentName: agent.name,
      strippedContent: stripped,
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
