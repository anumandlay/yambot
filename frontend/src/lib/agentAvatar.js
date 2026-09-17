/**
 * @fileoverview Agent avatar helpers — resize uploads and build img src.
 * Purpose: Keep profile pictures small enough for GET /api/agents list payloads.
 * Downstream: AgentEditPage upload; AgentAvatar display component.
 */

/** Soft max edge length for avatar thumbnails (px). */
export const AGENT_AVATAR_MAX_EDGE = 256;

/** Approximate max base64 length after resize (~100KB decoded). */
export const AGENT_AVATAR_MAX_BASE64 = 140_000;

/**
 * Builds a data URL for an agent avatar, or empty string if none.
 * @param {{ avatarMime?: string, avatarBase64?: string }|null|undefined} agent
 * @returns {string}
 */
export function agentAvatarSrc(agent) {
  const b64 = String(agent?.avatarBase64 || "").trim();
  if (!b64) return "";
  const mime = String(agent?.avatarMime || "image/jpeg").trim() || "image/jpeg";
  if (b64.startsWith("data:")) return b64;
  return `data:${mime};base64,${b64}`;
}

/**
 * Reads a File, draws it into a canvas square thumbnail, returns JPEG base64 (no data: prefix).
 * @param {File} file
 * @param {{ maxEdge?: number, quality?: number }} [opts]
 * @returns {Promise<{ mime: string, base64: string }>}
 */
export function resizeImageFileToAvatar(file, opts = {}) {
  const maxEdge = opts.maxEdge || AGENT_AVATAR_MAX_EDGE;
  const quality = opts.quality ?? 0.82;
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(Object.assign(new Error("Choose an image file"), { title: "Not an image" }));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error("Invalid image dimensions"));
            return;
          }
          // Why: center-crop to square so faces/logos stay framed in circular UI.
          const side = Math.min(w, h);
          const sx = Math.floor((w - side) / 2);
          const sy = Math.floor((h - side) / 2);
          const out = Math.min(maxEdge, side);
          const canvas = document.createElement("canvas");
          canvas.width = out;
          canvas.height = out;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas unavailable"));
            return;
          }
          ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
          if (!base64 || base64.length > AGENT_AVATAR_MAX_BASE64) {
            reject(
              Object.assign(new Error("Image is still too large after resize"), {
                title: "Avatar too large",
              })
            );
            return;
          }
          resolve({ mime: "image/jpeg", base64 });
        } catch (err) {
          reject(err);
        }
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}
