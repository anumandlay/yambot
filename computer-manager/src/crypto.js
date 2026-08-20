/**
 * @fileoverview Decrypt worker tokens the same way the API encrypts them.
 * Purpose: computer-manager reads Agent.workerTokenEnc from Mongo to inject into containers.
 */

import crypto from "node:crypto";

function keyBytes(passphrase) {
  return crypto.createHash("sha256").update(passphrase).digest();
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
