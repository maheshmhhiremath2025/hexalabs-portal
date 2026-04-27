// MeshCentral integration — agent-based browser desktop for Windows VMs.
// Follows the same patterns as guacamoleService.js (token caching, auto-retry).
//
// MeshCentral uses a WebSocket API (not REST). The agent on the VM connects
// outbound to the MeshCentral server on port 443 — no inbound NSG rules needed.

const crypto = require('crypto');
const WebSocket = require('ws');
const { logger } = require('../plugins/logger');

// ─── Environment config ─────────────────────────────────────────────────
const MC_INTERNAL_URL = process.env.MESHCENTRAL_URL || 'wss://meshcentral:4443';
const MC_PUBLIC_URL = process.env.MESHCENTRAL_PUBLIC_URL || 'https://mesh.getlabs.cloud';
const MC_ADMIN_USER = process.env.MESHCENTRAL_ADMIN_USER || 'admin';
const MC_ADMIN_PASS = process.env.MESHCENTRAL_ADMIN_PASS || 'admin';
const MC_LOGIN_TOKEN = process.env.MESHCENTRAL_LOGIN_TOKEN || '';
const MC_LOGIN_TOKEN_KEY = process.env.MESHCENTRAL_LOGIN_TOKEN_KEY || '';
const MC_DEVICE_GROUP = process.env.MESHCENTRAL_DEVICE_GROUP || 'getlabs-windows';
const MC_MESH_ID = process.env.MESHCENTRAL_MESH_ID || '';

// ─── WebSocket API wrapper ──────────────────────────────────────────────
// MeshCentral's control API is WebSocket-based. Authentication uses the
// x-meshauth header: base64(user),base64(pass)

async function mcApiCall(actionPayload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const authHeader =
      Buffer.from(MC_ADMIN_USER).toString('base64') + ',' +
      Buffer.from(MC_ADMIN_PASS).toString('base64');

    const ws = new WebSocket(`${MC_INTERNAL_URL}/control.ashx`, {
      headers: { 'x-meshauth': authHeader },
      rejectUnauthorized: false, // internal Docker network, self-signed cert
    });

    const rid = crypto.randomBytes(8).toString('hex');
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`MeshCentral API timeout (${actionPayload.action})`));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ ...actionPayload, responseid: rid }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.responseid === rid || msg.action === actionPayload.action) {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      } catch { /* ignore non-JSON frames */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`MeshCentral WS error: ${err.message}`));
    });
  });
}

// ─── Device lookup ──────────────────────────────────────────────────────
// After MeshAgent connects, it registers under its hostname. We tag the
// device with the portal vmName during install (via the MSH Tag field).

async function findDeviceByTag(vmName) {
  const res = await mcApiCall({ action: 'nodes' });
  for (const [, devices] of Object.entries(res.nodes || {})) {
    for (const dev of devices) {
      if (dev.tags && dev.tags.includes(vmName)) return dev;
      if (dev.name === vmName) return dev;
    }
  }
  return null;
}

// ─── Login token generation ─────────────────────────────────────────────
// MeshCentral login tokens: username,timestamp signed with HMAC-SHA384.
// Enables deep-link URLs that embed auth (same UX as Guacamole token URLs).

function generateLoginToken(username, key) {
  if (!key) throw new Error('MESHCENTRAL_LOGIN_TOKEN_KEY not configured');
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${username},${timestamp}`;
  const hmac = crypto.createHmac('sha384', key).update(data).digest('base64url');
  return Buffer.from(`${data},${hmac}`).toString('base64url');
}

// ─── Desktop access URL ─────────────────────────────────────────────────
// Generates a deep-link URL that opens the MeshCentral desktop tab directly.
// viewmode=11 = Desktop tab, gotonode = device node ID.
// Uses MeshCentral's built-in login token (created in UI) for URL auth.

async function getDesktopAccessUrl(vmName) {
  const device = await findDeviceByTag(vmName);
  if (!device) return null;

  const nodeId = device._id;

  // Use pre-generated login token from MeshCentral UI (simpler, no HMAC needed)
  const loginParam = MC_LOGIN_TOKEN
    ? `&login=${encodeURIComponent(MC_LOGIN_TOKEN)}`
    : '';

  return {
    accessUrl: `${MC_PUBLIC_URL}/?gotonode=${encodeURIComponent(nodeId)}&viewmode=11${loginParam}`,
    mode: 'meshcentral',
    nodeId,
  };
}

// ─── MSH content generation ─────────────────────────────────────────────
// The MSH file tells MeshAgent where to connect. Written alongside the
// agent EXE during install via Azure Custom Script Extension.

function generateMshContent(vmName) {
  const serverHost = MC_PUBLIC_URL.replace(/^https?:\/\//, '');
  return [
    `MeshName=${MC_DEVICE_GROUP}`,
    `MeshType=2`,
    `MeshID=${MC_MESH_ID}`,
    `MeshServer=wss://${serverHost}/agent.ashx`,
    `Tag=${vmName}`,
  ].join('\n');
}

// ─── Agent online check ─────────────────────────────────────────────────

async function isAgentOnline(vmName) {
  const device = await findDeviceByTag(vmName);
  if (!device) return false;
  // MeshCentral connectivity states: 0=offline, 1=online
  return device.conn === 1;
}

module.exports = {
  mcApiCall,
  findDeviceByTag,
  getDesktopAccessUrl,
  generateMshContent,
  generateLoginToken,
  isAgentOnline,
};
