/**
 * @fileoverview System page — Docker container inventory + live CPU charts.
 * Purpose: Ops view of VPS boxes (compose stack + agent computers) and processor load.
 * Downstream: `/api/system/overview` → computer-manager Docker stats.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

const HISTORY_LEN = 40;

/**
 * @param {string} name
 * @returns {"agent"|"platform"|"other"}
 */
function containerKind(name) {
  const n = String(name || "");
  if (/^yambot-agent-/i.test(n)) return "agent";
  if (/research-scraper|computer-manager|worker-image|^deploy-(api|frontend|mongo)-/i.test(n)) {
    return "platform";
  }
  return "other";
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Simple SVG sparkline / area chart for CPU history (0–100).
 * @param {{ values: number[], color?: string, label?: string, height?: number }} props
 */
function CpuChart({ values, color = "#0f766e", label = "CPU", height = 120 }) {
  const w = 640;
  const h = height;
  const pad = 8;
  const pts = values.length
    ? values.map((v, i) => {
        const x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
        const y = pad + (1 - Math.min(100, Math.max(0, v)) / 100) * (h - pad * 2);
        return `${x},${y}`;
      })
    : [`${pad},${h - pad}`, `${w - pad},${h - pad}`];
  const line = pts.join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const latest = values.length ? values[values.length - 1] : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-teal-950">{label}</span>
        <span className="font-mono text-lg font-bold text-teal-800">{latest.toFixed(1)}%</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-28 w-full rounded-xl bg-slate-950/95 sm:h-36"
        role="img"
        aria-label={`${label} history`}
      >
        <defs>
          <linearGradient id={`g-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((p) => {
          const y = pad + (1 - p / 100) * (h - pad * 2);
          return (
            <line
              key={p}
              x1={pad}
              x2={w - pad}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          );
        })}
        <polygon points={area} fill={`url(#g-${label.replace(/\s/g, "")})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function SystemPage() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [hostHistory, setHostHistory] = useState([]);
  /** @type {[Record<string, number[]>, Function]} */
  const [boxHistory, setBoxHistory] = useState({});
  const [busyStop, setBusyStop] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await api("/api/system/overview");
        if (cancelled) return;
        setOverview(data);
        setError(null);
        const cpu = Number(data.host?.cpuPercent) || 0;
        setHostHistory((prev) => [...prev, cpu].slice(-HISTORY_LEN));

        setBoxHistory((prev) => {
          /** @type {Record<string, number[]>} */
          const next = {};
          for (const c of data.containers || []) {
            if (c.state !== "running") continue;
            const key = c.name || c.id;
            next[key] = [...(prev[key] || []), Number(c.cpuPercent) || 0].slice(-HISTORY_LEN);
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll intentionally ignores boxHistory deps
  }, []);

  const topBoxes = useMemo(() => {
    const list = (overview?.containers || [])
      .filter((c) => c.state === "running")
      .slice()
      .sort((a, b) => (b.cpuPercent || 0) - (a.cpuPercent || 0));
    return list.slice(0, 4);
  }, [overview]);

  /**
   * @param {string} name
   */
  async function stopContainer(name) {
    if (!window.confirm(`Stop and remove container “${name}”?`)) return;
    setBusyStop(name);
    setError(null);
    try {
      await api("/api/system/stop", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const data = await api("/api/system/overview");
      setOverview(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusyStop("");
    }
  }

  const host = overview?.host;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">System</h1>
        <p className="text-sm text-teal-900/70">
          Live Docker containers on the VPS and processor load. Refreshes every few seconds.
        </p>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {host ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">Host</div>
            <div className="mt-1 truncate font-semibold">{host.name}</div>
            <div className="text-sm text-teal-900/70">{host.cpus} CPUs</div>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">
              Containers
            </div>
            <div className="mt-1 font-semibold">
              {host.containersRunning} running / {host.containersTotal} total
            </div>
            <div className="text-sm text-teal-900/70">
              {host.containersStopped ?? 0} stopped
            </div>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">
              Memory (host)
            </div>
            <div className="mt-1 font-semibold">{fmtBytes(host.memTotal)}</div>
            <div className="text-sm text-teal-900/70">
              free ≈ {fmtBytes(host.freemem)} (manager view)
            </div>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">
              Load avg
            </div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {(host.loadavg || []).map((n) => Number(n).toFixed(2)).join(" · ") || "—"}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-teal-900/60">Loading system snapshot…</p>
      )}

      <section className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-900/70">
          Processor
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <CpuChart values={hostHistory} label="Host CPU (approx)" color="#0f766e" />
          {topBoxes.map((c, i) => (
            <CpuChart
              key={c.name || c.id}
              values={boxHistory[c.name || c.id] || []}
              label={c.name || c.id}
              color={["#b45309", "#0369a1", "#7c3aed", "#be123c"][i % 4]}
            />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
        <div className="border-b border-teal-100 px-3 py-3 sm:px-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/70">
            Containers
          </h2>
        </div>
        <div className="yb-scroll-x overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-teal-50/80 text-xs uppercase tracking-wide text-teal-900/60">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">State</th>
                <th className="px-3 py-2 font-semibold">CPU</th>
                <th className="px-3 py-2 font-semibold">Memory</th>
                <th className="px-3 py-2 font-semibold">Image</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.containers || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-teal-900/60">
                    No containers reported yet.
                  </td>
                </tr>
              ) : (
                (overview?.containers || []).map((c) => {
                  const canStop = /^yambot-agent-/i.test(c.name || "");
                  const kind = containerKind(c.name);
                  return (
                    <tr key={c.id} className="border-t border-teal-50 align-top">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-teal-950">{c.name || c.id}</div>
                        <div className="font-mono text-[0.7rem] text-teal-800/50">{c.id}</div>
                        {c.labels?.["yambot.agentId"] ? (
                          <div className="text-[0.7rem] text-teal-800/60">
                            agent {c.labels["yambot.agentId"]}
                          </div>
                        ) : null}
                        {kind === "platform" ? (
                          <div className="text-[0.7rem] text-amber-800/80">
                            Shared platform service (not tied to one agent)
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${
                            c.state === "running"
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {c.state}
                        </span>
                        <div className="mt-1 max-w-[12rem] truncate text-[0.7rem] text-teal-800/50">
                          {c.status}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {c.state === "running" ? `${Number(c.cpuPercent || 0).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {c.state === "running"
                          ? `${fmtBytes(c.memUsage)}${c.memLimit ? ` / ${fmtBytes(c.memLimit)}` : ""}`
                          : "—"}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-teal-900/70">
                        {c.image}
                      </td>
                      <td className="px-3 py-2">
                        {canStop && c.state === "running" ? (
                          <button
                            type="button"
                            disabled={busyStop === c.name}
                            onClick={() => stopContainer(c.name)}
                            className="inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                          >
                            {busyStop === c.name ? "Stopping…" : "Stop"}
                          </button>
                        ) : (
                          <span className="text-xs text-teal-800/40">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {overview?.at ? (
          <p className="border-t border-teal-50 px-3 py-2 text-[0.7rem] text-teal-800/50">
            Updated {new Date(overview.at).toLocaleString()}
          </p>
        ) : null}
      </section>
    </div>
  );
}
