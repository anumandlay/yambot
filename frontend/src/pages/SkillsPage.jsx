/**
 * @fileoverview Skills dashboard — Teach skill drafts, manual library, training requests.
 * Purpose: Show skills you authored plus built-in system skill templates (login, shopping, …).
 * Auto Suggested:* drafts from old task runs are purged on load; run-learned skills show workflow key.
 * Downstream: `/api/skills`, LiveScreen Teach skill, SkillEditPage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";

/**
 * @param {string|undefined} value
 * @returns {string}
 */
function formatCreated(value) {
  const text = formatChatMessageTime(value);
  return text ? `Created ${text}` : "";
}

/**
 * @param {object} skill
 * @returns {boolean}
 */
function isLearnedSkill(skill) {
  return Boolean(skill?.learnedFromRun || skill?.workflowKey || skill?.sourceTask);
}

export function SkillsPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [systemSkills, setSystemSkills] = useState([]);
  const [training, setTraining] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [skillName, setSkillName] = useState("");
  const [showAllTraining, setShowAllTraining] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [expandedSystemId, setExpandedSystemId] = useState("");

  const load = useCallback(async () => {
    const trainingPath = showAllTraining ? "/api/skills/training" : "/api/skills/training?status=pending";
    const [sk, tr] = await Promise.all([api("/api/skills"), api(trainingPath)]);
    setSkills(sk.skills || []);
    setSystemSkills(sk.systemSkills || []);
    setTraining(tr.requests || []);
  }, [showAllTraining]);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  const { activeSkills, deprecatedSkills } = useMemo(() => {
    const active = [];
    const deprecated = [];
    for (const s of skills) {
      if (s.status === "deprecated") deprecated.push(s);
      else active.push(s);
    }
    return { activeSkills: active, deprecatedSkills: deprecated };
  }, [skills]);

  async function createSkill(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      const created = await api("/api/skills", {
        method: "POST",
        body: JSON.stringify({ name: skillName.trim() || "Skill", steps: [] }),
      });
      setSkillName("");
      setOkMsg("Skill created.");
      navigate(`/skills/${created.skill._id}`);
    } catch (err) {
      setError(err);
    }
  }

  async function resolveTraining(id, status, skillId = null) {
    setError(null);
    try {
      await api(`/api/skills/training/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status, skillId }),
      });
      setOkMsg(status === "dismissed" ? "Training request dismissed." : "Training request updated.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {object} skill
   * @param {"draft"|"production"|"deprecated"} status
   */
  async function setSkillStatus(skill, status) {
    setBusyId(skill._id);
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/skills/${skill._id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const label =
        status === "deprecated"
          ? "Demoted to deprecated"
          : status === "production"
            ? "Promoted to production"
            : "Moved to draft";
      setOkMsg(`${label}: “${skill.name}”.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * @param {object} skill
   */
  async function deleteSkill(skill) {
    const label = skill.name || skill.slug || "this skill";
    if (
      !window.confirm(
        `Delete skill “${label}”? Slash invoke /${skill.slug || ""} will stop working. Past task history is kept.`
      )
    ) {
      return;
    }
    setBusyId(skill._id);
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/skills/${skill._id}`, { method: "DELETE" });
      setOkMsg(`Deleted “${label}”.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * @param {object} s
   * @param {{ showRestore?: boolean }} [opts]
   */
  function renderSkillRow(s, opts = {}) {
    const learned = isLearnedSkill(s);
    const sourceGoal = s.sourceTask?.goal ? String(s.sourceTask.goal).slice(0, 100) : "";
    const agentName = s.agent?.name || "";
    return (
      <li
        key={s._id}
        className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-teal-100 bg-white p-3 text-sm"
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-teal-950">
            {s.name}
            {s.slug ? (
              <span className="ml-2 font-mono text-xs font-normal text-violet-800">/{s.slug}</span>
            ) : null}
            {learned ? (
              <span className="ml-2 rounded-md bg-sky-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-sky-900">
                Learned
              </span>
            ) : null}
            {s.status === "draft" ? (
              <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-amber-950">
                Draft
              </span>
            ) : null}
            {s.status === "production" ? (
              <span className="ml-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-900">
                Live
              </span>
            ) : null}
            {s.status === "deprecated" ? (
              <span className="ml-2 rounded-md bg-stone-200 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-stone-700">
                Deprecated
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-teal-900/70">
            <span className={s.status === "production" ? "font-semibold text-emerald-700" : ""}>
              {s.status}
            </span>
            {" · "}
            {s.steps?.length || 0} steps
            {s.triggers?.length ? ` · ${s.triggers.length} trigger(s)` : ""}
            {s.stats?.runs ? ` · used ${s.stats.runs}×` : ""}
            {s.stats?.selected ? ` · selected ${s.stats.selected}×` : ""}
            {s.stats?.loaded ? ` · viewed ${s.stats.loaded}×` : ""}
            {s.stats?.helped ? ` · helped ${s.stats.helped}×` : ""}
            {agentName ? ` · ${agentName}` : ""}
          </div>
          {s.workflowKey ? (
            <div className="mt-0.5 break-all font-mono text-[0.7rem] text-teal-900/45">
              workflow: {s.workflowKey}
            </div>
          ) : null}
          {sourceGoal ? (
            <div className="mt-0.5 text-xs text-teal-900/55">
              From run: {sourceGoal}
              {sourceGoal.length >= 100 ? "…" : ""}
            </div>
          ) : learned ? (
            <div className="mt-0.5 text-xs text-teal-900/55">Learned from a successful browser run</div>
          ) : null}
          {formatCreated(s.createdAt) ? (
            <time
              className="mt-0.5 block text-xs text-teal-900/45"
              dateTime={s.createdAt ? new Date(s.createdAt).toISOString() : undefined}
            >
              {formatCreated(s.createdAt)}
            </time>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to={`/skills/${s._id}`}
            className="inline-flex min-h-9 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800"
          >
            Edit
          </Link>
          {s.status === "production" ? (
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setSkillStatus(s, "deprecated")}
              className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900 disabled:opacity-50"
            >
              {busyId === s._id ? "…" : "Demote"}
            </button>
          ) : null}
          {s.status === "draft" ? (
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setSkillStatus(s, "production")}
              className="inline-flex min-h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 disabled:opacity-50"
            >
              {busyId === s._id ? "…" : "Promote"}
            </button>
          ) : null}
          {opts.showRestore || s.status === "deprecated" ? (
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setSkillStatus(s, "draft")}
              className="inline-flex min-h-9 items-center rounded-lg border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-800 disabled:opacity-50"
            >
              {busyId === s._id ? "…" : "Restore"}
            </button>
          ) : null}
          <ButtonWithHelp helpId="skills.delete">
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => deleteSkill(s)}
              className="inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
            >
              {busyId === s._id ? "Deleting…" : "Delete"}
            </button>
          </ButtonWithHelp>
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Skills</h1>
          <p className="text-sm text-teal-900/70">
            Skills come from <strong>Teach skill</strong>, <strong>New skill</strong>, or automatic{" "}
            <strong>Learned</strong> drafts after successful runs. Promote drafts to{" "}
            <strong>production</strong> so workers can match them (slash, high-confidence trigger, or{" "}
            <code className="text-xs">skill_view</code>); demote junk so it stops matching.
          </p>
        </div>
        <Link
          to="/skills/new"
          className="min-h-10 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white"
        >
          New skill
        </Link>
      </div>

      <PageGuideBanner helpId="skills.page" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <section className="flex flex-col gap-2">
        <SectionTitle helpId="skills.system" className="text-teal-900/80">
          System skills
        </SectionTitle>
        <p className="text-xs text-teal-900/50">
          Built into every cloud worker. They auto-activate when a goal or URL matches — you cannot
          edit or delete them. Your own skills (below) can take priority via{" "}
          <span className="font-mono">/slug</span> or triggers.
        </p>
        <ul className="flex flex-col gap-2">
          {systemSkills.map((s) => {
            const open = expandedSystemId === s.id;
            return (
              <li
                key={s.id}
                className="rounded-xl border border-violet-100 bg-violet-50/40 p-3 text-sm"
              >
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start justify-between gap-2 text-left"
                  onClick={() => setExpandedSystemId(open ? "" : s.id)}
                  aria-expanded={open}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-teal-950">
                      {s.label}
                      <span className="ml-2 rounded-md bg-violet-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-900">
                        System
                      </span>
                      <span className="ml-2 font-mono text-xs font-normal text-violet-800">
                        {s.id}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-teal-900/70">{s.description}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-violet-800">
                    {open ? "Hide" : "Details"}
                  </span>
                </button>
                {open ? (
                  <div className="mt-3 space-y-3 border-t border-violet-100 pt-3 text-xs text-teal-900/80">
                    {s.triggers?.length ? (
                      <div>
                        <p className="font-semibold text-teal-950">Triggers when goal/URL matches</p>
                        <ul className="mt-1 list-inside list-disc">
                          {s.triggers.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {s.steps?.length ? (
                      <div>
                        <p className="font-semibold text-teal-950">Suggested flow</p>
                        <ol className="mt-1 list-inside list-decimal">
                          {s.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    {s.hints?.length ? (
                      <div>
                        <p className="font-semibold text-teal-950">Hints</p>
                        <ul className="mt-1 list-inside list-disc">
                          {s.hints.map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          {!systemSkills.length ? (
            <p className="text-sm text-teal-900/60">System skill catalog unavailable.</p>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle helpId="skills.training" className="text-teal-900/80">
            Training requests
          </SectionTitle>
          <button
            type="button"
            onClick={() => setShowAllTraining((v) => !v)}
            className="min-h-9 rounded-lg border border-teal-100 bg-white px-3 text-xs font-semibold text-teal-800"
          >
            {showAllTraining ? "Pending only" : "Show all"}
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {training.map((r) => (
            <li key={r._id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm">
              <div className="font-semibold">{r.workflow || "Workflow help"}</div>
              <div className="mt-1 text-teal-900/70">{r.observation}</div>
              {r.recommendation ? (
                <div className="mt-1 text-xs text-teal-900/50">{r.recommendation}</div>
              ) : null}
              <div className="mt-1 text-xs text-teal-900/40">
                {r.agent?.name ? `Agent: ${r.agent.name}` : ""}
                {r.status ? ` · ${r.status}` : ""}
                {r.createdAt ? ` · Created ${formatChatMessageTime(r.createdAt)}` : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.task?.chat?._id ? (
                  <Link
                    to={`/chats/${r.task.chat._id}`}
                    className="inline-flex min-h-9 items-center rounded-lg border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-800"
                  >
                    Open chat
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => resolveTraining(r._id, "in_progress")}
                  className="min-h-9 rounded-lg border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-800"
                >
                  In progress
                </button>
                <button
                  type="button"
                  onClick={() => resolveTraining(r._id, "completed")}
                  className="min-h-9 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white"
                >
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => resolveTraining(r._id, "dismissed")}
                  className="min-h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
          {!training.length ? (
            <p className="text-sm text-teal-900/60">
              {showAllTraining ? "No training requests yet." : "No pending training requests."}
            </p>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle helpId="skills.list" className="text-teal-900/80">
          Skill library
        </SectionTitle>
        <p className="text-xs text-teal-900/50">
          <span className="font-semibold text-sky-900">Learned</span> = from a successful run (Skill+).
          Demote stops matching without deleting.
        </p>
        <form onSubmit={createSkill} className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <FieldLabel helpId="skills.name">Skill name</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="CRM follow-up check"
            />
          </label>
          <ButtonWithHelp helpId="skills.add">
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </ButtonWithHelp>
        </form>
        <ul className="flex flex-col gap-2">
          {activeSkills.map((s) => renderSkillRow(s))}
          {!activeSkills.length ? (
            <p className="text-sm text-teal-900/60">No skills yet. Use New skill or run a successful workflow.</p>
          ) : null}
        </ul>

        {deprecatedSkills.length ? (
          <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50/60 p-3">
            <button
              type="button"
              className="flex min-h-9 w-full items-center justify-between text-left text-sm font-semibold text-stone-800"
              onClick={() => setShowDeprecated((v) => !v)}
              aria-expanded={showDeprecated}
            >
              <span>Deprecated ({deprecatedSkills.length})</span>
              <span className="text-xs font-semibold text-stone-600">
                {showDeprecated ? "Hide" : "Show"}
              </span>
            </button>
            {showDeprecated ? (
              <ul className="mt-2 flex flex-col gap-2">
                {deprecatedSkills.map((s) => renderSkillRow(s, { showRestore: true }))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
