const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../plugins/logger');

// Internal URL for API calls (backend → guacamole container)
const GUAC_API_URL = process.env.GUACAMOLE_URL || 'http://localhost:8085/guacamole';
// Public URL for browser access (user's browser → guacamole)
const GUAC_PUBLIC_URL = process.env.GUACAMOLE_PUBLIC_URL || process.env.GUACAMOLE_URL || 'http://localhost:8085/guacamole';
const GUAC_USER = process.env.GUACAMOLE_ADMIN_USER || 'guacadmin';
const GUAC_PASS = process.env.GUACAMOLE_ADMIN_PASS || 'guacadmin';
// Secret used to derive per-end-user Guacamole passwords. Falls back to
// the admin password so deployments that haven't set this still work.
const GUAC_USER_SECRET = process.env.GUACAMOLE_USER_SECRET || GUAC_PASS;
// Secret used to sign /open/:conn permanent email links. Separate from
// GUAC_USER_SECRET so rotating one doesn't invalidate the other.
const GUAC_LINK_SECRET = process.env.GUACAMOLE_LINK_SECRET || GUAC_USER_SECRET;

let authToken = null;
let tokenExpiry = 0;

async function getToken(forceRefresh = false) {
  if (!forceRefresh && authToken && Date.now() < tokenExpiry) return authToken;
  // Always get a fresh token
  authToken = null;
  tokenExpiry = 0;
  const res = await axios.post(`${GUAC_API_URL}/api/tokens`,
    `username=${encodeURIComponent(GUAC_USER)}&password=${encodeURIComponent(GUAC_PASS)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  authToken = res.data.authToken;
  tokenExpiry = Date.now() + 5 * 60 * 1000; // 5 min cache (safer than 10)
  return authToken;
}

// Deterministic per-identity password. Same username always → same password,
// so we can re-auth without storing state. Identity is usually the VM name
// (one Guacamole user per VM, shared by everyone who has portal access to
// that VM). That way the Guacamole top-bar shows "ubtest-1" instead of
// leaking the portal user's email.
function derivePassword(identity) {
  return crypto.createHmac('sha256', GUAC_USER_SECRET)
    .update(String(identity).toLowerCase()).digest('hex');
}

// Ensure a Guacamole user exists for this identity with our deterministic
// password. Creates on first call, resets the password on subsequent calls
// (in case the user was created with a different password previously).
// Does NOT touch permissions.
async function ensureUser(identity, adminToken) {
  const username = identity;
  const password = derivePassword(identity);
  // 1. Try to create. Idempotent — 400 if already exists.
  try {
    await axios.post(`${GUAC_API_URL}/api/session/data/mysql/users?token=${adminToken}`, {
      username, password, attributes: { disabled: '', expired: '' },
    });
  } catch (err) {
    if (err.response?.status !== 400) throw err;
  }
  // 2. Force-set the password via admin PUT so re-auth with our derived
  //    password works even if the user existed with a different password.
  try {
    await axios.put(
      `${GUAC_API_URL}/api/session/data/mysql/users/${encodeURIComponent(username)}?token=${adminToken}`,
      { username, password, attributes: { disabled: '', expired: '' } }
    );
  } catch (err) {
    logger.warn(`[guac] Could not reset password for ${email}: ${err.message}`);
  }
  return password;
}

// Authenticate as the VM-scoped Guacamole user and return their token.
async function loginAsUser(identity) {
  const password = derivePassword(identity);
  const res = await axios.post(`${GUAC_API_URL}/api/tokens`,
    `username=${encodeURIComponent(identity)}&password=${encodeURIComponent(password)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.authToken;
}

// Grant READ on a connection to the VM-scoped Guacamole user. Idempotent —
// 400 ("permission already exists") is swallowed.
async function grantRead(adminToken, identity, connectionId) {
  try {
    await axios.patch(
      `${GUAC_API_URL}/api/session/data/mysql/users/${encodeURIComponent(identity)}/permissions?token=${adminToken}`,
      [{ op: 'add', path: `/connectionPermissions/${connectionId}`, value: 'READ' }]
    );
  } catch (err) {
    if (err.response?.status !== 400) {
      logger.warn(`[guac] Failed to grant READ ${connectionId} to ${identity}: ${err.message}`);
    }
  }
}

// Wrapper to auto-retry on 403 with fresh token
async function guacApiCall(fn) {
  try {
    return await fn(await getToken());
  } catch (err) {
    if (err.response?.status === 403) {
      logger.warn('Guacamole token expired — refreshing and retrying...');
      return await fn(await getToken(true));
    }
    throw err;
  }
}

/**
 * Performance-optimized RDP parameters for Windows VMs.
 * These reduce bandwidth by 50-70% and improve perceived speed.
 */
function getRdpParams(publicIp, adminUsername, adminPassword, port, opts = {}) {
  // xrdp (Linux desktop) doesn't support NLA out of the box — must use
  // 'rdp' security. Windows servers always support NLA and prefer it.
  const security = opts.xrdp ? 'rdp' : 'nla';
  return {
    // Connection
    hostname: publicIp,
    port: port || '3389',
    username: adminUsername,
    password: adminPassword,
    security,
    'ignore-cert': 'true',

    // === AGGRESSIVE PERFORMANCE TUNING ===

    // Color depth: 16-bit — halves bandwidth vs 32-bit
    'color-depth': '16',

    // Resize method: display-update avoids full reconnects
    'resize-method': 'display-update',

    // Disable ALL visual effects — massive bandwidth savings
    'enable-wallpaper': 'false',
    'enable-theming': 'false',
    'enable-font-smoothing': 'false',
    'enable-full-window-drag': 'false',
    'enable-desktop-composition': 'false',
    'enable-menu-animations': 'false',

    // Bitmap caching — KEEP ON (reduces repeated pixel transfers)
    'disable-bitmap-caching': 'false',
    'disable-offscreen-caching': 'false',
    'disable-glyph-caching': 'false',

    // Disable unused features — reduces overhead
    'enable-drive': 'false',
    'enable-printing': 'false',
    'enable-audio': 'false',
    'enable-audio-input': 'false',
    'wol-send-packet': 'false',

    // Force RDP compression + performance flags
    'create-recording-path': 'false',
    'force-lossless': 'false',

    // Clipboard — keep enabled
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
async function createVmConnection({ vmName, publicIp, adminUsername, adminPassword, os, port, useVnc = false, vncPort, xrdp = false }) {
  const isWindows = (os || '').toLowerCase().includes('windows');
  const multi = !isWindows && xrdp;   // Linux with xrdp → provide both SSH and RDP

  let protocol, parameters;
  // Give Linux-xrdp its own connection name so the SSH connection for the
  // same VM isn't overwritten when the desktop is opened.
  let targetName = vmName;

  if (useVnc && !isWindows) {
    protocol = 'vnc';
    parameters = getVncParams(publicIp, adminPassword, vncPort || port || '5901');
  } else if (isWindows) {
    protocol = 'rdp';
    parameters = getRdpParams(publicIp, adminUsername, adminPassword, port);
  } else if (xrdp) {
    protocol = 'rdp';
    parameters = getRdpParams(publicIp, adminUsername, adminPassword, port || '3389', { xrdp: true });
    targetName = `${vmName}-desktop`;   // keep <vmName> reserved for SSH
  } else {
    protocol = 'ssh';
    parameters = getSshParams(publicIp, adminUsername, adminPassword, port);
  }

  const connection = {
    parentIdentifier: 'ROOT',
    name: targetName,
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
    // Use guacApiCall for auto-retry on 403
    return await guacApiCall(async (token) => {
    // Check if connection already exists (reuse it)
    const existing = await findExistingConnection(token, targetName);
    let connectionId;
    if (existing) {
      connectionId = existing;
      // Update connection parameters (IP may have changed after restart)
      try {
        await axios.put(
          `${GUAC_API_URL}/api/session/data/mysql/connections/${existing}?token=${token}`,
          { ...connection, identifier: existing }
        );
        logger.info(`Guacamole connection updated: ${vmName} (${protocol}) → ${existing}`);
      } catch (updateErr) {
        logger.warn(`Failed to update connection ${existing}: ${updateErr.message}`);
      }
    } else {
      const res = await axios.post(
        `${GUAC_API_URL}/api/session/data/mysql/connections?token=${token}`,
        connection
      );
      connectionId = res.data.identifier;
      logger.info(`Guacamole connection created: ${vmName} (${protocol}) → ${connectionId}`);
    }

    // Identity in Guacamole = the VM name. One Guacamole user per VM,
    // shared by everyone who has portal access to that VM. Grants READ
    // only on the connection(s) for this VM, so the Guacamole top-bar
    // shows "ubtest-1" (not a portal email) and the user can only see
    // their own VM's connections. For Linux+xrdp, every call (SSH and
    // RDP) grants its own connectionId to the same vmName identity →
    // both tiles show up on the Guacamole home page.
    await ensureUser(vmName, token);
    await grantRead(token, vmName, connectionId);
    const urlToken = await loginAsUser(vmName);

    const clientId = Buffer.from(`${connectionId}\0c\0mysql`).toString('base64');
    // For Linux+xrdp we always want the user to land on Guacamole's
    // home page so they can pick between Desktop (RDP) and Terminal
    // (SSH). For single-connection VMs we deep-link straight in.
    const accessUrl = multi
      ? `${GUAC_PUBLIC_URL}/#/?token=${urlToken}`
      : `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${urlToken}`;

    return { connectionId, accessUrl, protocol };
    }); // close guacApiCall
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

async function getVmAccessUrl({ vmName, publicIp, adminUsername, adminPassword, os, useVnc, vncPort, xrdp }) {
  const isWindows = (os || '').toLowerCase().includes('windows');
  // For Linux-xrdp, make sure BOTH the SSH and RDP connections exist
  // before we return the home URL — otherwise the sidebar shows only one.
  // Each createVmConnection call grants the vmName-scoped Guac user READ
  // on its own connection, so after both calls the user can see both
  // tiles on Guacamole home.
  if (!isWindows && xrdp) {
    try {
      await createVmConnection({ vmName, publicIp, adminUsername, adminPassword, os, useVnc: false });  // SSH
    } catch (e) { logger.warn(`[guac] SSH upsert for ${vmName}: ${e.message}`); }
  }
  return createVmConnection({ vmName, publicIp, adminUsername, adminPassword, os, useVnc, vncPort, xrdp });
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

  // Mint a URL token scoped to the VM-named Guacamole user (same identity
  // as /browser-access). Trainer is just another viewer of the VM's Guac
  // user; the primary connection's READ permission covers sharing profiles.
  async function urlTokenFor(permissionTarget) {
    await ensureUser(vmName, token);
    await grantRead(token, vmName, permissionTarget);
    return loginAsUser(vmName);
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
    // The client ID for a sharing profile uses "s" instead of "c".
    // Shadow sessions use the primary connection's READ permission — the
    // sharing profile itself inherits from it. So we grant READ on the
    // connection (not the sharing profile).
    const clientId = Buffer.from(`${sharingProfileId}\0s\0mysql`).toString('base64');
    const urlToken = await urlTokenFor(connectionId);
    const shadowUrl = `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${urlToken}`;

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
    const urlToken = await urlTokenFor(connectionId);
    const fallbackUrl = `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${urlToken}`;

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

// ─── Permanent email links (signed + forever-valid) ─────────────────────
//
// Problem: URLs with Guac tokens baked in (what emails used to carry) expire
// after ~60 min. Solution: email carries a signed identifier; backend
// verifies the HMAC and mints a FRESH Guac token per click, then 302s to
// Guacamole. Links keep working as long as the connection exists.

function signOpenLink(connName) {
  return crypto.createHmac('sha256', GUAC_LINK_SECRET).update(String(connName)).digest('hex').slice(0, 32);
}

function verifyOpenLink(connName, sig) {
  const expected = signOpenLink(connName);
  if (!sig || sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// Build an email-safe permanent URL that opens the given connection in
// Guacamole. Verified + redirected by the GET /open/:conn route.
function buildOpenInBrowserUrl(appBaseUrl, connName) {
  const base = (appBaseUrl || process.env.APP_BASE_URL || 'https://getlabs.cloud').replace(/\/+$/, '');
  return `${base}/open/${encodeURIComponent(connName)}?sig=${signOpenLink(connName)}`;
}

// Resolve a signed /open/:conn hit into a ready-to-redirect Guacamole URL.
// Returns { accessUrl } on success, null on bad sig / missing connection.
async function resolveOpenLink(connName, sig) {
  if (!verifyOpenLink(connName, sig)) return null;
  return await guacApiCall(async (token) => {
    const connId = await findExistingConnection(token, connName);
    if (!connId) return null;
    await ensureUser(connName, token);
    await grantRead(token, connName, connId);
    const urlTok = await loginAsUser(connName);
    const clientId = Buffer.from(`${connId}\0c\0mysql`).toString('base64');
    return { accessUrl: `${GUAC_PUBLIC_URL}/#/client/${clientId}?token=${urlTok}`, connectionId: connId };
  });
}

module.exports = {
  createVmConnection, deleteVmConnection, createGuacUser,
  grantConnectionAccess, getVmAccessUrl, findExistingConnection,
  createShadowSession, deleteShadowSession,
  ensureUser, grantRead, loginAsUser,
  buildOpenInBrowserUrl, resolveOpenLink, signOpenLink, verifyOpenLink,
};
