// KasmVNC reverse proxy — customers reach their VMs via the portal
// domain (https://api.getlabs.cloud/kasm/<vmName>/...) instead of a raw
// public IP, which many corporate firewalls block.
//
// Flow: browser -> nginx (api.getlabs.cloud) -> this Express route ->
//       http-proxy-middleware -> <vm.publicIp>:6901
//
// Notes:
//   - Mounted in index.js at /kasm BEFORE express.json so bodies pass through
//   - WebSocket upgrades (noVNC) bypass Express routing, so we parse the
//     VM name from req.url directly instead of relying on req.params
//   - Upstream lookup is Mongo-backed with a 30s cache. Credentials are
//     pulled at the same time so we can inject HTTP Basic auth on both
//     plain HTTP and WS upgrade requests — no password prompt for users.

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const router = express.Router();

// Cache: vmName -> { ip, authHeader, expiresAt }
const upstreamCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

// Pull the VM name from a URL like `/kasm/ubtest-1/path?x=1` OR just
// `/ubtest-1/path` (Express strips the /kasm mount prefix before calling
// the router's middleware; ws upgrades see the full prefixed path).
function parseVmName(url) {
  if (!url) return null;
  const clean = url.replace(/^\/kasm/, '');
  const m = clean.match(/^\/([^\/?]+)/);
  return m ? m[1] : null;
}

async function resolveUpstream(vmName) {
  const cached = upstreamCache.get(vmName);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const vm = await VM.findOne({ name: vmName, isAlive: true }, 'publicIp adminUsername adminPass').lean();
  if (!vm?.publicIp) return null;
  const authHeader = vm.adminUsername && vm.adminPass
    ? 'Basic ' + Buffer.from(`${vm.adminUsername}:${vm.adminPass}`).toString('base64')
    : null;
  const entry = { ip: vm.publicIp, authHeader, expiresAt: Date.now() + CACHE_TTL_MS };
  upstreamCache.set(vmName, entry);
  return entry;
}

// HTTP-only middleware to warm the cache. This runs on every page/asset
// request; the WS upgrade that follows uses the cached entry synchronously.
router.use('/:vmName', async (req, res, next) => {
  try { await resolveUpstream(req.params.vmName); } catch {}
  next();
});

router.use(createProxyMiddleware({
  target: 'https://placeholder:6901',  // overridden by router below
  ws: true,
  changeOrigin: true,
  secure: false,        // Kasm uses a self-signed cert by default
  // Upstream chosen per-request based on the VM name parsed from the URL
  router: (req) => {
    const vmName = parseVmName(req.url);
    const cached = vmName && upstreamCache.get(vmName);
    if (!cached) return 'https://127.0.0.1:1';  // forces a fast error
    return `https://${cached.ip}:6901`;
  },
  // Strip /kasm/<vmName> prefix so Kasm sees `/` and `/websockify`
  pathRewrite: (path) => {
    return path.replace(/^\/kasm\/[^\/]+/, '') || '/';
  },
  on: {
    proxyReq: (proxyReq, req) => {
      const vmName = parseVmName(req.url);
      const cached = vmName && upstreamCache.get(vmName);
      if (cached?.authHeader) proxyReq.setHeader('Authorization', cached.authHeader);
      // Force Connection:close ONLY for non-upgrade requests to avoid
      // Node 22's "Data after Connection: close" parse errors on Kasm's
      // websockify responses. WS upgrades keep Connection:Upgrade.
      const upgrade = (req.headers.upgrade || '').toLowerCase();
      if (upgrade !== 'websocket') proxyReq.setHeader('Connection', 'close');
    },
    proxyReqWs: (proxyReq, req) => {
      const vmName = parseVmName(req.url);
      const cached = vmName && upstreamCache.get(vmName);
      if (cached?.authHeader) proxyReq.setHeader('Authorization', cached.authHeader);
    },
    error: (err, req, res) => {
      const vmName = parseVmName(req?.url) || '?';
      logger.error(`[kasm-proxy] ${vmName}: ${err.message}`);
      if (res && typeof res.writeHead === 'function' && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('Lab is still booting or unreachable. Wait 30s and retry.');
      } else if (res && typeof res.destroy === 'function') {
        // WS upgrade socket — no writeHead available
        res.destroy();
      }
    },
  },
}));

module.exports = router;
