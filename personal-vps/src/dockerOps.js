/**
 * @fileoverview Docker lifecycle for personal VPS containers.
 * Purpose: Create/stop/start/delete isolated Linux boxes on the YamBot VPS host.
 * Inputs: dockerode, OS catalog, Mongo PersonalVps records.
 * Downstream: personal-vps HTTP API; labels `personal-vps=true` (not YamBot agents).
 */

import crypto from "node:crypto";
import { getOsById } from "./osCatalog.js";
import { PersonalVps, toInstancePublic } from "./model.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

const SSH_PORT_MIN = 22000;
const SSH_PORT_MAX = 22999;
const WEB_PORT_MIN = 23000;
const WEB_PORT_MAX = 23999;

/**
 * @param {string} name
 * @returns {string}
 */
export function slugifyName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {Promise<number>}
 */
async function pickFreePort(min, max) {
  const used = new Set(
    (await PersonalVps.find({ status: { $ne: "deleting" } })
      .select("sshPort webPort")
      .lean()).flatMap((r) => [r.sshPort, r.webPort].filter(Boolean))
  );
  for (let p = min; p <= max; p += 1) {
    if (!used.has(p)) return p;
  }
  throw new Error("No free host ports available for personal VPS");
}

/**
 * @returns {string}
 */
function randomPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

/**
 * Bootstrap shell for server images — installs openssh-server and runs sshd.
 * Why: Official OS images ship without SSH; one-shot install on first start.
 * @param {import('./osCatalog.js').OsOption['family']} family
 * @returns {string}
 */
function serverBootstrapScript(family) {
  if (family === "alpine") {
    return `
set -e
apk add --no-cache openssh openssh-server sudo bash
passwd root <<EOF
$PVPS_ROOT_PASSWORD
$PVPS_ROOT_PASSWORD
EOF
ssh-keygen -A
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
mkdir -p /root/persistent
exec /usr/sbin/sshd -D -e
`.trim();
  }
  if (family === "rhel") {
    return `
set -e
dnf install -y openssh-server sudo
echo "root:$PVPS_ROOT_PASSWORD" | chpasswd
ssh-keygen -A
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
mkdir -p /root/persistent
exec /usr/sbin/sshd -D -e
`.trim();
  }
  return `
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq openssh-server sudo
echo "root:$PVPS_ROOT_PASSWORD" | chpasswd
mkdir -p /run/sshd
ssh-keygen -A
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
mkdir -p /root/persistent
exec /usr/sbin/sshd -D -e
`.trim();
}

/**
 * @param {import('dockerode')} docker
 * @param {string} containerId
 * @param {number} maxMs
 */
async function waitRunning(docker, containerId, maxMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const info = await docker.getContainer(containerId).inspect();
    if (info.State?.Running) return info;
    if (info.State?.Status === "exited" || info.State?.Dead) {
      throw new Error(info.State?.Error || "Container exited during provisioning");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Container did not reach running state in time");
}

/**
 * Post-start password + SSH setup for desktop images.
 * @param {import('dockerode')} docker
 * @param {string} containerId
 * @param {import('./osCatalog.js').OsOption} os
 * @param {string} password
 */
async function finalizeDesktop(docker, containerId, os, password) {
  const container = docker.getContainer(containerId);
  const execOpts = {
    AttachStdout: true,
    AttachStderr: true,
  };
  if (os.family === "desktop-lxde") {
    const exec = await container.exec({
      ...execOpts,
      Cmd: [
        "sh",
        "-c",
        `echo "root:${password}" | chpasswd && (service ssh start || /usr/sbin/sshd)`,
      ],
    });
    await exec.start({});
    return;
  }
  if (os.family === "desktop-xfce") {
    const exec = await container.exec({
      ...execOpts,
      Cmd: [
        "bash",
        "-c",
        `export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y -qq openssh-server && echo "root:${password}" | chpasswd && service ssh start`,
      ],
    });
    await exec.start({});
  }
}

/**
 * @param {import('dockerode')} docker
 * @param {string} image
 * @returns {Promise<void>}
 */
async function pullImage(docker, image) {
  console.log(`[personal-vps] pulling image ${image}…`);
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      docker.modem.followProgress(
        stream,
        (progressErr) => {
          if (progressErr) reject(progressErr);
          else resolve(undefined);
        },
        (event) => {
          if (event?.status) {
            const line = [event.status, event.id, event.progress].filter(Boolean).join(" ");
            console.log(`[personal-vps] pull ${image}: ${line}`);
          }
        }
      );
    });
  });
}

