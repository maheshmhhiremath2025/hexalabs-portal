import { describe, it, expect } from 'vitest'
import { extractEmailsFromText, isValidEmail } from '../utils/csvEmailParser'

describe('isValidEmail', () => {
  it.each([
    'simple@example.com',
    'firstname.lastname@example.co.in',
    'a+tag@sub.example.org',
  ])('accepts %s', (e) => {
    expect(isValidEmail(e)).toBe(true)
  })

  it.each(['', 'no-at-sign', 'two@@signs.com', 'missing@tld', '@no-local.com'])(
    'rejects %s',
    (e) => {
      expect(isValidEmail(e)).toBe(false)
    },
  )
})

describe('extractEmailsFromText', () => {
  it('returns [] for empty input', () => {
    expect(extractEmailsFromText('')).toEqual([])
  })

  it('extracts emails from a header-less single-column list', () => {
    const txt = 'a@b.com\nc@d.com\ne@f.com'
    expect(extractEmailsFromText(txt)).toEqual(['a@b.com', 'c@d.com', 'e@f.com'])
  })

  it('uses the email column when a header row is present', () => {
    const txt = 'Name,Email,Role\nAlice,alice@x.com,admin\nBob,bob@y.com,user'
    expect(extractEmailsFromText(txt)).toEqual(['alice@x.com', 'bob@y.com'])
  })

  it('handles quoted values with commas', () => {
    const txt = 'name,email\n"Doe, John","jdoe@x.com"'
    expect(extractEmailsFromText(txt)).toEqual(['jdoe@x.com'])
  })

  it('skips empty lines', () => {
    const txt = 'a@b.com\n\n\nc@d.com'
    expect(extractEmailsFromText(txt)).toEqual(['a@b.com', 'c@d.com'])
  })

  it('matches "E-Mail" / "Mail" header variants', () => {
    const txt = 'Name,E-Mail\nA,a@x.com'
    expect(extractEmailsFromText(txt)).toEqual(['a@x.com'])
  })
})
