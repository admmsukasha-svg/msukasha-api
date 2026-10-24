// Transactional email. Real email is sent ONLY when SMTP_* variables are configured and
// EMAIL_ENABLED=true. Otherwise messages are logged (without secrets) and reported as "not sent".
const nodemailer = require('nodemailer');

const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Default templates. Admins can override subject/body per key in the EmailTemplate collection.
// Placeholders use {{name}} and are HTML-escaped on substitution.
const DEFAULT_TEMPLATES = {
  welcome: { subject: 'Welcome to MSUKASHA', body: 'Hello {{name}},\n\nYour MSUKASHA account has been created. Please verify your email to continue.\n\nThe MSUKASHA team' },
  verify_email: { subject: 'Verify your MSUKASHA email', body: 'Hello {{name}},\n\nConfirm your email address by opening this link (valid for 24 hours):\n{{link}}\n\nIf you did not create an account, ignore this message.' },
  reset_password: { subject: 'Reset your MSUKASHA password', body: 'Hello {{name}},\n\nReset your password using this link (valid for 1 hour):\n{{link}}\n\nIf you did not request this, you can ignore this message.' },
  profile_completion: { subject: 'Complete your MSUKASHA business profile', body: 'Hello {{name}},\n\nA complete company profile helps buyers understand your business. Continue here:\n{{link}}' },
  first_product_reminder: { subject: 'Add your first product on MSUKASHA', body: 'Hello {{name}},\n\nYour store is ready for its first product. Add one here:\n{{link}}' },
  product_decision: { subject: 'Your product "{{product}}" was {{decision}}', body: 'Hello {{name}},\n\nYour product "{{product}}" was {{decision}}.\n{{reason}}\n\nManage products: {{link}}' },
  new_inquiry: { subject: 'New buyer inquiry on MSUKASHA', body: 'Hello {{name}},\n\nYou have a new message about "{{subject}}". Read it in your dashboard:\n{{link}}' },
  new_rfq: { subject: 'New request for quotation: {{subject}}', body: 'Hello {{name}},\n\nA buyer has sent you a request for quotation: "{{subject}}".\nReview it here: {{link}}' },
  new_quotation: { subject: 'You received a quotation for "{{subject}}"', body: 'Hello {{name}},\n\nA supplier responded to your request "{{subject}}".\nCompare quotations here: {{link}}' },
  security_alert: { subject: 'Security alert for your MSUKASHA account', body: 'Hello {{name}},\n\n{{event}}\n\nIf this was not you, reset your password immediately: {{link}}' },
  ticket_update: { subject: 'Update on your support request', body: 'Hello {{name}},\n\nYour support request "{{subject}}" has an update. View it: {{link}}' }
};

function render(tpl, vars) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (process.env.EMAIL_ENABLED !== 'true' || !process.env.SMTP_HOST) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transport;
}

// Returns { sent: boolean, reason? }. Never throws: email failure must not break a request.
async function sendTemplate(key, to, vars = {}, opts = {}) {
  try {
    let tpl = DEFAULT_TEMPLATES[key];
    if (!tpl) return { sent: false, reason: 'unknown_template' };
    try {
      const EmailTemplate = require('../models/EmailTemplate');
      const custom = await EmailTemplate.findOne({ key, enabled: true }).lean();
      if (custom) tpl = { subject: custom.subject, body: custom.body };
    } catch { /* DB unavailable: use defaults */ }

    const text = render(tpl.body, vars);
    const subject = render(tpl.subject, vars);
    const t = getTransport();
    if (!t) {
      console.log(`[mail:not-configured] template=${key} to=${String(to).replace(/(.).+(@.+)/, '$1***$2')}`);
      return { sent: false, reason: 'email_not_configured' };
    }
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a2332">' +
      esc(text).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</div>';
    await t.sendMail({ from: process.env.EMAIL_FROM || 'MSUKASHA <no-reply@msukasha.com>', to, subject, text, html, ...opts });
    return { sent: true };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { sendTemplate, DEFAULT_TEMPLATES, render, APP_URL };
