/**
 * @fileoverview Symmetric helpers to encrypt secrets at rest (LLM keys).
 * Purpose: Avoid storing raw API keys in Mongo while still allowing the extension to decrypt via API.
 * Why AES-256-GCM: authenticated encryption so tampered ciphertext fails closed.
 * Inputs: SETTINGS_CRYPTO_KEY from env.
 * Downstream: settings routes / User.settings fields.
 */

import crypto from "node:crypto";
import { env } from "./env.js";

/**
 * Derives a 32-byte key from the configured passphrase.
 * @returns {Buffer}
 */
function keyBytes() {
  return crypto.createHash("sha256").update(env.SETTINGS_CRYPTO_KEY).digest();
}

/**
 * Encrypts plaintext for storage.
 * @param {string} plaintext
 * @returns {string} payload as `iv:tag:cipher` hex
 */
export function encryptSecret(plaintext) {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypts a stored payload.
 * @param {string} payload
 * @returns {string}
 */
export function decryptSecret(payload) {
  if (!payload) return "";
  const [ivHex, tagHex, dataHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !dataHex) return "";
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
