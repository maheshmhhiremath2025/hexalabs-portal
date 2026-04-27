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

// Warm cache on every HTTP request (must complete before proxy runs,
// because the proxy's `router` function is sync). WS upgrades arrive
// after the first HTTP load, so the cache is already hot by then.
router.use((req, res, next) => {
  const vmName = parseVmName(req.originalUrl || req.url);
  if (!vmName) return next();
  resolveUpstream(vmName)
    .then(entry => {
      if (!entry) return res.status(404).send(`Unknown or stopped VM: ${vmName}`);
      next();
    })
    .catch(err => {
      logger.error(`[kasm-proxy] cache warm failed for ${vmName}: ${err.message}`);
      next();
    });
});

router.use(createProxyMiddleware({
  target: 'https://placeholder:6901',  // overridden by router below
  ws: true,
  changeOrigin: true,
  secure: false,        // Kasm uses a self-signed cert by default
  // Upstream chosen per-request based on the VM name parsed from the URL.
  // Also stash the auth header on the req so the later proxyReq/proxyReqWs
  // hooks can find it even after pathRewrite has mutated req.url.
  router: (req) => {
    const vmName = parseVmName(req.originalUrl || req.url);
    const cached = vmName && upstreamCache.get(vmName);
    if (cached) req._kasmAuth = cached.authHeader;
    if (!cached) return 'https://127.0.0.1:1';
    return `https://${cached.ip}:6901`;
  },
  // Express already strips the /kasm mount prefix before the proxy
  // sees the URL, so only the /<vmName> segment remains. Strip that
  // so Kasm sees `/` and `/websockify` as it expects.
  pathRewrite: (path) => {
    // Also handle the WS-upgrade case where /kasm/<vm>/ws is still present
    const stripped = path.replace(/^\/kasm/, '').replace(/^\/[^\/?]+/, '');
    return stripped || '/';
  },
  on: {
    proxyReq: (proxyReq, req) => {
      if (req._kasmAuth) proxyReq.setHeader('Authorization', req._kasmAuth);
      // Force Connection:close ONLY for non-upgrade requests to avoid
      // Node 22's "Data after Connection: close" parse errors on Kasm's
      // websockify responses. WS upgrades keep Connection:Upgrade.
      const upgrade = (req.headers.upgrade || '').toLowerCase();
      if (upgrade !== 'websocket') proxyReq.setHeader('Connection', 'close');
    },
    proxyReqWs: (proxyReq, req) => {
      if (req._kasmAuth) proxyReq.setHeader('Authorization', req._kasmAuth);
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
