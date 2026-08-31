/**
 * @fileoverview Document storage — filesystem or Mongo fallback.
 * Purpose: Avoid large base64 in Mongo when DOCUMENT_STORAGE_PATH is set.
 * Downstream: documents routes, worker attach_document.
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import crypto from "node:crypto";
import { DocumentFile } from "../models/DocumentFile.js";

/**
 * @returns {string|null}
 */
export function getDocumentStorageDir() {
  const dir = String(process.env.DOCUMENT_STORAGE_PATH || "").trim();
  return dir || null;
}

/**
 * @param {string} userId
 * @param {Buffer} buf
 * @param {string} filename
 */
export async function storeDocumentBytes(userId, buf, filename) {
  const dir = getDocumentStorageDir();
  const id = crypto.randomBytes(12).toString("hex");
  if (dir) {
    const userDir = resolve(dir, String(userId));
    await mkdir(userDir, { recursive: true });
    const safeName = String(filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(userDir, `${id}_${safeName}`);
    await writeFile(path, buf);
    return { storagePath: path, dataBase64: "" };
  }
  return { storagePath: "", dataBase64: buf.toString("base64") };
}

/**
 * @param {object} doc - DocumentFile lean/doc
 * @returns {Promise<Buffer>}
 */
export async function readDocumentBytes(doc) {
  if (doc.storagePath) {
    return readFile(doc.storagePath);
  }
  return Buffer.from(doc.dataBase64 || "", "base64");
}

/**
 * @param {object} doc
 */
export async function deleteDocumentFile(doc) {
  if (doc.storagePath) {
    await unlink(doc.storagePath).catch(() => null);
  }
  await DocumentFile.deleteOne({ _id: doc._id });
}

/**
 * Extract plain text from buffer (txt/csv/json + rough PDF/DOCX string scrape).
 * @param {Buffer} buf
 * @param {string} mimeType
 * @param {string} [filename]
 */
export function extractDocumentText(buf, mimeType, filename = "") {
  const mt = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mt.includes("text") || mt.includes("json") || mt.includes("csv") || /\.(txt|md|csv|json)$/i.test(name)) {
    return buf.toString("utf8").slice(0, 80_000);
  }
  // Why: lightweight PDF scrape without native deps — enough for many text-heavy SOPs.
  if (mt.includes("pdf") || name.endsWith(".pdf")) {
    const raw = buf.toString("latin1");
    const chunks = [];
    const re = /\((?:\\.|[^\\)]){2,500}\)/g;
    let m;
    while ((m = re.exec(raw)) && chunks.length < 2000) {
      const inner = m[0]
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
      if (/[A-Za-z]{3,}/.test(inner)) chunks.push(inner);
    }
    const joined = chunks.join(" ").replace(/\s+/g, " ").trim();
    return joined.slice(0, 80_000);
  }
  // DOCX is a zip of XML — pull readable UTF-8 runs.
  if (mt.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
    const raw = buf.toString("utf8");
    const text = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u024f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 80_000);
  }
  return "";
}
