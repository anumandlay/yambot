/**
 * @fileoverview Named LLM profiles — save API key / base URL / model and test.
 * Purpose: Reusable credentials that agents pick from a dropdown on create/edit.
 * Downstream: /api/llm-profiles; AgentEditPage LLM select.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

const EMPTY_FORM = {
  name: "",
  apiKey: "",
  baseUrl: "https://api.minimax.io/v1",
  model: "MiniMax-M2.7",
  tier: "standard",
  costPer1kUsd: "",
  hasApiKey: false,
};

/** Quick-fill presets for common providers. */
const LLM_PRESETS = [
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    keyHint: "sk-ant-api03-… from console.anthropic.com",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M2.7",
    keyHint: "MiniMax API key",
  },
];

/**
 * Settings subpage for managing reusable LLM credential profiles.
 */
export function SettingsLlmProfilesPage() {
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  /**
   * Reloads profile list from the API.
   */
  async function reload() {
    const data = await api("/api/llm-profiles");
    setProfiles(data.profiles || []);
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  /**
   * @param {string} key
   * @param {string} value
   */
  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Resets the form to create a new profile.
   */
  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOkMsg("");
    setError(null);
  }

  /**
   * @param {object} p
   */
  function startEdit(p) {
    setEditingId(p._id || p.id);
    setForm({
      name: p.name || "",
      apiKey: "",
      baseUrl: p.baseUrl || "",
      model: p.model || "",
      tier: p.tier || "standard",
      costPer1kUsd: p.costPer1kUsd != null && p.costPer1kUsd !== 0 ? String(p.costPer1kUsd) : "",
      hasApiKey: Boolean(p.hasApiKey),
    });
    setOkMsg("");
    setError(null);
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const payload = {
        name: form.name,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey,
        tier: form.tier || "standard",
        costPer1kUsd: form.costPer1kUsd === "" ? 0 : Number(form.costPer1kUsd) || 0,
      };
      let data;
      if (editingId) {
        data = await api(`/api/llm-profiles/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        data = await api("/api/llm-profiles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setOkMsg(editingId ? "LLM profile saved." : "LLM profile created.");
      const saved = data.profile;
      setEditingId(saved._id || saved.id);
      setForm({
        name: saved.name || "",
        apiKey: "",
        baseUrl: saved.baseUrl || "",
        model: saved.model || "",
        hasApiKey: Boolean(saved.hasApiKey),
      });
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Probes the form values (or saved profile key if blank).
   */
  async function onTest() {
    setTesting(true);
    setError(null);
    setOkMsg("");
    try {
      const body = {
        apiKey: form.apiKey.replace(/\s+/g, ""),
        baseUrl: form.baseUrl,
        model: form.model,
        profileId: editingId || undefined,
      };
      const data = editingId
        ? await api(`/api/llm-profiles/${editingId}/test`, {
            method: "POST",
            body: JSON.stringify(body),
          })
        : await api("/api/llm-profiles/test", {
            method: "POST",
            body: JSON.stringify(body),
          });
      const preview = data.preview ? ` Reply: “${data.preview}”.` : "";
      setOkMsg(`${data.message || "LLM connected."} Model: ${data.model || form.model}.${preview}`);
    } catch (err) {
      const tried = [
        form.baseUrl ? `Base URL: ${form.baseUrl}` : null,
        form.model ? `Model: ${form.model}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const detail = [err.detail || err.message || "Could not connect to the LLM.", tried]
        .filter(Boolean)
        .join("\n\n");
      setError({
        title: err.title || "LLM connection failed",
        detail,
        hint: err.hint || "Check API key, base URL (should end with /v1), and model name.",
      });
    } finally {
      setTesting(false);
    }
  }

  /**
   * @param {string} id
   */
  async function onDelete(id) {
    if (!window.confirm("Delete this LLM profile? Agents using it will fall back to Settings.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/llm-profiles/${id}`, { method: "DELETE" });
      setOkMsg("LLM profile deleted.");
      if (editingId === id) startCreate();
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageGuideBanner helpId="settings.llmProfiles" />
      <p className="text-sm text-teal-900/70">
        Save named LLMs here, then pick one from the dropdown when you create or edit an agent. Your
        Settings → API key / OpenAI OAuth remains the default when an agent has no profile selected.{" "}
        <Link to="/agents/new" className="font-semibold text-teal-800 underline">
          Create agent
        </Link>
      </p>

      {okMsg ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {okMsg}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="flex flex-col gap-2 rounded-xl border border-teal-100 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-teal-900">Saved LLMs</h2>
            <button
              type="button"
              onClick={startCreate}
              className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-semibold text-teal-900"
            >
              New
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="text-sm text-teal-900/60">No profiles yet. Create one on the right.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {profiles.map((p) => {
                const id = p._id || p.id;
                const active = editingId === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className={`flex w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left text-sm ${
                        active
                          ? "border-teal-400 bg-teal-50"
                          : "border-teal-100 bg-white hover:bg-teal-50/50"
                      }`}
                    >
                      <span className="font-semibold text-teal-950">{p.name}</span>
                      <span className="text-xs text-teal-900/60">
                        {p.model || "—"} · {p.tier || "standard"} · {p.baseUrl || "default base URL"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <form
          onSubmit={onSave}
          className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white p-3"
        >
          <h2 className="text-sm font-semibold text-teal-900">
            {editingId ? "Edit LLM" : "New LLM"}
          </h2>
          <div className="flex flex-wrap gap-2">
            {LLM_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="min-h-9 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-900"
                onClick={() => {
                  update("baseUrl", p.baseUrl);
                  update("model", p.model);
                  if (!form.name) update("name", p.label);
                }}
              >
                Use {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-teal-800/70">
            Anthropic: key must start with <span className="font-mono">sk-ant-</span> from{" "}
            <a
              className="font-semibold underline"
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              console.anthropic.com
            </a>
            . Not OpenAI, not Claude login password.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="settings.llmProfile.name">Name</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="MiniMax production"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="settings.llmApiKey">
              API key{form.hasApiKey ? " (saved — leave blank to keep)" : ""}
            </FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={form.hasApiKey ? "••••••••" : "sk-… or provider key"}
              required={!editingId}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="settings.llmBaseUrl">Base URL</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="settings.llmModel">Model</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="gpt-4o"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-teal-950">Cost tier (for Command Center optimizer)</span>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.tier || "standard"}
              onChange={(e) => update("tier", e.target.value)}
            >
              <option value="cheap">Cheap — classification / extract</option>
              <option value="standard">Standard — default</option>
              <option value="premium">Premium — complex / browser</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-teal-950">Est. USD per 1k tokens (optional)</span>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              type="number"
              min="0"
              step="0.001"
              value={form.costPer1kUsd}
              onChange={(e) => update("costPer1kUsd", e.target.value)}
              placeholder="0.002"
            />
          </label>
          {error ? (
            <ErrorAlert
              title={error.title || "LLM connection failed"}
              detail={error.detail || error.message || "Could not connect to the LLM."}
              hint={error.hint || "Check API key, base URL (should end with /v1), and model name."}
              onClose={() => setError(null)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <ButtonWithHelp helpId="settings.llmProfiles.save">
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </ButtonWithHelp>
            <ButtonWithHelp helpId="settings.llmProfiles.test">
              <button
                type="button"
                disabled={testing || busy}
                onClick={onTest}
                className="min-h-11 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test LLM"}
              </button>
            </ButtonWithHelp>
            {editingId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(editingId)}
                className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-800 disabled:opacity-50"
              >
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
