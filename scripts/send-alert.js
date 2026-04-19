#!/usr/bin/env node
// Thin CLI wrapper around nodemailer, reuses backend's GMAIL_* env.
// Usage: send-alert.js "Subject line" "Body text"
// Exits 0 on success, 1 on failure. Safe to call from bash/cron.
//
// Recipients live here (not in env) so email routing is explicit and
// reviewable in git.

const path = require('path');
const fs = require('fs');

const BACKEND_DIR = '/root/synergific-portal/dockerfiles/backend';
// Reuse backend's installed deps so we don't duplicate them in scripts/
require(path.join(BACKEND_DIR, 'node_modules', 'dotenv')).config({
  path: path.join(BACKEND_DIR, '.env'),
});
const nodemailer = require(path.join(BACKEND_DIR, 'node_modules', 'nodemailer'));

const RECIPIENTS = [
  'vinay.chandra@synergificsoftware.com',
  'itops@synergificsoftware.com',
];

(async () => {
  const subject = process.argv[2] || '(no subject)';
  const body = process.argv[3] || '(no body)';

  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.error('GMAIL_USER/GMAIL_PASS missing from backend .env');
    process.exit(1);
  }

  try {
    const tr = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
    const info = await tr.sendMail({
      from: `"GetLabs Monitor" <${process.env.GMAIL_USER}>`,
      to: RECIPIENTS.join(','),
      subject: `[GetLabs Prod] ${subject}`,
      text: `${body}\n\n-- \nFrom: ${require('os').hostname()}\nAt:   ${new Date().toISOString()}\n`,
    });
    console.log(`sent: ${info.messageId}`);
    process.exit(0);
  } catch (err) {
    console.error(`alert email failed: ${err.message}`);
    process.exit(1);
  }
})();
