/**
 * Unread reply counts ignore history from before the chat was first opened.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withUnreadCounts } from "../src/utils/chatUnread.js";

test("unread counts attach only after a chat has been opened once", () => {
  const rows = withUnreadCounts(
    [
      { _id: "a", kind: "agent", lastReadAt: new Date("2026-09-29T12:00:00Z") },
      { _id: "b", kind: "agent", lastReadAt: null },
      { _id: "c", kind: "common", lastReadAt: new Date() },
    ],
    [
      { _id: "a", n: 2 },
      { _id: "b", n: 9 },
    ]
  );
  assert.equal(rows[0].unreadCount, 2);
  assert.equal(rows[1].unreadCount, 0);
  assert.equal(rows[2].unreadCount, 0);
});