/**
 * Ensures the OS image exists locally — pulls from Docker Hub when missing.
 * Why: createContainer does not always auto-pull on this host; explicit pull avoids 404.
 * @param {import('dockerode')} docker
 * @param {string} image
 * @returns {Promise<void>}
 */
async function ensureImage(docker, image) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    /* not local — pull below */
  }
  try {
    await pullImage(docker, image);
  } catch (err) {
    const msg = String(err?.message || err);
    throw new Error(
      `Failed to download OS image "${image}". ${msg.includes("404") ? "Image not found on Docker Hub." : msg}`
    );
  }
}

/**
 * @param {import('dockerode')} docker
 * @param {{ name: string, osId: string, createdBy: string, sshHost: string, cryptoKey: string }} opts
 * @returns {Promise<object>}
 */
export async function createInstance(docker, opts) {
  const os = getOsById(opts.osId);
  if (!os) throw new Error("Unknown OS selection");

  const slug = slugifyName(opts.name);
  if (!slug) throw new Error("Name must contain letters or numbers");

  const existing = await PersonalVps.findOne({ slug, status: { $ne: "deleting" } });
  if (existing) throw new Error("A personal VPS with this name already exists");

  const password = randomPassword();
  const shortId = crypto.randomBytes(3).toString("hex");
  const containerName = `pvps-${slug}-${shortId}`;
  const volumeName = `pvps-data-${shortId}`;
  const sshPort = await pickFreePort(SSH_PORT_MIN, SSH_PORT_MAX);
  const webPort = os.kind === "desktop" ? await pickFreePort(WEB_PORT_MIN, WEB_PORT_MAX) : 0;

  // Why: pull before Mongo write so a missing image does not leave a broken DB row.
  await ensureImage(docker, os.image);

  const doc = await PersonalVps.create({
    name: opts.name.trim(),
    slug,
    osId: os.id,
    osLabel: os.label,
    osKind: os.kind,
    containerName,
    volumeName,
    sshHost: opts.sshHost,
    sshPort,
    sshUser: os.sshUser,
    webPort,
    passwordEnc: encryptSecret(password, opts.cryptoKey),
    status: "provisioning",
    createdBy: opts.createdBy,
  });

  /** @type {import('dockerode').ContainerCreateOptions} */
  const createOpts = {
    name: containerName,
    Image: os.image,
    Env: [`PVPS_ROOT_PASSWORD=${password}`, `VNC_PW=${password}`, `PASSWORD=${password}`],
    Labels: {
      "personal-vps": "true",
      "personal-vps.id": String(doc._id),
      "personal-vps.slug": slug,
    },
    HostConfig: {
      PortBindings: {
        [`${os.internalSshPort || 22}/tcp`]: [{ HostPort: String(sshPort) }],
      },
      Binds: [`${volumeName}:/root/persistent`],
      RestartPolicy: { Name: "unless-stopped" },
    },
  };

  if (os.kind === "desktop" && os.internalWebPort && webPort) {
    createOpts.HostConfig.PortBindings[`${os.internalWebPort}/tcp`] = [
      { HostPort: String(webPort) },
    ];
  }

  if (os.kind === "server") {
    createOpts.Cmd = ["/bin/sh", "-c", serverBootstrapScript(os.family)];
  }

  try {
    const container = await docker.createContainer(createOpts);
    await container.start();
    await waitRunning(docker, container.id);

    if (os.kind === "desktop") {
      await new Promise((r) => setTimeout(r, 8000));
      try {
        await finalizeDesktop(docker, container.id, os, password);
      } catch (err) {
        console.warn("[personal-vps] desktop finalize warning:", err?.message || err);
      }
    }

    doc.containerId = container.id;
    doc.status = "running";
    doc.statusDetail = "";
    await doc.save();

    return toInstancePublic(doc, password);
  } catch (err) {
    doc.status = "error";
    doc.statusDetail = String(err?.message || err);
    await doc.save();
    try {
      const c = docker.getContainer(containerName);
      await c.stop({ t: 5 }).catch(() => {});
      await c.remove({ force: true, v: true }).catch(() => {});
    } catch {
      /* ignore cleanup race */
    }
    throw err;
  }
}

