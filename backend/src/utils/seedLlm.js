/**
 * @fileoverview Seeds site-wide default LLM credentials into every user on boot.
 * Purpose: Keep Minimax (or other DEFAULT_LLM_*) applied without re-entering Settings.
 * Inputs: env.DEFAULT_LLM_*; Downstream: User.settings (encrypted key).
 */

import { User } from "../models/User.js";
import { encryptSecret } from "./crypto.js";
import { env } from "./env.js";
import {
  isStaleLlmBaseUrl,
  normalizeLlmBaseUrl,
  normalizeLlmModel,
} from "./llmDefaults.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "./openaiCodex.js";

/**
 * One-time-per-boot repair for users still pointing at LiteLLM or the YamBot website after gateway removal.
 * Why: workers POST `/chat/completions` and nginx serves SPA HTML when base URL is wrong.
 */
export async function migrateStaleLlmSettings() {
  const staleUrlFilter = {
    $or: [
      { "settings.llmBaseUrl": /litellm/i },
      { "settings.llmBaseUrl": /bot\.vughy\.com/i },
      { "settings.llmBaseUrl": /localhost/i },
      { "settings.llmBaseUrl": /127\.0\.0\.1/i },
      { "settings.llmGatewayMode": "litellm" },
      { "settings.llmAuthMode": "litellm" },
      { "settings.visionBaseUrl": /litellm|bot\.vughy\.com/i },
    ],
  };
  const urlFix = await User.updateMany(staleUrlFilter, {
    $set: {
      "settings.llmBaseUrl": env.DEFAULT_LLM_BASE_URL,
      "settings.llmGatewayMode": "direct",
      "settings.llmAuthMode": "api_key",
    },
  });

  const modelFix = await User.updateMany(
    {
      $or: [
        { "settings.llmModel": /^minimax$/i },
        { "settings.llmModel": /^chatgpt/i },
      ],
      "settings.llmAuthMode": { $ne: "oauth" },
    },
    { $set: { "settings.llmModel": env.DEFAULT_LLM_MODEL } }
  );

  const openAiModelFix = await User.updateMany(
    {
      "settings.llmAuthMode": "oauth",
      "settings.llmOAuthProvider": "openai",
      "settings.llmModel": /minimax/i,
    },
    { $set: { "settings.llmModel": OPENAI_CODEX_DEFAULT_MODEL } }
  );

  let pathFixCount = 0;
  const minimaxUsers = await User.find({
    "settings.llmBaseUrl": /minimax\.io/i,
  }).select("settings");
  for (const user of minimaxUsers) {
    const s = user.settings || {};
    const nextBase = normalizeLlmBaseUrl(s.llmBaseUrl, env.DEFAULT_LLM_BASE_URL);
    const nextModel = normalizeLlmModel(s.llmModel, env.DEFAULT_LLM_MODEL);
    const visionBase = s.visionBaseUrl
      ? normalizeLlmBaseUrl(s.visionBaseUrl, nextBase)
      : s.visionBaseUrl;
    const changed =
      nextBase !== s.llmBaseUrl ||
      nextModel !== s.llmModel ||
      (s.visionBaseUrl && visionBase !== s.visionBaseUrl);
    if (!changed) continue;
    user.settings.llmBaseUrl = nextBase;
    user.settings.llmModel = nextModel;
    if (s.visionBaseUrl) user.settings.visionBaseUrl = visionBase;
    user.markModified("settings");
    await user.save();
    pathFixCount += 1;
  }

  const total = urlFix.modifiedCount + modelFix.modifiedCount + openAiModelFix.modifiedCount + pathFixCount;
  if (total > 0) {
    console.log(
      `[llm-migrate] repaired ${total} user settings (url=${urlFix.modifiedCount}, model=${modelFix.modifiedCount}, openaiModel=${openAiModelFix.modifiedCount}, path=${pathFixCount})`
    );
  }
}

/**
 * When DEFAULT_LLM_API_KEY is set on the server, seed base URL / model / key only for users
 * who have not saved their own LLM key yet.
 * Why: a blanket updateMany on every boot wiped Settings changes after each deploy.
 */
export async function seedDefaultLlmSettings() {
  if (!env.DEFAULT_LLM_API_KEY?.trim()) {
    console.log("[llm-seed] skipped (no DEFAULT_LLM_API_KEY)");
    return;
  }

  const enc = encryptSecret(env.DEFAULT_LLM_API_KEY.trim());
  const result = await User.updateMany(
    {
      $and: [
        {
          $or: [
            { "settings.llmApiKeyEnc": { $exists: false } },
            { "settings.llmApiKeyEnc": null },
            { "settings.llmApiKeyEnc": "" },
          ],
        },
        { "settings.llmAuthMode": { $ne: "oauth" } },
      ],
    },
    {
      $set: {
        "settings.llmApiKeyEnc": enc,
        "settings.llmBaseUrl": env.DEFAULT_LLM_BASE_URL,
        "settings.llmModel": env.DEFAULT_LLM_MODEL,
        "settings.llmAuthMode": "api_key",
        "settings.llmGatewayMode": "direct",
      },
    }
  );
  console.log(
    `[llm-seed] seeded defaults for ${result.modifiedCount}/${result.matchedCount} users without a saved LLM key`
  );
}
