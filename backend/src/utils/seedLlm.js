/**
 * @fileoverview Seeds site-wide default LLM credentials into every user on boot.
 * Purpose: Keep Minimax (or other DEFAULT_LLM_*) applied without re-entering Settings.
 * Inputs: env.DEFAULT_LLM_*; Downstream: User.settings (encrypted key).
 */

import { User } from "../models/User.js";
import { encryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { isLitellmEnabled, litellmOpenAiBaseUrl } from "./litellmClient.js";

/**
 * When DEFAULT_LLM_API_KEY is set on the server, seed base URL / model / key only for users
 * who have not saved their own LLM key yet.
 * Why: a blanket updateMany on every boot wiped Settings changes after each deploy.
 */
export async function seedDefaultLlmSettings() {
  if (!env.DEFAULT_LLM_API_KEY?.trim() && !isLitellmEnabled()) {
    console.log("[llm-seed] skipped (no DEFAULT_LLM_API_KEY and no LiteLLM gateway)");
    return;
  }

  if (isLitellmEnabled()) {
    const gatewayBase = litellmOpenAiBaseUrl();
    const gatewayModel = env.LITELLM_DEFAULT_MODEL || env.DEFAULT_LLM_MODEL;
    const result = await User.updateMany(
      {
        $or: [
          { "settings.llmGatewayMode": { $exists: false } },
          { "settings.llmGatewayMode": "direct", "settings.litellmVirtualKeyEnc": { $in: [null, ""] } },
        ],
      },
      {
        $set: {
          "settings.llmGatewayMode": "litellm",
          "settings.llmAuthMode": "litellm",
          "settings.llmBaseUrl": gatewayBase,
          "settings.llmModel": gatewayModel,
        },
      }
    );
    console.log(
      `[llm-seed] LiteLLM gateway defaults for ${result.modifiedCount}/${result.matchedCount} users`
    );
  }

  if (!env.DEFAULT_LLM_API_KEY?.trim()) {
    return;
  }

  const enc = encryptSecret(env.DEFAULT_LLM_API_KEY.trim());
  const result = await User.updateMany(
    {
      $or: [
        { "settings.llmApiKeyEnc": { $exists: false } },
        { "settings.llmApiKeyEnc": null },
        { "settings.llmApiKeyEnc": "" },
      ],
      "settings.llmGatewayMode": { $ne: "litellm" },
    },
    {
      $set: {
        "settings.llmApiKeyEnc": enc,
        "settings.llmBaseUrl": env.DEFAULT_LLM_BASE_URL,
        "settings.llmModel": env.DEFAULT_LLM_MODEL,
      },
    }
  );
  console.log(
    `[llm-seed] seeded direct defaults for ${result.modifiedCount}/${result.matchedCount} users without a saved LLM key`
  );
}
