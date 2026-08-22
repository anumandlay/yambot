/**
 * @fileoverview Page structure formatting — forms, tables, dialogs for the LLM.
 * Purpose: Structured blocks so the model doesn't reconstruct tables from flat ref lists.
 * Downstream: format.js; data from observeInPage `structures`.
 */

/**
 * @param {object|null|undefined} structures
 * @returns {string}
 */
export function formatStructuresBlock(structures) {
  if (!structures) return "";
  const lines = [];

  if (structures.dialogs?.length) {
    lines.push("DIALOGS:");
    for (const dlg of structures.dialogs.slice(0, 3)) {
      lines.push(`  ${dlg.title || "Dialog"}:`);
      for (const f of dlg.fields || []) {
        lines.push(`    - ${f.name || f.role}: ${f.ref}${f.required ? " [required]" : ""}`);
      }
      for (const a of dlg.actions || []) {
        lines.push(`    - [action] ${a.name}: ${a.ref}`);
      }
    }
  }

  if (structures.forms?.length) {
    lines.push("FORMS:");
    for (const form of structures.forms.slice(0, 4)) {
      lines.push(`  ${form.name || form.id}:`);
      for (const f of form.fields || []) {
        const val = f.value ? ` value="${String(f.value).slice(0, 40)}"` : "";
        lines.push(
          `    - ${f.name || f.ref} (${f.type || "field"}): ${f.ref}${f.required ? " [required]" : ""}${val}`
        );
      }
      for (const a of form.actions || []) {
        lines.push(`    - [submit] ${a.name}: ${a.ref}`);
      }
    }
  }

  if (structures.tables?.length) {
    lines.push("TABLES:");
    for (const table of structures.tables.slice(0, 3)) {
      lines.push(`  TABLE: ${table.title || "Data"}`);
      for (const row of table.rows || []) {
        const cells = (row.cells || []).filter(Boolean).join(" | ");
        const actions = (row.actions || [])
          .map((a) => `${a.name}:${a.ref}`)
          .join(", ");
        lines.push(`    ROW: ${row.label || cells}${actions ? ` → Actions: ${actions}` : ""}`);
      }
    }
  }

  return lines.length ? lines.join("\n") : "";
}

/**
 * Node-side fallback when in-page structures missing.
 * @param {object} obs
 * @returns {object}
 */
export function buildStructuresFromObs(obs) {
  if (obs?.structures) return obs.structures;
  const forms = new Map();
  for (const item of obs?.interactives || []) {
    if (!item.inForm && !item.formId) continue;
    const key = item.formId || item.formName || "form";
    if (!forms.has(key)) {
      forms.set(key, { id: key, name: item.formName || key, fields: [], actions: [] });
    }
    const form = forms.get(key);
    const entry = {
      ref: item.ref,
      name: item.name,
      type: item.type || item.role,
      required: item.required,
      value: item.value,
    };
    if (
      item.role === "button" ||
      item.type === "submit" ||
      /submit|send|sign in|continue|apply/i.test(item.name || "")
    ) {
      form.actions.push(entry);
    } else {
      form.fields.push(entry);
    }
  }
  return {
    forms: [...forms.values()].slice(0, 5),
    dialogs: [],
    tables: [],
  };
}
