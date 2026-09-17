/**
 * @fileoverview Collapsible group folder for agent tree lists.
 * Purpose: Shared chrome for Grok / Chats / Agents-style group → agent trees.
 * Downstream: GrokStylePage, ChatsPage, LiveWallPage.
 */

/**
 * @param {object} props
 * @param {string} props.label
 * @param {number} [props.count]
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function AgentGroupFolder({ label, count, open, onToggle, children, className = "" }) {
  return (
    <li className={`overflow-hidden rounded-xl border border-teal-100 bg-teal-50/40 ${className}`}>
      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="w-4 shrink-0 text-teal-700" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-teal-800/80">
          {label}
          {typeof count === "number" ? (
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-teal-900/50">
              ({count})
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5 border-t border-teal-100/80 bg-white/90 p-1.5">{children}</ul>
      ) : null}
    </li>
  );
}
