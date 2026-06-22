/**
 * AWS DCV Nginx Manager
 *
 * Per-VM nginx server block that proxies https://portal.labsoncloud.online:<dcvPort>
 * → https://<ec2-ip>:8443 (the NICE DCV web client on the EC2 instance).
 *
 * Why a separate file from container-upstreams.conf:
 *   - Containers use a $container_upstream map keyed by $container_port.
 *   - DCV needs proxy_ssl_verify off (EC2 cert is self-signed) and a
 *     dedicated server block per VM with the EC2 IP baked into proxy_pass.
 *
 * State sources:
 *   - In-memory `dcvVms` map (port → ec2Ip) for runtime add/remove.
 *   - rebuildFromDb() repopulates from Mongo on backend boot.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const { logger } = require('../plugins/logger');

const CONF_FILE = process.env.NGINX_DCV_CONF_PATH || '/etc/nginx/conf.d/dcv-vms.conf';
const SSL_CERT = '/etc/letsencrypt/live/hexalabs.online/fullchain.pem';
const SSL_KEY  = '/etc/letsencrypt/live/hexalabs.online/privkey.pem';

// In-memory state: port → ec2Ip
const dcvVms = new Map();

let writeLock = Promise.resolve();

function serializeBlock(port, ip) {
  return `# DCV VM (auto-managed by awsDcvNginx.js)
server {
    listen ${port} ssl;
    server_name hexalabs.online;
    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {
        proxy_pass https://${ip}:8443;
        proxy_ssl_verify off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
`;
}

function serializeAll() {
  let s = '# Auto-managed by services/awsDcvNginx.js — do not edit manually.\n';
  s += '# Per-VM NICE DCV reverse proxy. Maps hexalabs.online:<port> → https://<ec2-ip>:8443.\n\n';
  for (const [port, ip] of dcvVms) {
    s += serializeBlock(port, ip) + '\n';
  }
  return s;
}

function writeAndReload() {
  const content = serializeAll();
  const tmpFile = CONF_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, CONF_FILE);
  } catch (err) {
    logger.error(`[dcv-nginx] write failed: ${err.message}`);
    try { fs.unlinkSync(tmpFile); } catch {}
    return false;
  }
  try {
    execSync('sudo nginx -t 2>&1', { timeout: 10000 });
    execSync('sudo nginx -s reload 2>&1', { timeout: 10000 });
    logger.info(`[dcv-nginx] reloaded — ${dcvVms.size} VM entries`);
    return true;
  } catch (err) {
    logger.error(`[dcv-nginx] reload failed: ${err.message}`);
    return false;
  }
}

function withLock(fn) {
  writeLock = writeLock.then(fn).catch(err => {
    logger.error(`[dcv-nginx] lock error: ${err.message}`);
  });
  return writeLock;
}

async function addDcvVm(port, ec2Ip) {
  return withLock(() => {
    if (!port || !ec2Ip) return false;
    dcvVms.set(Number(port), ec2Ip);
    return writeAndReload();
  });
}

async function removeDcvVm(port) {
  return withLock(() => {
    if (dcvVms.delete(Number(port))) return writeAndReload();
    return true;
  });
}

async function rebuildFromDb() {
  try {
    const VM = require('../models/vm');
    const aws = await VM.find({ cloud: 'aws', dcv: true, dcvPort: { $exists: true, $ne: null }, isAlive: true }, 'dcvPort publicIp');
    dcvVms.clear();
    for (const v of aws) {
      if (v.dcvPort && v.publicIp) dcvVms.set(v.dcvPort, v.publicIp);
    }
    writeAndReload();
    logger.info(`[dcv-nginx] rebuilt from DB — ${dcvVms.size} entries`);
  } catch (err) {
    logger.error(`[dcv-nginx] rebuildFromDb failed: ${err.message}`);
  }
}

async function allocateFreePort() {
  const VM = require('../models/vm');
  const used = await VM.find({ dcvPort: { $exists: true, $ne: null } }, 'dcvPort').lean();
  const usedSet = new Set(used.map(v => Number(v.dcvPort)).filter(Boolean));
  for (let p = 30001; p <= 39999; p++) {
    if (!usedSet.has(p)) return p;
  }
  throw new Error('[dcv-nginx] no free port in 30001-39999');
}

module.exports = { addDcvVm, removeDcvVm, rebuildFromDb, allocateFreePort };
