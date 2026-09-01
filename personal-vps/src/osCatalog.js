/**
 * @fileoverview OS catalog for personal VPS containers.
 * Purpose: Super-admin picks a Linux image (server or desktop) at create time.
 * Downstream: dockerOps.js uses family/kind to bootstrap SSH or expose desktop ports.
 */

/**
 * @typedef {'server' | 'desktop'} OsKind
 * @typedef {'debian' | 'alpine' | 'rhel' | 'desktop-lxde' | 'desktop-xfce'} OsFamily
 *
 * @typedef {object} OsOption
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} image
 * @property {OsKind} kind
 * @property {OsFamily} family
 * @property {string} sshUser
 * @property {number} [internalSshPort]
 * @property {number} [internalWebPort]
 * @property {string} [desktopNote]
 */

/** @type {OsOption[]} */
export const OS_CATALOG = [
  {
    id: "ubuntu-24.04",
    label: "Ubuntu 24.04 LTS (Server)",
    description: "Latest Ubuntu server — SSH shell for dev, scripts, and tools.",
    image: "ubuntu:24.04",
    kind: "server",
    family: "debian",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "ubuntu-22.04",
    label: "Ubuntu 22.04 LTS (Server)",
    description: "Stable Ubuntu server with broad package support.",
    image: "ubuntu:22.04",
    kind: "server",
    family: "debian",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "debian-12",
    label: "Debian 12 Bookworm (Server)",
    description: "Minimal Debian — lightweight server environment.",
    image: "debian:bookworm",
    kind: "server",
    family: "debian",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "alpine-3.20",
    label: "Alpine Linux 3.20 (Server)",
    description: "Tiny footprint Linux — fast boot, ideal for small utilities.",
    image: "alpine:3.20",
    kind: "server",
    family: "alpine",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "rocky-9",
    label: "Rocky Linux 9 (Server)",
    description: "Enterprise-style RHEL-compatible server.",
    image: "rockylinux:9",
    kind: "server",
    family: "rhel",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "fedora-40",
    label: "Fedora 40 (Server)",
    description: "Bleeding-edge packages on a full server image.",
    image: "fedora:40",
    kind: "server",
    family: "rhel",
    sshUser: "root",
    internalSshPort: 22,
  },
  {
    id: "ubuntu-desktop-lxde",
    label: "Ubuntu Desktop (LXDE + noVNC)",
    description: "Full graphical desktop in browser + SSH via PuTTY.",
    image: "dorowu/ubuntu-desktop-lxde-vnc:latest",
    kind: "desktop",
    family: "desktop-lxde",
    sshUser: "root",
    internalSshPort: 22,
    internalWebPort: 80,
    desktopNote: "Open the Desktop URL in your browser for the GUI. SSH still works via PuTTY.",
  },
  {
    id: "ubuntu-desktop-xfce",
    label: "Ubuntu Desktop (XFCE + noVNC)",
    description: "XFCE desktop in browser; SSH enabled after first boot.",
    image: "consol/ubuntu-xfce-vnc:latest",
    kind: "desktop",
    family: "desktop-xfce",
    sshUser: "root",
    internalSshPort: 22,
    internalWebPort: 6080,
    desktopNote: "Open the Desktop URL in your browser. SSH via PuTTY uses root + your generated password.",
  },
];

/**
 * @param {string} osId
 * @returns {OsOption | undefined}
 */
export function getOsById(osId) {
  return OS_CATALOG.find((o) => o.id === osId);
}

/**
 * Public catalog rows (no secrets).
 * @returns {object[]}
 */
export function catalogPublic() {
  return OS_CATALOG.map((o) => ({
    id: o.id,
    label: o.label,
    description: o.description,
    kind: o.kind,
    family: o.family,
    sshUser: o.sshUser,
    desktopNote: o.desktopNote || "",
  }));
}
