/**
 * @fileoverview Learning Mode explain chain — trigger → policy → employee → action → result.
 * Purpose: Visual step-through of why a run happened (trust / debugging).
 * Downstream: AgentRunsPage, CommandCenterPage.
 */

/**
 * @param {{
 *   chain?: { stage: string, summary: string, detail?: string }[],
 *   howHumanWouldConfigure?: string[],
 *   narrative?: string,
 *   correlationId?: string|null,
 *   onClose?: () => void,
 * }} props
 */
export function ExplainChainPanel({
  chain = [],
  howHumanWouldConfigure = [],
  narrative = "",
  correlationId = null,
  onClose,
}) {
  if (!chain?.length && !narrative) return null;

  const stageColor = {
    trigger: "border-violet-200 bg-violet-50 text-violet-950",
    policy: "border-slate-200 bg-slate-50 text-slate-900",
    employee: "border-teal-200 bg-teal-50 text-teal-950",
    data: "border-sky-200 bg-sky-50 text-sky-950",
    action: "border-amber-200 bg-amber-50 text-amber-950",
    result: "border-emerald-200 bg-emerald-50 text-emerald-950",
  };

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-indigo-950">Why this happened</h3>
          {correlationId ? (
            <p className="mt-0.5 font-mono text-[0.65rem] text-indigo-800/60">{correlationId}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="text-xs font-semibold text-indigo-800 underline"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </div>
      {narrative ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-indigo-100 bg-white p-2 text-xs text-indigo-950">
          {narrative}
        </pre>
      ) : null}
      <ol className="mt-3 flex flex-col gap-2">
        {chain.map((c, i) => (
          <li
            key={`${c.stage}-${i}`}
            className={`rounded-xl border px-3 py-2 text-sm ${stageColor[c.stage] || stageColor.policy}`}
          >
            <div className="text-[0.65rem] font-bold uppercase tracking-wide opacity-70">
              {i + 1}. {c.stage}
            </div>
            <div className="font-semibold">{c.summary}</div>
            {c.detail ? <p className="mt-1 text-xs opacity-80">{c.detail}</p> : null}
          </li>
        ))}
      </ol>
      {howHumanWouldConfigure?.length ? (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-white p-3">
          <h4 className="text-xs font-bold uppercase text-indigo-900/70">
            How a human would configure this
          </h4>
          <ul className="mt-1 list-inside list-disc text-xs text-indigo-950">
            {howHumanWouldConfigure.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
