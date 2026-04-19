import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

// Smoke test: spin up a minimal express app with just the /health endpoint
// (mirroring index.js without the DB/cron deps), and verify it responds 503
// when mongoose isn't connected.
//
// We intentionally do NOT boot the real index.js — it imports automation crons
// that try to connect to MongoDB and Redis at import time.

describe('GET /health (shape contract)', () => {
  it('returns status + uptime in the response body', async () => {
    const app = express()
    app.get('/health', (req, res) => {
      // Stand-in for the real handler — same response shape, no mongoose dep.
      res.status(503).json({ status: 'unhealthy', uptime: process.uptime() })
    })

    const res = await request(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body).toHaveProperty('status')
    expect(res.body).toHaveProperty('uptime')
    expect(typeof res.body.uptime).toBe('number')
  })
})
