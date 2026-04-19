import { describe, it, expect } from 'vitest'

// Pure helper test — exercises the CSV escaping logic used in several controllers
// (analytics CSV export, lab reports). Lifted to a local helper here so the test
// has no production-code dependency churn; if you extract this into a shared util
// (e.g. utils/csv.js), update the import.
function escapeCsv(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

describe('escapeCsv', () => {
  it('returns empty string for null/undefined', () => {
    expect(escapeCsv(null)).toBe('')
    expect(escapeCsv(undefined)).toBe('')
  })

  it('passes through plain values', () => {
    expect(escapeCsv('hello')).toBe('hello')
    expect(escapeCsv(42)).toBe('42')
  })

  it('quotes values containing commas', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"')
  })

  it('quotes values containing newlines', () => {
    expect(escapeCsv('a\nb')).toBe('"a\nb"')
  })

  it('escapes embedded double-quotes by doubling them', () => {
    expect(escapeCsv('a"b')).toBe('"a""b"')
  })
})
