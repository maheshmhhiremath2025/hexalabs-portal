// KasmVNC reverse proxy — customers reach their VMs via the portal
// domain (https://api.getlabs.cloud/kasm/<vmName>/) instead of a raw
// public IP, which many corporate firewalls block.
//
// Flow: browser -> nginx (api.getlabs.cloud) -> this Express route ->
//       http-proxy-middleware -> <vm.publicIp>:6901
//
// Notes:
//   - The express router is mounted at /kasm in index.js
//   - Upstream resolution is per-request: we look up the VM's publicIp
//     from Mongo by vmName, so IP changes (new deploy/start) are picked
//     up without a restart.
//   - WebSockets are required for KasmVNC (noVNC). ws:true is critical.
//   - We skip the normal JSON body parser on this path (handled by
//     mounting middleware BEFORE body-parser in index.js).

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const router = express.Router();

// Cheap in-memory cache so we don't hit Mongo on every asset request.
// KasmVNC's web UI pulls dozens of static files on first load.
const upstreamCache = new Map();  // vmName -> { ip, authHeader, expiresAt }
const CACHE_TTL_MS = 30 * 1000;

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

router.use('/:vmName', async (req, res, next) => {
  const { vmName } = req.params;
  const upstream = await resolveUpstream(vmName);
  if (!upstream) {
    return res.status(404).send(`Unknown or stopped VM: ${vmName}`);
  }
  req._kasmUpstream = `https://${upstream.ip}:6901`;
  req._kasmAuthHeader = upstream.authHeader;
  next();
});

router.use('/:vmName', createProxyMiddleware({
  target: 'https://placeholder:6901',  // overridden by router below
  router: (req) => req._kasmUpstream,
  ws: true,
  changeOrigin: true,
  secure: false,        // Kasm uses a self-signed cert by default
  // KasmVNC's websockify emits non-strict HTTP framing that Node 22's
  // parser rejects. Combined with the `--insecure-http-parser` node
  // flag on PM2, this keeps the connection alive.
  proxyTimeout: 60000,
  timeout: 60000,
  pathRewrite: (path, req) => {
    // Strip /kasm/<vmName> prefix so KasmVNC sees the raw path
    const prefix = `/kasm/${req.params.vmName}`;
    return path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
  },
  on: {
    proxyReq: (proxyReq, req) => {
      // Inject the VM's Kasm Basic-auth so the browser doesn't get prompted
      if (req._kasmAuthHeader) proxyReq.setHeader('Authorization', req._kasmAuthHeader);
      // Force Connection: close ONLY for regular HTTP (non-upgrade).
      // WebSocket upgrades need Connection: Upgrade to reach Kasm's
      // /websockify endpoint — that's what makes the desktop actually
      // connect. Stripping it here would leave the UI stuck at
      // "Connecting...".
      const upgrade = (req.headers.upgrade || '').toLowerCase();
      if (upgrade !== 'websocket') {
        proxyReq.setHeader('Connection', 'close');
      }
    },
    proxyReqWs: (proxyReq, req) => {
      // WebSocket upgrade also needs the auth header (noVNC upgrades after load)
      if (req._kasmAuthHeader) proxyReq.setHeader('Authorization', req._kasmAuthHeader);
    },
    error: (err, req, res) => {
      logger.error(`[kasm-proxy] ${req.params?.vmName}: ${err.message}`);
      if (res && !res.headersSent) {
        res.status(502).send('Lab is still booting or unreachable. Wait 30s and retry.');
      }
    },
  },
}));

module.exports = router;
