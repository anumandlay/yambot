/**
 * @fileoverview Skills dashboard — suggested workflows, skill library, training requests.
 * Purpose: One draft + demonstration per completed task; production skills in library list.
 * Downstream: `/api/skills`, `/api/worker/demos/*`, LiveScreen Teach skill.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";

/**
 * Skills authored manually or promoted — hides auto-suggested drafts (shown under workflows).
 * @param {object} skill
 * @returns {boolean}
 */
function isLibrarySkill(skill) {
  if (!skill) return false;
  if (skill.status === "production" || skill.status === "deprecated") return true;
  return skill.status === "draft" && !skill.sourceTask;
}

/**
 * @param {string|undefined} value
 * @returns {string}
 */
function formatCreated(value) {
  const text = formatChatMessageTime(value);
  return text ? `Created ${text}` : "";
}

export function SkillsPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [demos, setDemos] = useState([]);
  const [training, setTraining] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [skillName, setSkillName] = useState("");
  const [showAllTraining, setShowAllTraining] = useState(false);
  const [expandedDemoId, setExpandedDemoId] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [deletingDemoId, setDeletingDemoId] = useState("");

  const load = useCallback(async () => {
    const trainingPath = showAllTraining ? "/api/skills/training" : "/api/skills/training?status=pending";
    const [sk, dm, tr] = await Promise.all([
      api("/api/skills"),
      api("/api/skills/demos"),
      api(trainingPath),
    ]);
    setSkills(sk.skills || []);
    setDemos(dm.demonstrations || []);
    setTraining(tr.requests || []);
  }, [showAllTraining]);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  const librarySkills = useMemo(() => skills.filter(isLibrarySkill), [skills]);
  const skillById = useMemo(() => {
    const map = new Map();
    for (const s of skills) map.set(String(s._id), s);
    return map;
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

  async function openDraftForDemo(demo) {
    setError(null);
    setOkMsg("");
    if (demo.convertedSkill) {
      navigate(`/skills/${demo.convertedSkill}`);
      return;
    }
    try {
      const created = await api(`/api/skills/from-demo/${demo._id}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setOkMsg("Draft skill ready — edit and set production when ready.");
      await load();
      navigate(`/skills/${created.skill._id}`);
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {object} demo
   */
  async function deleteDemo(demo) {
    const label = demo.title || "this workflow";
    if (
      !window.confirm(
        `Delete suggested workflow “${label}”?${demo.convertedSkill ? " The linked draft skill is kept in your library until you delete it." : ""}`
      )
    ) {
      return;
    }
    setDeletingDemoId(demo._id);
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/skills/demos/${demo._id}`, { method: "DELETE" });
      if (expandedDemoId === demo._id) setExpandedDemoId(null);
      setOkMsg(`Deleted workflow “${label}”.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingDemoId("");
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
    setDeletingId(skill._id);
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/skills/${skill._id}`, { method: "DELETE" });
      setOkMsg(`Deleted “${label}”.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Skills</h1>
          <p className="text-sm text-teal-900/70">
            Completed tasks save a <strong>suggested workflow</strong> (steps + draft skill). Edit →{" "}
            <strong>production</strong> to inject hints on matching runs. Use <strong>Teach skill</strong> in
            chat to enrich the same draft with your clicks.
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle helpId="skills.demos" className="text-teal-900/80">
            Suggested workflows
          </SectionTitle>
          <button
            type="button"
            onClick={() => load().catch((err) => setError(err))}
            className="min-h-9 rounded-lg border border-teal-100 bg-white px-3 text-xs font-semibold text-teal-800"
          >
            Refresh
          </button>
        </div>
        <p className="text-xs text-teal-900/50">
          Created when a task finishes (2+ steps) or when you use <strong>Teach skill</strong> on the live
          screen. Each row links to one <strong>draft</strong> skill — edit triggers and playbook, then set{" "}
          <strong>production</strong>.
        </p>
        <ul className="flex flex-col gap-2">
          {demos.map((d) => (
            <li key={d._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{d.title || "Workflow"}</div>
                  <div className="text-teal-900/70">
                    {d.steps?.length || 0} steps
                    {d.convertedSkill ? (
                      <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
                        draft linked
                      </span>
                    ) : null}
                  </div>
                  {formatCreated(d.createdAt) ? (
                    <time
                      className="mt-0.5 block text-xs text-teal-900/45"
                      dateTime={d.createdAt ? new Date(d.createdAt).toISOString() : undefined}
                    >
                      {formatCreated(d.createdAt)}
                    </time>
                  ) : d.convertedSkill && skillById.get(String(d.convertedSkill))?.createdAt ? (
                    <time
                      className="mt-0.5 block text-xs text-teal-900/45"
                      dateTime={new Date(
                        skillById.get(String(d.convertedSkill)).createdAt
                      ).toISOString()}
                    >
                      {formatCreated(skillById.get(String(d.convertedSkill)).createdAt)}
                    </time>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedDemoId((prev) => (prev === d._id ? null : d._id))
                    }
                    className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-semibold text-teal-800"
                  >
                    {expandedDemoId === d._id ? "Hide" : "Steps"}
                  </button>
                  <ButtonWithHelp helpId="skills.convertDemo">
                    <button
                      type="button"
                      onClick={() => openDraftForDemo(d)}
                      className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-semibold text-teal-800"
                    >
                      {d.convertedSkill ? "Edit draft" : "Create draft"}
                    </button>
                  </ButtonWithHelp>
                  <ButtonWithHelp helpId="skills.deleteDemo">
                    <button
                      type="button"
                      disabled={Boolean(deletingDemoId)}
                      onClick={() => deleteDemo(d)}
                      className="min-h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      {deletingDemoId === d._id ? "Deleting…" : "Delete"}
                    </button>
                  </ButtonWithHelp>
                </div>
              </div>
              {expandedDemoId === d._id && d.steps?.length ? (
                <ol className="mt-2 list-decimal space-y-1 border-t border-teal-50 pt-2 pl-5 text-xs text-teal-900/70">
                  {d.steps.map((step, idx) => (
                    <li key={idx}>
                      {step.action?.type ? (
                        <span className="font-mono">{step.action.type}</span>
                      ) : null}
                      {step.action?.text ? ` "${step.action.text}"` : ""}
                      {step.action?.key ? ` key:${step.action.key}` : ""}
                      {step.observation ? (
                        <span className="block text-teal-900/40">{step.observation}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
          {!demos.length ? (
            <p className="text-sm text-teal-900/60">
              No suggested workflows yet. Finish a multi-step task in chat or use Teach skill during a run.
            </p>
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
                    className="min-h-9 inline-flex items-center rounded-lg border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-800"
                  >
                    Open chat · demo
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
          Production skills and skills you created manually. Auto-suggested drafts appear under{" "}
          <strong>Suggested workflows</strong> above.
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
          {librarySkills.map((s) => (
            <li
              key={s._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-white p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {s.name}
                  {s.slug ? (
                    <span className="ml-2 font-mono text-xs font-normal text-violet-800">
                      /{s.slug}
                    </span>
                  ) : null}
                </div>
                <div className="text-teal-900/70">
                  <span
                    className={
                      s.status === "production"
                        ? "font-semibold text-emerald-700"
                        : ""
                    }
                  >
                    {s.status}
                  </span>
                  {" · "}
                  {s.steps?.length || 0} steps
                  {s.triggers?.length ? ` · ${s.triggers.length} trigger(s)` : ""}
                  {s.stats?.runs ? ` · used ${s.stats.runs}×` : ""}
                </div>
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
                  className="min-h-9 inline-flex items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800"
                >
                  Edit
                </Link>
                <ButtonWithHelp helpId="skills.delete">
                  <button
                    type="button"
                    disabled={Boolean(deletingId)}
                    onClick={() => deleteSkill(s)}
                    className="min-h-9 inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                  >
                    {deletingId === s._id ? "Deleting…" : "Delete"}
                  </button>
                </ButtonWithHelp>
              </div>
            </li>
          ))}
          {!librarySkills.length ? (
            <p className="text-sm text-teal-900/60">
              No library skills yet. Create one above or promote a draft from Suggested workflows.
            </p>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
