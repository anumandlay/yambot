/**
 * @fileoverview Chat message body with clickable URLs + Composio Connect button.
 * Purpose: Phase-2 — OAuth redirect links in assistant replies must be one-click.
 * Downstream: ChatDetailPage.
 */

import { looksLikeComposioConnectUrl, splitTextWithUrls } from "../lib/chatMessageLinks.js";

/**
 * @param {{ text: string, className?: string }} props
 */
export function ChatMessageBody({ text, className = "" }) {
  const parts = splitTextWithUrls(text);
  const connectLinks = parts.filter(
    (p) => p.type === "link" && looksLikeComposioConnectUrl(p.value)
  );

  return (
    <div className={className}>
      <div className="whitespace-pre-wrap break-words">
        {parts.map((p, i) =>
          p.type === "link" ? (
            <a
              key={`l-${i}`}
              href={p.value}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-semibold text-teal-800 underline decoration-teal-600/50 underline-offset-2 hover:text-teal-950"
            >
              {p.value}
            </a>
          ) : (
            <span key={`t-${i}`}>{p.value}</span>
          )
        )}
      </div>
      {connectLinks.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {connectLinks.map((p, i) => (
            <a
              key={`c-${i}`}
              href={p.value}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800"
            >
              Connect app
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
