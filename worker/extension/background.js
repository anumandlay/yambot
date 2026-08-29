/**
 * @fileoverview MV3 service worker — keep-alive + optional debug logging.
 * Purpose: Required by Chrome MV3; recording lives in content.js (page DOM access).
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log("[yambot-teach] extension installed");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ ok: true, name: "yambot-teach" });
    return true;
  }
  return false;
});
