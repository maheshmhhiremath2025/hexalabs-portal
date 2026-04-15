const axios = require('axios');
const { logger } = require('../plugins/logger');

// Internal URL for API calls (backend → guacamole container)
const GUAC_API_URL = process.env.GUACAMOLE_URL || 'http://localhost:8085/guacamole';
// Public URL for browser access (user's browser → guacamole)
const GUAC_PUBLIC_URL = process.env.GUACAMOLE_PUBLIC_URL || process.env.GUACAMOLE_URL || 'http://localhost:8085/guacamole';
const GUAC_USER = process.env.GUACAMOLE_ADMIN_USER || 'guacadmin';
const GUAC_PASS = process.env.GUACAMOLE_ADMIN_PASS || 'guacadmin';

let authToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (authToken && Date.now() < tokenExpiry) return authToken;
  const res = await axios.post(`${GUAC_API_URL}/api/tokens`,
    `username=${GUAC_USER}&password=${GUAC_PASS}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  authToken = res.data.authToken;
  tokenExpiry = Date.now() + 10 * 60 * 1000;
  return authToken;
}

/**
 * Performance-optimized RDP parameters for Windows VMs.
 * These reduce bandwidth by 50-70% and improve perceived speed.
 */
function getRdpParams(publicIp, adminUsername, adminPassword, port) {
  return {
    // Connection
    hostname: publicIp,
    port: port || '3389',
    username: adminUsername,
    password: adminPassword,
    security: 'any',
    'ignore-cert': 'true',

    // === PERFORMANCE TUNING ===
    // Color depth: 16-bit instead of 32-bit — halves bandwidth
    'color-depth': '16',

    // Resize: reconnect is heavier but smoother than display-update
    'resize-method': 'display-update',

    // Disable visual fluff — each one saves bandwidth
    'enable-wallpaper': 'false',
    'enable-theming': 'false',
    'enable-font-smoothing': 'false',       // Big bandwidth saver
    'enable-full-window-drag': 'false',
    'enable-desktop-composition': 'false',  // Disables Aero/transparency
    'enable-menu-animations': 'false',
    'disable-bitmap-caching': 'false',      // Keep caching ON (false = don't disable)

    // Compression: use JPEG for lossy areas (photos, videos)
    'enable-drive': 'false',
    'enable-printing': 'false',
    'enable-audio': 'false',                // Disable audio redirection

    // WebSocket: force WebSocket for lower latency (no HTTP polling)
    'wol-send-packet': 'false',

    // Clipboard
    'disable-copy': 'false',
    'disable-paste': 'false',

    // Timezone
    'timezone': 'Asia/Kolkata',
  };
}

/**
 * Performance-optimized SSH parameters for Linux VMs.
 */
function getSshParams(publicIp, adminUsername, adminPassword, port) {
  return {
    hostname: publicIp,
    port: port || '22',
    username: adminUsername,
    password: adminPassword,
    'color-scheme': 'gray-black',          // Lighter than green-black
    'font-size': '14',
    'font-name': 'monospace',
    'scrollback': '2000',
    'terminal-type': 'xterm-256color',
    'backspace': '127',
    'timezone': 'Asia/Kolkata',
    // Enable SFTP for file upload/download
    'enable-sftp': 'true',
    'sftp-root-directory': '/home',
  };
}

/**
 * VNC parameters for KasmVNC-enabled Linux VMs.
 * KasmVNC is GPU-accelerated and much faster than RDP for Linux desktops.
 */
function getVncParams(publicIp, adminPassword, port) {
  return {
    hostname: publicIp,
    port: port || '5901',
    password: adminPassword,

    // === KASMVNC PERFORMANCE ===
    'color-depth': '24',                   // KasmVNC handles 24-bit efficiently
    'swap-red-blue': 'false',
    'cursor': 'local',                     // Local cursor = zero latency for mouse
    'read-only': 'false',
    'dest-port': '',
    'recording-exclude-output': '',
    'recording-exclude-mouse': '',
    'enable-audio': 'false',

    // Clipboard
    'disable-copy': 'false',
    'disable-paste': 'false',
  };
}

/**
 * Create a Guacamole connection for a VM.
 * Auto-detects best protocol: VNC (KasmVNC) > RDP (Windows) > SSH (Linux fallback)
 */
async function createVmConnection({ vmName, publicIp, adminUsername, adminPassword, os, port, useVnc = false, vncPort }) {
  const token = await getToken();
  const isWindows = (os || '').toLowerCase().includes('windows');

  let protocol, parameters;

  if (useVnc && !isWindows) {
    // KasmVNC — best performance for Linux GUI
    protocol = 'vnc';
    parameters = getVncParams(publicIp, adminPassword, vncPort || port || '5901');
  } else if (isWindows) {
    // RDP — only option for Windows, but heavily tuned
    protocol = 'rdp';
    parameters = getRdpParams(publicIp, adminUsername, adminPassword, port);
  } else {
    // SSH — fallback for Linux without VNC
    protocol = 'ssh';
    parameters = getSshParams(publicIp, adminUsername, adminPassword, port);
  }

  const connection = {
    parentIdentifier: 'ROOT',
    name: vmName,
    protocol,
    parameters,
    attributes: {
      'max-connections': '3',
      'max-connections-per-user': '2',
      'weight': '',
      'failover-only': '',
      'guacd-port': '',
      'guacd-encryption': '',
    },
  };

  try {
    // Check if connection already exists (reuse it)
    const existing = await findExistingConnection(token, vmName);
    if (existing) {
      const clientId = Buffer.from(`${existing}\0c\0mysql`).toString('base64');
      return {
        connectionId: existing,
        accessUrl: `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${token}`,
        protocol,
      };
    }

    const res = await axios.post(
      `${GUAC_API_URL}/api/session/data/mysql/connections?token=${token}`,
      connection
    );

    const connectionId = res.data.identifier;
    const clientId = Buffer.from(`${connectionId}\0c\0mysql`).toString('base64');

    // Get a fresh auth token so user skips the login page
    const authToken = await getToken();
    const accessUrl = `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${authToken}`;

    logger.info(`Guacamole connection created: ${vmName} (${protocol}) → ${connectionId}`);

    return { connectionId, accessUrl, protocol };
  } catch (err) {
    logger.error(`Failed to create Guacamole connection for ${vmName}: ${err.response?.data?.message || err.message}`);
    throw err;
  }
}

/**
 * Find existing connection by name to avoid duplicates.
 */
async function findExistingConnection(token, vmName) {
  try {
    const res = await axios.get(`${GUAC_API_URL}/api/session/data/mysql/connections?token=${token}`);
    const connections = res.data;
    for (const [id, conn] of Object.entries(connections)) {
      if (conn.name === vmName) return id;
    }
  } catch {}
  return null;
}

async function deleteVmConnection(connectionId) {
  const token = await getToken();
  try {
    await axios.delete(`${GUAC_API_URL}/api/session/data/mysql/connections/${connectionId}?token=${token}`);
    logger.info(`Guacamole connection deleted: ${connectionId}`);
  } catch (err) {
    logger.error(`Failed to delete Guacamole connection ${connectionId}: ${err.message}`);
  }
}

async function createGuacUser(email, password) {
  const token = await getToken();
  try {
    await axios.post(`${GUAC_API_URL}/api/session/data/mysql/users?token=${token}`, {
      username: email, password, attributes: { disabled: '', expired: '' },
    });
    logger.info(`Guacamole user created: ${email}`);
  } catch (err) {
    if (err.response?.status !== 400) logger.error(`Failed to create Guacamole user ${email}: ${err.message}`);
  }
}

async function grantConnectionAccess(email, connectionId) {
  const token = await getToken();
  try {
    await axios.patch(
      `${GUAC_API_URL}/api/session/data/mysql/users/${encodeURIComponent(email)}/permissions?token=${token}`,
      [{ op: 'add', path: `/connectionPermissions/${connectionId}`, value: 'READ' }]
    );
  } catch (err) {
    logger.error(`Failed to grant access: ${err.message}`);
  }
}

async function getVmAccessUrl({ vmName, publicIp, adminUsername, adminPassword, os, useVnc, vncPort }) {
  return createVmConnection({ vmName, publicIp, adminUsername, adminPassword, os, useVnc, vncPort });
}

/**
 * Create a sharing profile for an existing connection.
 *
 * Guacamole sharing profiles let a second user join an ACTIVE session
 * without disconnecting the original user. This powers the "Shadow"
 * button in Lab Console — trainer can watch/control a student's VM
 * while the student keeps working.
 *
 * How it works:
 *   1. Find the connection for the VM (by name)
 *   2. Create a sharing profile on that connection (read-write or read-only)
 *   3. Get the active session's share link
 *   4. Trainer opens the link → sees the student's live screen
 *
 * Note: For Windows RDP, this uses Guacamole's connection sharing
 * (multiple Guacamole clients viewing the same guacd RDP session).
 * The RDP session itself is NOT duplicated — both viewers see the
 * exact same Windows desktop.
 */
async function createShadowSession(vmName, readOnly = false) {
  const token = await getToken();

  // 1. Find the connection
  const connectionId = await findExistingConnection(token, vmName);
  if (!connectionId) {
    throw new Error(`No Guacamole connection found for "${vmName}". The VM must have an active Guacamole session.`);
  }

  // 2. Create a sharing profile on the connection
  const sharingProfile = {
    name: `shadow-${vmName}-${Date.now()}`,
    primaryConnectionIdentifier: connectionId,
    parameters: {
      'read-only': readOnly ? 'true' : 'false',
    },
    attributes: {},
  };

  try {
    const res = await axios.post(
      `${GUAC_API_URL}/api/session/data/mysql/sharingProfiles?token=${token}`,
      sharingProfile
    );

    const sharingProfileId = res.data.identifier;
    logger.info(`[shadow] Sharing profile created: ${sharingProfileId} for connection ${connectionId} (${vmName})`);

    // 3. Generate the share link using the sharing profile
    // The client ID for a sharing profile uses "s" instead of "c"
    const clientId = Buffer.from(`${sharingProfileId}\0s\0mysql`).toString('base64');
    const freshToken = await getToken();
    const shadowUrl = `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${freshToken}`;

    return {
      shadowUrl,
      sharingProfileId,
      connectionId,
      vmName,
      readOnly,
      expiresIn: '10 minutes (Guacamole token TTL)',
    };
  } catch (err) {
    // If sharing profiles aren't supported (Guacamole version too old),
    // fall back to just opening a second connection to the same VM.
    // This works for VNC (multiple viewers) but may kick off RDP users.
    logger.warn(`[shadow] Sharing profile creation failed (${err.message}). Falling back to direct connection.`);

    const clientId = Buffer.from(`${connectionId}\0c\0mysql`).toString('base64');
    const freshToken = await getToken();
    const fallbackUrl = `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${freshToken}`;

    return {
      shadowUrl: fallbackUrl,
      sharingProfileId: null,
      connectionId,
      vmName,
      readOnly: false,
      fallback: true,
      note: 'Using direct connection (sharing profiles not available). For RDP, this may disconnect the student. For VNC/SSH, both users will be connected.',
    };
  }
}

/**
 * Clean up a sharing profile after the trainer is done shadowing.
 */
async function deleteShadowSession(sharingProfileId) {
  if (!sharingProfileId) return;
  const token = await getToken();
  try {
    await axios.delete(`${GUAC_API_URL}/api/session/data/mysql/sharingProfiles/${sharingProfileId}?token=${token}`);
    logger.info(`[shadow] Sharing profile deleted: ${sharingProfileId}`);
  } catch (err) {
    logger.error(`[shadow] Failed to delete sharing profile ${sharingProfileId}: ${err.message}`);
  }
}

module.exports = {
  createVmConnection, deleteVmConnection, createGuacUser,
  grantConnectionAccess, getVmAccessUrl, findExistingConnection,
  createShadowSession, deleteShadowSession,
};
