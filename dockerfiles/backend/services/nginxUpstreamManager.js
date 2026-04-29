/**
 * Nginx Upstream Manager
 *
 * Manages the /etc/nginx/conf.d/container-upstreams.conf map file
 * that routes container ports to the correct Docker host IP.
 *
 * Local containers → 127.0.0.1 (default, no entry needed)
 * Remote containers → Azure host IP (explicit entry)
 *
 * On create: addUpstream(port, remoteIp) → writes map + reloads nginx
 * On delete: removeUpstream(port) → removes entry + reloads nginx
 * On startup: rebuildFromDb() → regenerates full map from MongoDB
 */
const fs = require('fs');
const { execSync } = require('child_process');
const { logger } = require('../plugins/logger');

const MAP_FILE = process.env.NGINX_UPSTREAM_MAP_PATH || '/etc/nginx/conf.d/container-upstreams.conf';

// In-memory state: port → remoteIp
const upstreams = new Map();

// Simple async mutex to prevent concurrent writes
let writeLock = Promise.resolve();

function serialize() {
  let lines = [
    '# Auto-managed by containerService.js — do not edit manually.',
    '# Maps container port → upstream host IP for dynamic proxying.',
    'map $container_port $container_upstream {',
    '    default  127.0.0.1;',
  ];
  for (const [port, ip] of upstreams) {
    lines.push(`    ${port}  ${ip};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function writeAndReload() {
  const content = serialize();
  const tmpFile = MAP_FILE + '.tmp';

  try {
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, MAP_FILE);
  } catch (err) {
    logger.error(`[nginx-upstream] Failed to write map file: ${err.message}`);
    try { fs.unlinkSync(tmpFile); } catch {}
    return;
  }

  try {
    execSync('nginx -t 2>&1', { timeout: 10000 });
    execSync('nginx -s reload 2>&1', { timeout: 10000 });
    logger.info(`[nginx-upstream] Map updated (${upstreams.size} remote entries), nginx reloaded`);
  } catch (err) {
    logger.error(`[nginx-upstream] nginx reload failed: ${err.message}`);
  }
}

function withLock(fn) {
  writeLock = writeLock.then(fn).catch(err => {
    logger.error(`[nginx-upstream] Lock error: ${err.message}`);
  });
  return writeLock;
}

async function addUpstream(port, remoteIp) {
  return withLock(() => {
    upstreams.set(Number(port), remoteIp);
    writeAndReload();
  });
}

async function removeUpstream(port) {
  return withLock(() => {
    if (upstreams.delete(Number(port))) {
      writeAndReload();
    }
  });
}

async function rebuildFromDb() {
  try {
    const Container = require('../models/container');
    const remoteContainers = await Container.find({
      isAlive: true,
      dockerHostIp: { $exists: true, $ne: 'localhost' },
    }, 'vncPort extraPorts dockerHostIp');

    upstreams.clear();
    for (const c of remoteContainers) {
      if (c.vncPort && c.dockerHostIp) {
        upstreams.set(c.vncPort, c.dockerHostIp);
        // Also register extra port host ports (Jenkins, Kibana, etc.)
        if (c.extraPorts && c.extraPorts.length) {
          for (const ep of c.extraPorts) {
            upstreams.set(ep.hostPort, c.dockerHostIp);
          }
        }
      }
    }

    writeAndReload();
    logger.info(`[nginx-upstream] Rebuilt from DB: ${upstreams.size} remote container entries`);
  } catch (err) {
    logger.error(`[nginx-upstream] rebuildFromDb failed: ${err.message}`);
  }
}

module.exports = { addUpstream, removeUpstream, rebuildFromDb };
