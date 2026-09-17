/**
 * @fileoverview Live Wall — all cloud agent screens with Zoom / Take control.
 * Purpose: Remote-desktop overview; red blink when CAPTCHA / ask_user needs you.
 * Downstream: GET /api/agents/live-wall + LiveScreen control APIs; agent groups for tree layout.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";
import { buildGroupedSections } from "../lib/groupedList.js";

export function LiveWallPage() {
  const [screens, setScreens] = useState([]);
  const [groups, setGroups] = useState([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const [data, groupData] = await Promise.all([
          api("/api/agents/live-wall"),
          api("/api/groups?type=agent").catch(() => ({ groups: [] })),
        ]);
        if (cancelled) return;
        setScreens(data.screens || []);
        setGroups(groupData.groups || []);
        setAttentionCount(Number(data.attentionCount) || 0);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tree = useMemo(() => {
    const { sections, ungrouped } = buildGroupedSections(
      screens,
      groups,
      (s) => (s.groupId ? String(s.groupId) : null)
    );
    return {
      sections: sections.filter((s) => s.items.length > 0),
      ungrouped,
    };
  }, [screens, groups]);

  /**
   * @param {object[]} list
   */
  function renderScreenGrid(list) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => (
          <div key={s.id} className="flex min-h-0 flex-col gap-2">
            <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <AgentAvatar
                  agent={{
                    name: s.name,
                    avatarMime: s.avatarMime,
                    avatarBase64: s.avatarBase64,
                  }}
                  size="sm"
                />
                <Link
                  to={`/agents/${s.id}`}
                  className="min-w-0 truncate text-sm font-bold text-teal-950 hover:underline"
                >
                  {s.name}
                </Link>
                <Link
                  to={`/agents/${s.id}/memory`}
                  className="shrink-0 text-xs font-semibold text-violet-800 hover:underline"
                >
                  View memory
                </Link>
              </div>
              <span
                className={`shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide ${
                  s.needsAttention
                    ? "text-red-600"
                    : s.online
                      ? "text-emerald-700"
                      : "text-teal-900/50"
                }`}
              >
                {s.needsAttention ? "Attention" : s.online ? "Online" : "Offline"}
              </span>
            </div>
            <LiveScreen
              agentId={s.id}
              agentName={s.name}
              compact
              wallMode
              attention={Boolean(s.needsAttention)}
              attentionReason={s.attentionReason || ""}
              className="min-h-[16rem] sm:min-h-[18rem]"
            />
            {s.pageUrl ? (
              <p className="truncate px-0.5 text-[0.7rem] text-teal-900/50" title={s.pageUrl}>
                {s.pageUrl}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  const useTree = groups.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Live Wall</h1>
          <p className="text-sm text-teal-900/70">
            All cloud computers{useTree ? ", grouped by agent folder" : ""}. Use{" "}
            <strong>Zoom</strong> and <strong>Take control</strong> like a remote desktop. Screens
            that need you (CAPTCHA, questions) blink red.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attentionCount > 0 ? (
            <span className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-3 text-sm font-bold text-white">
              {attentionCount} need{attentionCount === 1 ? "s" : ""} you
            </span>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900/70">
              All clear
            </span>
          )}
          <Link
            to="/agents"
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900"
          >
            Agents
          </Link>
        </div>
      </div>

      <PageGuideBanner helpId="live.page" />

      {error ? <ErrorAlert error={error} /> : null}

      {!screens.length && !error ? (
        <p className="rounded-2xl border border-teal-100 bg-white/80 p-6 text-sm text-teal-900/70">
          No cloud agents yet.{" "}
          <Link to="/agents/new" className="font-semibold text-teal-800 underline">
            Create an agent
          </Link>{" "}
          to provision a computer.
        </p>
      ) : null}

      {screens.length && useTree ? (
        <div className="flex flex-col gap-4">
          {tree.sections.map((section) => {
            const key = String(section.group._id);
            const open = !collapsed.has(key);
            return (
              <section key={key} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/50 px-3 text-left"
                  aria-expanded={open}
                  onClick={() => {
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                >
                  <span className="w-4 text-teal-700" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="text-sm font-bold uppercase tracking-wide text-teal-800/80">
                    {section.group.name || "Group"}
                    <span className="ml-2 font-semibold normal-case tracking-normal text-teal-900/50">
                      ({section.items.length})
                    </span>
                  </span>
                </button>
                {open ? renderScreenGrid(section.items) : null}
              </section>
            );
          })}
          {tree.ungrouped.length ? (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/50 px-3 text-left"
                aria-expanded={!collapsed.has("ungrouped")}
                onClick={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has("ungrouped")) next.delete("ungrouped");
                    else next.add("ungrouped");
                    return next;
                  });
                }}
              >
                <span className="w-4 text-teal-700" aria-hidden>
                  {!collapsed.has("ungrouped") ? "▾" : "▸"}
                </span>
                <span className="text-sm font-bold uppercase tracking-wide text-teal-800/80">
                  Ungrouped
                  <span className="ml-2 font-semibold normal-case tracking-normal text-teal-900/50">
                    ({tree.ungrouped.length})
                  </span>
                </span>
              </button>
              {!collapsed.has("ungrouped") ? renderScreenGrid(tree.ungrouped) : null}
            </section>
          ) : null}
        </div>
      ) : screens.length ? (
        renderScreenGrid(screens)
      ) : null}
    </div>
  );
}
