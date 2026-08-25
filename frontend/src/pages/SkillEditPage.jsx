/**
 * @fileoverview Create / edit a reusable skill (steps, triggers, status).
 * Purpose: Review demos converted to skills and promote to production for worker injection.
 * Downstream: PATCH `/api/skills/:id`, worker `GET /api/worker/skills`.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import {
  ButtonWithHelp,
  FieldLabel,
  PageGuideBanner,
  SectionTitle,
} from "../components/FieldLabel.jsx";

const EMPTY = {
  name: "",
  description: "",
  agent: "",
  status: "draft",
  triggers: "",
  steps: "",
  verificationRules: "",
};

const STATUSES = ["draft", "training", "production", "deprecated"];

export function SkillEditPage() {
  const { skillId } = useParams();
  const isNew = !skillId || skillId === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const agentData = await api("/api/agents");
        setAgents(agentData.agents || []);
        if (!isNew) {
          const one = await api(`/api/skills/${skillId}`);
          const s = one.skill;
          setForm({
            name: s.name || "",
            description: s.description || "",
            agent: s.agent ? String(s.agent) : "",
            status: s.status || "draft",
            triggers: (s.triggers || []).join("\n"),
            steps: Array.isArray(s.steps)
              ? s.steps
                  .map((step) =>
                    typeof step === "string" ? step : JSON.stringify(step, null, 0)
                  )
                  .join("\n")
              : "",
            verificationRules: (s.verificationRules || []).join("\n"),
          });
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [isNew, skillId]);

  /**
   * @param {React.FormEvent} e
   */
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    const payload = {
      name: form.name.trim() || "Skill",
      description: form.description.trim(),
      agentId: form.agent || null,
      status: form.status,
      triggers: form.triggers,
      steps: form.steps,
      verificationRules: form.verificationRules,
    };
    try {
      if (isNew) {
        const created = await api("/api/skills", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        navigate(`/skills/${created.skill._id}`, { replace: true });
        setOkMsg("Skill created.");
      } else {
        await api(`/api/skills/${skillId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setOkMsg("Skill saved.");
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {isNew ? "New skill" : "Edit skill"}
          </h1>
          <p className="text-sm text-teal-900/70">
            Production skills inject step hints when triggers match the goal or URL.
          </p>
        </div>
        <Link
          to="/skills"
          className="min-h-10 rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900"
        >
          ← Skills
        </Link>
      </div>

      <PageGuideBanner helpId="skills.edit" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <form onSubmit={save} className="flex flex-col gap-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="skills.name">Name</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="skills.description">Description</FieldLabel>
          <textarea
            className="min-h-16 rounded-xl border border-teal-100 px-3 py-2"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What this workflow does"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="skills.agent">Agent (optional)</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.agent}
              onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="skills.status">Status</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="skills.triggers">Triggers (one per line)</FieldLabel>
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
            value={form.triggers}
            onChange={(e) => setForm((f) => ({ ...f, triggers: e.target.value }))}
            placeholder={"crm\\.vughy\\.com\nfollow-up|followup"}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="skills.steps">Steps (one per line)</FieldLabel>
          <textarea
            className="min-h-32 rounded-xl border border-teal-100 px-3 py-2 text-sm"
            value={form.steps}
            onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))}
            placeholder={"Log into CRM\nOpen Today's follow-up tab\nFind the lead by name"}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="skills.verification">Verification rules (one per line)</FieldLabel>
          <textarea
            className="min-h-16 rounded-xl border border-teal-100 px-3 py-2 text-sm"
            value={form.verificationRules}
            onChange={(e) => setForm((f) => ({ ...f, verificationRules: e.target.value }))}
            placeholder="URL contains /follow-up"
          />
        </label>

        <SectionTitle helpId="skills.production" className="text-teal-900/70">
          Set status to <strong>production</strong> when ready — the worker injects this skill when triggers match.
        </SectionTitle>

        <ButtonWithHelp helpId="skills.save">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 self-start rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : isNew ? "Create skill" : "Save changes"}
          </button>
        </ButtonWithHelp>
      </form>
    </div>
  );
}
