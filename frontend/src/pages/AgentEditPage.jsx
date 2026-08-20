/**
 * @fileoverview Create / edit a YamBot agent definition.
 * Purpose: Capture profile, skill, instructions, facts, autonomy, success criteria.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

const EMPTY = {
  name: "",
  description: "",
  profile: "",
  skill: "general",
  instructions: "",
  facts: [{ key: "", value: "" }],
  successCriteria: "",
  allowedDomains: "",
  startUrl: "",
  maxSteps: 25,
  runner: "any",
  active: true,
  autonomy: {
    allowSubmit: true,
    allowCaptcha: true,
    askBeforeLogin: true,
    askBeforeSubmit: false,
  },
};

export function AgentEditPage() {
  const { agentId } = useParams();
  const isNew = !agentId || agentId === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [skills, setSkills] = useState(["general"]);
  const [runners, setRunners] = useState(["any", "extension", "cloud"]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [memoryNote, setMemoryNote] = useState("");
  const [memory, setMemory] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const meta = await api("/api/agents/meta");
        setSkills(meta.skills || ["general"]);
        if (Array.isArray(meta.runners) && meta.runners.length) {
          setRunners(meta.runners);
        }
        if (!isNew) {
          const data = await api(`/api/agents/${agentId}`);
          const a = data.agent;
          setForm({
            name: a.name || "",
            description: a.description || "",
            profile: a.profile || "",
            skill: a.skill || "general",
            instructions: a.instructions || "",
            facts: a.facts?.length ? a.facts : [{ key: "", value: "" }],
            successCriteria: a.successCriteria || "",
            allowedDomains: (a.allowedDomains || []).join(", "),
            startUrl: a.startUrl || "",
            maxSteps: a.maxSteps ?? 25,
            runner: a.runner || "any",
            active: a.active !== false,
            autonomy: {
              allowSubmit: a.autonomy?.allowSubmit !== false,
              allowCaptcha: a.autonomy?.allowCaptcha !== false,
              askBeforeLogin: a.autonomy?.askBeforeLogin === true,
              askBeforeSubmit: a.autonomy?.askBeforeSubmit === true,
            },
          });
          setMemory(a.memory || []);
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [agentId, isNew]);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateAutonomy(key, value) {
    setForm((prev) => ({
      ...prev,
      autonomy: { ...prev.autonomy, [key]: value },
    }));
  }

  function updateFact(index, field, value) {
    setForm((prev) => {
      const facts = [...prev.facts];
      facts[index] = { ...facts[index], [field]: value };
      return { ...prev, facts };
    });
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    const payload = {
      ...form,
      facts: form.facts.filter((f) => f.key.trim()),
      allowedDomains: form.allowedDomains,
      maxSteps: Number(form.maxSteps) || 25,
    };
    try {
      if (isNew) {
        const data = await api("/api/agents", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setOkMsg("Agent created");
        navigate(`/agents/${data.agent._id}`, { replace: true });
      } else {
        await api(`/api/agents/${agentId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setOkMsg("Agent saved");
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (isNew) return;
    if (!window.confirm("Delete this agent?")) return;
    setBusy(true);
    try {
      await api(`/api/agents/${agentId}`, { method: "DELETE" });
      navigate("/agents");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Agents
        </Link>
        <h1 className="text-xl font-bold tracking-tight">
          {isNew ? "New agent" : "Edit agent"}
        </h1>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Short description
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Skill
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.skill}
            onChange={(e) => update("skill", e.target.value)}
          >
            {skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Profile / persona
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 px-3 py-2"
            value={form.profile}
            onChange={(e) => update("profile", e.target.value)}
            placeholder="Who this agent is, tone, role…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Standing instructions
          <textarea
            className="min-h-28 rounded-xl border border-teal-100 px-3 py-2"
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            placeholder="Clear rules for every run…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Success criteria
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.successCriteria}
            onChange={(e) => update("successCriteria", e.target.value)}
            placeholder="When to finish, e.g. summarize top 5 links with URLs"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Computer / runner
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.runner}
            onChange={(e) => update("runner", e.target.value)}
          >
            {runners.map((r) => (
              <option key={r} value={r}>
                {r === "cloud"
                  ? "Cloud computer (VPS Chromium)"
                  : r === "extension"
                    ? "My Chrome extension only"
                    : "Any available (cloud or extension)"}
              </option>
            ))}
          </select>
          <span className="text-xs text-teal-900/60">
            Cloud = dedicated always-on browser profile on the server for this agent. Copy the agent
            ID into the worker container env (<code className="rounded bg-teal-50 px-1">YAMBOT_AGENT_ID</code>).
            {!isNew ? (
              <>
                {" "}
                ID: <code className="break-all rounded bg-teal-50 px-1">{agentId}</code>
              </>
            ) : null}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Start URL (optional)
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.startUrl}
            onChange={(e) => update("startUrl", e.target.value)}
            placeholder="https://www.google.com/"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Allowed domains (comma-separated, empty = any)
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.allowedDomains}
            onChange={(e) => update("allowedDomains", e.target.value)}
            placeholder="news.google.com, reuters.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Max steps
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="number"
            min={5}
            max={100}
            value={form.maxSteps}
            onChange={(e) => update("maxSteps", e.target.value)}
          />
        </label>

        <div>
          <div className="mb-2 text-sm font-semibold text-teal-900/80">Facts</div>
          <div className="flex flex-col gap-2">
            {form.facts.map((f, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3"
                  placeholder="Key (e.g. product_url)"
                  value={f.key}
                  onChange={(e) => updateFact(i, "key", e.target.value)}
                />
                <input
                  className="min-h-11 flex-[2] rounded-xl border border-teal-100 px-3"
                  placeholder="Value"
                  value={f.value}
                  onChange={(e) => updateFact(i, "value", e.target.value)}
                />
              </div>
            ))}
            <button
              type="button"
              className="min-h-11 self-start rounded-xl border border-teal-100 px-3 text-sm font-semibold"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  facts: [...prev.facts, { key: "", value: "" }],
                }))
              }
            >
              Add fact
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-teal-900/80">Autonomy</div>
          {[
            ["allowSubmit", "Allow submit / apply clicks"],
            ["allowCaptcha", "Allow CAPTCHA solving"],
            ["askBeforeLogin", "Ask before login walls"],
            ["askBeforeSubmit", "Ask before submit clicks"],
          ].map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.autonomy[key])}
                onChange={(e) => updateAutonomy(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.active)}
              onChange={(e) => update("active", e.target.checked)}
            />
            Active
          </label>
        </div>

        {!isNew ? (
          <div className="flex flex-col gap-2 border-t border-teal-100 pt-3">
            <div className="text-sm font-semibold text-teal-900/80">Memory</div>
            <p className="text-xs text-teal-900/60">
              Filled automatically after runs. You can also add notes the agent should remember.
            </p>
            <ul className="max-h-48 overflow-y-auto rounded-xl border border-teal-100 bg-teal-50/50 p-2 text-sm">
              {memory.length === 0 ? (
                <li className="text-teal-900/50">No memories yet.</li>
              ) : (
                memory.map((m, i) => (
                  <li key={i} className="border-b border-teal-100/80 py-2 last:border-0">
                    <span className="text-xs uppercase text-teal-800/50">{m.kind}</span>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3"
                placeholder="Add a memory note…"
                value={memoryNote}
                onChange={(e) => setMemoryNote(e.target.value)}
              />
              <button
                type="button"
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm font-semibold"
                onClick={async () => {
                  if (!memoryNote.trim()) return;
                  setBusy(true);
                  try {
                    const data = await api(`/api/agents/${agentId}/memory`, {
                      method: "POST",
                      body: JSON.stringify({ content: memoryNote, kind: "note" }),
                    });
                    setMemory(data.agent.memory || []);
                    setMemoryNote("");
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add note
              </button>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700"
                onClick={async () => {
                  if (!window.confirm("Clear all memory for this agent?")) return;
                  setBusy(true);
                  try {
                    const data = await api(`/api/agents/${agentId}/memory`, {
                      method: "DELETE",
                    });
                    setMemory(data.agent.memory || []);
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save agent"}
          </button>
          {!isNew ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 font-semibold text-red-700"
            >
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
