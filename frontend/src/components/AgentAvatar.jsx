/**
 * @fileoverview Circular agent profile picture (or initial fallback).
 * Purpose: Consistent avatar chrome wherever agent names appear.
 * Downstream: AgentsPage, GrokStylePage, ChatsPage, ChatDetailPage, AgentEditPage.
 */

import { agentAvatarSrc } from "../lib/agentAvatar.js";

/**
 * @param {object} props
 * @param {{ name?: string, avatarMime?: string, avatarBase64?: string }|null|undefined} [props.agent]
 * @param {string} [props.name] — override when agent object lacks name
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {string} [props.className]
 * @param {boolean} [props.selected] — invert initial colors on selected rows
 */
export function AgentAvatar({ agent, name, size = "md", className = "", selected = false }) {
  const label = String(name || agent?.name || "A").trim() || "A";
  const initial = label.charAt(0).toUpperCase();
  const src = agentAvatarSrc(agent);
  const dim =
    size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-7 w-7 text-[0.65rem]" : "h-9 w-9 text-sm";
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold ${dim} ${className}`;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${base} bg-teal-100 object-cover`}
        draggable={false}
      />
    );
  }

  return (
    <span
      className={`${base} ${
        selected ? "bg-white/25 text-white" : "bg-teal-100 text-teal-800"
      }`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
