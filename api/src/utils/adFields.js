const { PACKAGES } = require('../config/packages');
const { HttpError, cleanText, cleanUrl, isEmail } = require('./helpers');

// Whitelists and validates business-ad input. Anything not listed here
// (status, paymentStatus, clicks, userId, submittedAt ...) is ignored.
function sanitizeAdInput(b, { partial = false } = {}) {
  b = b || {};
  const out = {};

  const text = (key, max, required, label) => {
    if (b[key] === undefined) {
      if (required && !partial) throw new HttpError(400, `${label} is required.`);
      return;
    }
    const v = cleanText(b[key], max);
    if (required && !v) throw new HttpError(400, `${label} is required.`);
    out[key] = v;
  };

  text('advertiserName', 120, true, 'Contact person');
  text('businessName', 160, true, 'Business name');
  text('title', 150, true, 'Advertisement title');
  text('description', 3000, true, 'Advertisement description');
  text('phone', 30, true, 'Phone number');

  if (b.email !== undefined || !partial) {
    const e = cleanText(b.email, 254).toLowerCase();
    if (!isEmail(e)) throw new HttpError(400, 'A valid email address is required.');
    out.email = e;
  }
  if (b.package !== undefined || !partial) {
    const p = String(b.package || '').toLowerCase();
    if (!PACKAGES[p]) throw new HttpError(400, 'Please select a valid advertising package.');
    out.package = p;
  }
  if (b.targetUrl !== undefined) out.targetUrl = cleanUrl(b.targetUrl);
  if (b.imageUrl !== undefined) out.imageUrl = cleanUrl(b.imageUrl);
  return out;
}

module.exports = { sanitizeAdInput };
