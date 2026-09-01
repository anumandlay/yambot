/**
 * @fileoverview AES-GCM helpers for personal VPS SSH passwords at rest.
 * Purpose: Encrypt/decrypt credentials stored in MongoDB using SETTINGS_CRYPTO_KEY.
 * Downstream: personal-vps model read/write; isolated from YamBot agent tokens.
 */

import crypto from "node:crypto";

/**
 * @param {string} passphrase
 * @returns {Buffer}
 */
function keyBytes(passphrase) {
  return crypto.createHash("sha256").update(passphrase).digest();
}

/**
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {string}
 */
export function encryptSecret(plaintext, passphrase) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(passphrase), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * @param {string} payload
 * @param {string} passphrase
 * @returns {string}
 */
export function decryptSecret(payload, passphrase) {
  if (!payload) return "";
  const [ivHex, tagHex, dataHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !dataHex) return "";
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyBytes(passphrase),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
