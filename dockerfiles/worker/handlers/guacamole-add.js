// Guacamole registration — creates Guacamole connection(s) for a VM.
//
// Policy: for every VM, register ALWAYS-available access paths so the
// customer never sees "connection not found" in Guacamole's sidebar.
//
//   Windows: one connection <vmName>            (RDP, NLA security)
//   Linux  : one connection <vmName>            (SSH terminal — default)
//            one connection <vmName>-desktop    (RDP via xrdp, security=rdp)
//              *only if* data.hasXrdp === true (so existing templates
//              without xrdp installed don't show a broken connection).
//
// "Open in browser" in the portal picks the right one based on vm.hasXrdp
// (see routes/azure.js /azure/browser-access handler).

const axios = require('axios');
const { logger } = require('./../plugins/logger');

const GUAC_URL = process.env.GUACAMOLE_URL || 'https://labs.synergificsoftware.com';
const GUAC_USER = process.env.GUACAMOLE_ADMIN_USER || 'guacadmin';
const GUAC_PASS = process.env.GUACAMOLE_ADMIN_PASS || 'guacadmin';

async function getToken() {
  const res = await axios.post(`${GUAC_URL}/api/tokens`,
    `username=${encodeURIComponent(GUAC_USER)}&password=${encodeURIComponent(GUAC_PASS)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.authToken;
}

function rdpParams({ publicIp, adminUsername, adminPassword, security = 'nla' }) {
  return {
    hostname: publicIp, port: '3389',
    username: adminUsername, password: adminPassword,
    security, 'ignore-cert': 'true',
    'color-depth': '32',
    'resize-method': 'display-update',
    'enable-wallpaper': 'false',
    'enable-theming': 'false',
    'enable-font-smoothing': 'true',
    'enable-full-window-drag': 'false',
    'enable-desktop-composition': 'false',
    'enable-menu-animations': 'false',
    'disable-bitmap-caching': 'false',
    'disable-offscreen-caching': 'false',
    'disable-glyph-caching': 'false',
    'enable-audio': 'false',
    'enable-audio-input': 'false',
    'enable-printing': 'false',
    'enable-drive': 'false',
    'timezone': 'Asia/Kolkata',
  };
}

function sshParams({ publicIp, adminUsername, adminPassword }) {
  return {
    hostname: publicIp, port: '22',
    username: adminUsername, password: adminPassword,
    'color-scheme': 'gray-black',
    'font-size': '14',
    'font-name': 'monospace',
    'scrollback': '2000',
    'terminal-type': 'xterm-256color',
    'timezone': 'Asia/Kolkata',
  };
}

async function upsertConnection(token, name, protocol, parameters) {
  const conns = (await axios.get(`${GUAC_URL}/api/session/data/mysql/connections?token=${token}`)).data;
  let id = null;
  for (const [cid, c] of Object.entries(conns)) {
    if (c.name === name) { id = cid; break; }
  }
  const body = {
    parentIdentifier: 'ROOT', name, protocol, parameters,
    attributes: { 'max-connections': '5', 'max-connections-per-user': '5' },
  };
  if (id) {
    await axios.put(`${GUAC_URL}/api/session/data/mysql/connections/${id}?token=${token}`,
      { ...body, identifier: id });
    logger.info(`Guac upserted ${name} (${protocol}) → ${id} (updated)`);
    return id;
  }
  const res = await axios.post(`${GUAC_URL}/api/session/data/mysql/connections?token=${token}`, body);
  logger.info(`Guac upserted ${name} (${protocol}) → ${res.data.identifier} (created)`);
  return res.data.identifier;
}

const handler = async (job) => {
  const { adminUsername, adminPassword, os, publicIp, vmName, hasXrdp } = job.data;
  const isWindows = (os || '').toLowerCase().includes('windows');

  try {
    const token = await getToken();

    if (isWindows) {
      await upsertConnection(token, vmName, 'rdp',
        rdpParams({ publicIp, adminUsername, adminPassword, security: 'nla' }));
    } else {
      await upsertConnection(token, vmName, 'ssh',
        sshParams({ publicIp, adminUsername, adminPassword }));
      if (hasXrdp) {
        await upsertConnection(token, `${vmName}-desktop`, 'rdp',
          rdpParams({ publicIp, adminUsername, adminPassword, security: 'rdp' }));
      }
    }

    logger.info(`Guacamole setup complete for ${vmName} (os=${os}, hasXrdp=${!!hasXrdp})`);
    return `OK`;
  } catch (err) {
    logger.error(`Guacamole add error for ${vmName}: ${err.response?.data?.message || err.message}`);
    return `Guacamole setup failed: ${err.message}`;
  }
};

module.exports = handler;
