/**
 * @fileoverview Unread reply counts for the Grok agent list.
 * Purpose: A reply the user has not opened yet shows as a number on that agent.
 * Downstream: GET /api/chats, GrokStylePage.
 */

/**
 * Attach unreadCount onto chat list rows.
 * A chat with no lastReadAt is treated as already seen so old history does not light up.
 * @param {object[]} chats
 * @param {{ _id: unknown, n: number }[]} countRows
 * @returns {object[]}
 */
export function withUnreadCounts(chats, countRows) {
  const byId = new Map((countRows || []).map((row) => [String(row._id), Number(row.n) || 0]));
  return (chats || []).map((chat) => ({
    ...chat,
    unreadCount: !chat?.lastReadAt || chat.kind === "common" ? 0 : byId.get(String(chat._id)) || 0,
  }));
}
