/**
 * @fileoverview Default LLM provider constants for YamBot.
 * Purpose: Site-wide fallbacks (Minimax) so Settings and workers share one baseline.
 * Secrets still come from env `DEFAULT_LLM_API_KEY` / per-user encrypted settings — never commit keys.
 */

export const DEFAULT_LLM_BASE_URL = "https://api.minimax.io/v1";
export const DEFAULT_LLM_MODEL = "MiniMax-M2.7";
