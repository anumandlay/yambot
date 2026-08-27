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
 * Extract plain text from buffer (basic — txt/csv/json only).
 * @param {Buffer} buf
 * @param {string} mimeType
 */
export function extractDocumentText(buf, mimeType) {
  const mt = String(mimeType || "").toLowerCase();
  if (mt.includes("text") || mt.includes("json") || mt.includes("csv")) {
    return buf.toString("utf8").slice(0, 50_000);
  }
  return "";
}
