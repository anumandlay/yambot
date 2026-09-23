/**
 * @fileoverview Small status chips under normal chat bubbles (Auto / Composio / timing).
 * Purpose: Run ops already have ≡ chips; Auto replies were plain text only — surface the same style of cues.
 * Downstream: ChatDetailPage, FloatingChatWidget.
 */

/**
 * Short label for a hermesTiming lookup name.
 * @param {string} name
 * @returns {{ icon: string, label: string }}
 */
function lookupChip(name) {
  const n = String(name || "").toLowerCase();
  if (n.startsWith("composio")) {
    const short = n.replace(/^composio_/, "").replace(/_/g, " ");
    return { icon: "C", label: short || "composio" };
  }
  if (n.includes("peer")) return { icon: "⇄", label: "peers" };
  if (n.includes("status")) return { icon: "?", label: "status" };
  return { icon: "⚡", label: n.slice(0, 14) || "tool" };
}

/**
 * Build chip descriptors from a chat message meta blob.
 * @param {object} message
 * @returns {{ key: string, icon: string, label: string, title: string }[]}
 */
export function messageStatusChipsFromMeta(message) {
  const meta = message?.meta && typeof message.meta === "object" ? message.meta : {};
  /** @type {{ key: string, icon: string, label: string, title: string }[]} */
  const chips = [];

  const isAuto =
    Boolean(meta.hermesAuto) ||
    meta.kind === "chat_qa" ||
    meta.intent === "question";
  if (isAuto && (message.role === "assistant" || message.role === "agent")) {
    chips.push({
      key: "auto",
      icon: "A",
      label: "Auto",
      title: String(meta.intentReason || "Answered in chat (no computer)"),
    });
  }

  const timing = meta.hermesTiming && typeof meta.hermesTiming === "object" ? meta.hermesTiming : null;
  const lookups = Array.isArray(timing?.lookups) ? timing.lookups : [];
  const seen = new Set();
  for (let i = 0; i < lookups.length; i++) {
    const raw = String(lookups[i] || "");
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const { icon, label } = lookupChip(raw);
    chips.push({
      key: `lookup-${i}-${raw}`,
      icon,
      label,
      title: `Tool: ${raw}`,
    });
  }

  if (timing && (timing.totalMs != null || timing.decisionMs != null)) {
    const ms = Number(timing.totalMs ?? timing.decisionMs) || 0;
    if (ms > 0) {
      const sec = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
      chips.push({
        key: "timing",
        icon: "⏱",
        label: sec,
        title: [
          timing.path ? `path=${timing.path}` : null,
          timing.decisionAction ? `decision=${timing.decisionAction}` : null,
          lookups.length ? `lookups=${lookups.join(",")}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Auto timing",
      });
    }
  }

  if (meta.rememberSaved) {
    chips.push({
      key: "remember",
      icon: "M+",
      label: "Saved",
      title: "Remembered to memory / Mem0",
    });
  }

  if (meta.answeredWhileBusy) {
    chips.push({
      key: "busy",
      icon: "…",
      label: "Busy",
      title: "Answered while a computer run was still active",
    });
  }

  return chips;
}

/**
 * @param {{ message: object, tone?: "light"|"dark" }} props
 */
export function MessageStatusChips({ message, tone = "light" }) {
  const chips = messageStatusChipsFromMeta(message);
  if (!chips.length) return null;

  const onDark = tone === "dark";
  return (
    <div
      className={`mt-1.5 flex flex-wrap items-center gap-1 ${onDark ? "opacity-95" : ""}`}
      aria-label="Message status"
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          title={c.title}
          aria-label={c.title}
          className={`yb-ops-chip yb-ops-chip--label inline-flex cursor-default items-center justify-center rounded-full border font-semibold ${
            onDark
              ? "border-white/30 bg-white/15 text-white"
              : "border-teal-100 bg-teal-50/90 text-teal-900"
          }`}
        >
          <span aria-hidden="true">{c.icon}</span>
          <span className="capitalize">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
