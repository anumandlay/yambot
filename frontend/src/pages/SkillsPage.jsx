/**
 * @fileoverview Skills dashboard — demonstrations, skills, training requests.
 * Purpose: Human demo → skill pipeline and employee training queue.
 * Downstream: `/api/skills`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";

export function SkillsPage() {
  const [skills, setSkills] = useState([]);
  const [demos, setDemos] = useState([]);
  const [training, setTraining] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [skillName, setSkillName] = useState("");

  const load = useCallback(async () => {
    const [sk, dm, tr] = await Promise.all([
      api("/api/skills"),
      api("/api/skills/demos"),
      api("/api/skills/training"),
    ]);
    setSkills(sk.skills || []);
    setDemos(dm.demonstrations || []);
    setTraining(tr.requests || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function createSkill(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/skills", {
        method: "POST",
        body: JSON.stringify({ name: skillName.trim() || "Skill", steps: [] }),
      });
      setSkillName("");
      setOkMsg("Skill created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function convertDemo(demoId) {
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/skills/from-demo/${demoId}`, { method: "POST", body: JSON.stringify({}) });
      setOkMsg("Skill generated from demonstration.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function resolveTraining(id, status) {
    setError(null);
    try {
      await api(`/api/skills/training/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Skills</h1>
        <p className="text-sm text-teal-900/70">
          Demonstrations, reusable skills, and training requests from agents.
        </p>
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
        <SectionTitle helpId="skills.training" className="text-teal-900/80">
          Training requests
        </SectionTitle>
        <ul className="flex flex-col gap-2">
          {training.map((r) => (
            <li key={r._id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm">
              <div className="font-semibold">{r.workflow || "Workflow help"}</div>
              <div className="text-teal-900/70">{r.observation}</div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => resolveTraining(r._id, "completed")}
                  className="min-h-9 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white"
                >
                  Mark done
                </button>
                <span className="text-xs text-teal-900/50">{r.status}</span>
              </div>
            </li>
          ))}
          {!training.length ? <p className="text-sm text-teal-900/60">No pending training requests.</p> : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle helpId="skills.demos" className="text-teal-900/80">
          Demonstrations
        </SectionTitle>
        <ul className="flex flex-col gap-2">
          {demos.map((d) => (
            <li key={d._id} className="flex items-center justify-between gap-2 rounded-xl border border-teal-100 bg-white p-3 text-sm">
              <div>
                <div className="font-semibold">{d.title || "Demo"}</div>
                <div className="text-teal-900/70">{d.steps?.length || 0} steps</div>
              </div>
              {!d.convertedSkill ? (
                <ButtonWithHelp helpId="skills.convertDemo">
                  <button
                    type="button"
                    onClick={() => convertDemo(d._id)}
                    className="min-h-9 shrink-0 rounded-lg border border-teal-200 px-3 text-xs font-semibold text-teal-800"
                  >
                    → Skill
                  </button>
                </ButtonWithHelp>
              ) : (
                <span className="text-xs text-teal-700">Converted</span>
              )}
            </li>
          ))}
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
              placeholder="Skill name"
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
            <li key={s._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
              <div className="font-semibold">{s.name}</div>
              <div className="text-teal-900/70">
                {s.status} · {s.steps?.length || 0} steps
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
