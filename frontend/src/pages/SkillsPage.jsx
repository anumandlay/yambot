/**
 * @fileoverview Skills dashboard — demonstrations, skills, training requests.
 * Purpose: Human demo → skill pipeline and employee training queue.
 * Downstream: `/api/skills`, `/api/worker/demos/*`, LiveScreen Take control.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";

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

  async function convertDemo(demoId, trainingId = null) {
    setError(null);
    setOkMsg("");
    try {
      const created = await api(`/api/skills/from-demo/${demoId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (trainingId) {
        await api(`/api/skills/training/${trainingId}/resolve`, {
          method: "POST",
          body: JSON.stringify({ status: "completed", skillId: created.skill._id }),
        });
      }
      setOkMsg("Skill generated — edit triggers and set production when ready.");
      await load();
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Skills</h1>
          <p className="text-sm text-teal-900/70">
            Take control in chat → demo saved here → convert to skill → production triggers agent hints.
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle helpId="skills.demos" className="text-teal-900/80">
            Demonstrations
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
          Recorded when you use <strong>Take control</strong> in a chat (clicks, typing, keys).
        </p>
        <ul className="flex flex-col gap-2">
          {demos.map((d) => (
            <li key={d._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{d.title || "Demo"}</div>
                  <div className="text-teal-900/70">{d.steps?.length || 0} steps</div>
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
                  {!d.convertedSkill ? (
                    <ButtonWithHelp helpId="skills.convertDemo">
                      <button
                        type="button"
                        onClick={() => convertDemo(d._id)}
                        className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-semibold text-teal-800"
                      >
                        → Skill
                      </button>
                    </ButtonWithHelp>
                  ) : (
                    <Link
                      to={`/skills/${d.convertedSkill}`}
                      className="min-h-9 inline-flex items-center rounded-lg bg-teal-50 px-3 text-xs font-semibold text-teal-800"
                    >
                      View skill
                    </Link>
                  )}
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
            <p className="text-sm text-teal-900/60">No demonstrations yet. Take control during a task to record one.</p>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle helpId="skills.list" className="text-teal-900/80">
          Skills
        </SectionTitle>
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
          {skills.map((s) => (
            <li
              key={s._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-white p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold">{s.name}</div>
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
              </div>
              <Link
                to={`/skills/${s._id}`}
                className="min-h-9 inline-flex items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
