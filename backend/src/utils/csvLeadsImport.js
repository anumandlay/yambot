/**
 * @fileoverview CSV lead import — parse and bulk upsert Entity records.
 * Purpose: Import thousands of leads (name + email) for campaign outreach.
 * Downstream: entities import route, CompanyPage CSV upload.
 */

import { Entity, ENTITY_TYPES } from "../models/Entity.js";

/** Max rows per import request (abuse guard). */
export const CSV_IMPORT_MAX_ROWS = 10_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * When paste loses newlines, multiple `name,type,email` triplets land on one CSV row.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string[][]}
 */
export function expandNameTypeEmailRows(headers, rows) {
  if (headers.length !== 3) return rows;
  const h = headers.map((x) => x.toLowerCase());
  if (h[0] !== "name" || h[2] !== "email") return rows;

  /** @type {string[][]} */
  const out = [];
  for (const row of rows) {
    if (row.length <= 3) {
      out.push(row);
      continue;
    }
    if (row.length % 3 !== 0) {
      out.push(row);
      continue;
    }
    let validTriplets = true;
    for (let i = 2; i < row.length; i += 3) {
      if (!EMAIL_RE.test(String(row[i] || "").trim())) {
        validTriplets = false;
        break;
      }
    }
    if (!validTriplets) {
      out.push(row);
      continue;
    }
    for (let i = 0; i < row.length; i += 3) {
      out.push(row.slice(i, i + 3));
    }
  }
  return out;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * @param {string} raw
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function parseCsvText(raw) {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return { headers: [], rows: [] };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const first = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const headerKeywords = [
    "email",
    "e-mail",
    "name",
    "company",
    "phone",
    "first_name",
    "last_name",
    "type",
  ];
  const hasHeader = first.some((h) => headerKeywords.includes(h));
  if (!hasHeader) {
    const cols = parseCsvLine(lines[0]);
    if (cols.length >= 3 && EMAIL_RE.test(String(cols[cols.length - 1] || "").trim())) {
      const headers = ["name", "type", "email"];
      const rows = expandNameTypeEmailRows(headers, lines.map((l) => parseCsvLine(l)));
      return { headers, rows };
    }
    if (cols.length >= 2) {
      const c0 = String(cols[0] || "").trim();
      const c1 = String(cols[1] || "").trim();
      if (EMAIL_RE.test(c0)) {
        return {
          headers: ["email", "name"],
          rows: lines.map((l) => parseCsvLine(l)),
        };
      }
      if (EMAIL_RE.test(c1)) {
        return {
          headers: ["name", "email"],
          rows: lines.map((l) => parseCsvLine(l)),
        };
      }
      return {
        headers: ["email", "name"],
        rows: lines.map((l) => parseCsvLine(l)),
      };
    }
    return {
      headers: ["email"],
      rows: lines.map((l) => [l.trim()]),
    };
  }
  const headers = first;
  const rows = expandNameTypeEmailRows(
    headers,
    lines.slice(1).map(parseCsvLine).filter((r) => r.some((c) => c.trim()))
  );
  return { headers, rows };
}

/**
 * @param {string[]} headers
 * @param {string[]} row
 * @returns {Record<string, string>}
 */
function rowToRecord(headers, row) {
  /** @type {Record<string, string>} */
  const rec = {};
  for (let i = 0; i < headers.length; i += 1) {
    rec[headers[i]] = String(row[i] || "").trim();
  }
  return rec;
}

/**
 * @param {Record<string, string>} rec
 * @returns {{ email: string, name: string, attributes: object }|null}
 */
function normalizeLeadRow(rec) {
  const email = String(
    rec.email || rec["e-mail"] || rec.mail || rec.email_address || rec.emailaddress || ""
  )
    .trim()
    .toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;

  const first = rec.first_name || rec.firstname || rec.first || "";
  const last = rec.last_name || rec.lastname || rec.last || "";
  const name =
    String(rec.name || rec.full_name || rec.fullname || `${first} ${last}`.trim() || email.split("@")[0]).trim() ||
    email.split("@")[0];

  /** @type {Record<string, string>} */
  const attributes = { email };
  if (rec.company || rec.organization) attributes.company = String(rec.company || rec.organization).trim();
  if (rec.phone || rec.mobile) attributes.phone = String(rec.phone || rec.mobile).trim();
  if (first) attributes.firstName = first;
  if (last) attributes.lastName = last;

  for (const [k, v] of Object.entries(rec)) {
    if (!v || ["email", "e-mail", "mail", "name", "first_name", "last_name", "firstname", "lastname"].includes(k)) {
      continue;
    }
    if (!attributes[k]) attributes[k] = v;
  }

  return { email, name: name.slice(0, 200), attributes };
}

/**
 * Bulk import leads from CSV text.
 * @param {string} userId
 * @param {string} csvText
 * @param {{ entityType?: string, updateExisting?: boolean, groupId?: string|null }} [opts]
 */
export async function importLeadsFromCsv(userId, csvText, opts = {}) {
  const entityType = ENTITY_TYPES.includes(opts.entityType) ? opts.entityType : "lead";
  const updateExisting = opts.updateExisting !== false;
  const groupId = opts.groupId ? String(opts.groupId) : null;
  const { headers, rows } = parseCsvText(csvText);

  if (!rows.length) {
    return { ok: false, detail: "No data rows found in CSV", created: 0, updated: 0, skipped: 0, errors: [] };
  }
  if (rows.length > CSV_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      detail: `Too many rows (max ${CSV_IMPORT_MAX_ROWS})`,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
  }

  /** @type {Map<string, { email: string, name: string, attributes: object }>} */
  const byEmail = new Map();
  /** @type {string[]} */
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const rec = rowToRecord(headers, rows[i]);
    const lead = normalizeLeadRow(rec);
    if (!lead) {
      errors.push(`Row ${i + 2}: invalid or missing email`);
      continue;
    }
    byEmail.set(lead.email, lead);
  }

  const emails = [...byEmail.keys()];
  if (!emails.length) {
    return { ok: false, detail: "No valid email addresses found", created: 0, updated: 0, skipped: 0, errors };
  }

  const existing = await Entity.find({
    user: userId,
    type: entityType,
    group: groupId,
    $or: [{ "attributes.email": { $in: emails } }, { externalId: { $in: emails } }],
  }).lean();

  /** @type {Map<string, object>} */
  const existingByEmail = new Map();
  for (const doc of existing) {
    const em = String(doc.attributes?.email || doc.externalId || "").toLowerCase();
    if (em) existingByEmail.set(em, doc);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [email, lead] of byEmail) {
    const found = existingByEmail.get(email);
    if (found) {
      if (!updateExisting) {
        skipped += 1;
        continue;
      }
      await Entity.updateOne(
        { _id: found._id },
        {
          $set: {
            name: lead.name,
            externalId: email,
            group: groupId,
            attributes: { ...(found.attributes || {}), ...lead.attributes },
          },
        }
      );
      updated += 1;
    } else {
      await Entity.create({
        user: userId,
        group: groupId,
        type: entityType,
        name: lead.name,
        externalId: email,
        status: "new",
        attributes: lead.attributes,
      });
      created += 1;
    }
  }

  const totalLeads = await Entity.countDocuments({
    user: userId,
    type: entityType,
    group: groupId,
  });

  return {
    ok: true,
    created,
    updated,
    skipped,
    duplicatesInFile: rows.length - byEmail.size,
    totalRows: rows.length,
    uniqueEmails: byEmail.size,
    totalLeads,
    errors: errors.slice(0, 50),
  };
}