/**
 * @param {import('dockerode')} docker
 * @param {import('mongoose').Document} doc
 * @param {string} cryptoKey
 * @param {boolean} revealPassword
 * @returns {Promise<object>}
 */
export async function syncInstanceState(docker, doc, cryptoKey, revealPassword = false) {
  let state = "stopped";
  let detail = "";
  try {
    const container = docker.getContainer(doc.containerName);
    const info = await container.inspect();
    state = info.State?.Running ? "running" : info.State?.Status === "exited" ? "stopped" : doc.status;
  } catch {
    state = doc.status === "provisioning" ? "provisioning" : "stopped";
    detail = "Container not found on host";
  }
  if (doc.status !== "provisioning" && doc.status !== "deleting") {
    doc.status = state;
    doc.statusDetail = detail;
    await doc.save();
  }
  const password = revealPassword ? decryptSecret(doc.passwordEnc, cryptoKey) : "";
  return toInstancePublic(doc, password);
}

/**
 * @param {import('dockerode')} docker
 * @param {string} cryptoKey
 * @param {boolean} revealPasswords
 * @returns {Promise<object[]>}
 */
export async function listInstances(docker, cryptoKey, revealPasswords = false) {
  const rows = await PersonalVps.find({ status: { $ne: "deleting" } }).sort({ createdAt: -1 });
  const out = [];
  for (const doc of rows) {
    out.push(await syncInstanceState(docker, doc, cryptoKey, revealPasswords));
  }
  return out;
}

/**
 * @param {import('dockerode')} docker
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function stopInstance(docker, id) {
  const doc = await PersonalVps.findById(id);
  if (!doc) throw new Error("Personal VPS not found");
  const container = docker.getContainer(doc.containerName);
  await container.stop({ t: 10 }).catch(() => {});
  doc.status = "stopped";
  await doc.save();
  return toInstancePublic(doc);
}

/**
 * @param {import('dockerode')} docker
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function startInstance(docker, id) {
  const doc = await PersonalVps.findById(id);
  if (!doc) throw new Error("Personal VPS not found");
  const container = docker.getContainer(doc.containerName);
  await container.start();
  doc.status = "running";
  doc.statusDetail = "";
  await doc.save();
  return toInstancePublic(doc);
}

/**
 * @param {import('dockerode')} docker
 * @param {string} id
 * @returns {Promise<{ ok: true, deleted: string }>}
 */
export async function deleteInstance(docker, id) {
  const doc = await PersonalVps.findById(id);
  if (!doc) throw new Error("Personal VPS not found");
  doc.status = "deleting";
  await doc.save();
  try {
    const container = docker.getContainer(doc.containerName);
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  } catch {
    /* already gone */
  }
  try {
    const vol = docker.getVolume(doc.volumeName);
    await vol.remove({ force: true }).catch(() => {});
  } catch {
    /* volume may not exist */
  }
  await PersonalVps.deleteOne({ _id: doc._id });
  return { ok: true, deleted: String(id) };
}

/**
 * @param {import('dockerode')} docker
 * @param {string} id
 * @param {string} cryptoKey
 * @returns {Promise<object>}
 */
export async function revealPassword(docker, id, cryptoKey) {
  const doc = await PersonalVps.findById(id);
  if (!doc) throw new Error("Personal VPS not found");
  const password = decryptSecret(doc.passwordEnc, cryptoKey);
  return { ok: true, id: String(doc._id), password };
}
