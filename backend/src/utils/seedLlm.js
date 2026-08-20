/**
 * @fileoverview Seeds site-wide default LLM credentials into every user on boot.
 * Purpose: Keep Minimax (or other DEFAULT_LLM_*) applied without re-entering Settings.
 * Inputs: env.DEFAULT_LLM_*; Downstream: User.settings (encrypted key).
 */

import { User } from "../models/User.js";
import { encryptSecret } from "./crypto.js";
import { env } from "./env.js";

/**
 * When DEFAULT_LLM_API_KEY is set on the server, push base URL / model / key to all users.
 * Why: single-operator VPS — one provider config for website, extension, and cloud workers.
 */
export async function seedDefaultLlmSettings() {
  if (!env.DEFAULT_LLM_API_KEY?.trim()) {
    console.log("[llm-seed] skipped (no DEFAULT_LLM_API_KEY)");
    return;
  }
  const enc = encryptSecret(env.DEFAULT_LLM_API_KEY.trim());
  const result = await User.updateMany(
    {},
    {
      $set: {
        "settings.llmApiKeyEnc": enc,
        "settings.llmBaseUrl": env.DEFAULT_LLM_BASE_URL,
        "settings.llmModel": env.DEFAULT_LLM_MODEL,
      },
    }
  );
  console.log(
    `[llm-seed] applied ${env.DEFAULT_LLM_MODEL} @ ${env.DEFAULT_LLM_BASE_URL} to ${result.modifiedCount}/${result.matchedCount} users`
  );
}
