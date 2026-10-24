const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const User = require('../models/User');
const Session = require('../models/Session');
const EmailToken = require('../models/EmailToken');
const Referral = require('../models/Referral');
const { requireAuth, COOKIE } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, isEmail } = require('../utils/helpers');
const { newToken, hashToken, referralCode } = require('../lib/tokens');
const { sendTemplate, APP_URL } = require('../lib/mailer');
const { audit } = require('../lib/audit');
const { rolesOf } = require('../lib/permissions');

const router = express.Router();
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  email: z.string().trim().toLowerCase().max(254).refine(isEmail, 'A valid email address is required.'),
  password: z.string().min(8, 'Password must be 8 to 128 characters.').max(128, 'Password must be 8 to 128 characters.'),
  country: z.string().trim().length(2).toUpperCase().optional(),
  language: z.string().trim().max(8).optional(),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(160).optional(),
  role: z.string().optional(), accountType: z.string().optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service and Privacy Policy.' }) }),
  referralCode: z.string().trim().max(20).optional(),
  source: z.string().trim().toLowerCase().max(60).optional()
});

async function issueSession(req, res, user) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await Session.create({ user: user._id, jti, userAgent: String(req.headers['user-agent'] || '').slice(0, 200), ip: String(req.ip || '').slice(0, 64), expiresAt });
  const token = jwt.sign({ sub: String(user._id), role: user.role, jti }, process.env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000
  });
  return token;
}

async function sendVerification(user) {
  const t = newToken();
  await EmailToken.create({ user: user._id, type: 'verify_email', tokenHash: t.hash, expiresAt: new Date(Date.now() + 24 * 3600000) });
  return sendTemplate('verify_email', user.email, { name: user.name, link: `${APP_URL()}/verify-email?token=${t.raw}` });
}

const publicUser = (u) => ({ ...u.toJSON(), staffRoles: rolesOf(u) });

// POST /api/auth/register  (alias: /api/register)
router.post(['/auth/register', '/register'], asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse({ acceptTerms: true, ...req.body });
  // Legacy clients did not send acceptTerms; new clients must send it explicitly.
  if (req.body && req.body.acceptTerms !== true && !req.body.legacy) {
    throw new HttpError(400, 'You must accept the Terms of Service and Privacy Policy.');
  }
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const b = parsed.data;

  const name = b.name || `${b.firstName || ''} ${b.lastName || ''}`.trim();
  if (!name) throw new HttpError(400, 'Your name is required.');
  if (await User.exists({ email: b.email })) throw new HttpError(409, 'This email is already registered.');

  const wantsSeller = [b.role, b.accountType].some((v) => String(v || '').toLowerCase() === 'seller');
  const role = wantsSeller ? 'seller' : 'buyer';   // admin is never selectable here (see scripts/make-admin.js)

  let referrer = null;
  if (b.referralCode) referrer = await User.findOne({ referralCode: b.referralCode.toUpperCase() }).select('_id');

  const user = await User.create({
    name, firstName: cleanText(b.firstName, 60), lastName: cleanText(b.lastName, 60), email: b.email,
    passwordHash: await bcrypt.hash(b.password, 12),
    phone: cleanText(b.phone, 30), city: cleanText(b.city, 80), country: b.country || '', language: b.language || 'en',
    companyName: cleanText(b.companyName, 160), role, accountType: role,
    termsAcceptedAt: new Date(), referralCode: referralCode(), referredBy: referrer ? referrer._id : undefined,
    acquisitionSource: b.source || ''
  });

  if (referrer) {
    // Referral anti-abuse: same network as the referrer's sessions is recorded as ineligible.
    const ip = String(req.ip || '').slice(0, 64);
    const sameIp = ip && (await Session.exists({ user: referrer._id, ip }));
    await Referral.create({
      referrer: referrer._id, referred: user._id, code: b.referralCode.toUpperCase(), signupIp: ip,
      eligible: !sameIp, ineligibleReason: sameIp ? 'same_network_as_referrer' : ''
    });
  }

  await sendVerification(user);
  await sendTemplate('welcome', user.email, { name: user.name });
  const token = await issueSession(req, res, user);
  res.status(201).json({ token, user: publicUser(user), emailVerificationRequired: true });
}));

// POST /api/auth/login  (alias: /api/login)
router.post(['/auth/login', '/login'], asyncHandler(async (req, res) => {
  const email = cleanText(req.body && req.body.email, 254).toLowerCase();
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const user = await User.findOne({ email }).select('+passwordHash');

  if (user && user.lockUntil && user.lockUntil > new Date()) {
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  }
  const ok = user && user.isActive && !user.deletedAt && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    if (user) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= MAX_FAILED) { user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000); user.failedLogins = 0; }
      await user.save();
    }
    throw new HttpError(401, 'Incorrect email or password.');
  }
  user.failedLogins = 0; user.lockUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  const token = await issueSession(req, res, user);
  res.json({ token, user: publicUser(user) });
}));

// POST /api/auth/logout
router.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await Session.updateOne({ jti: req.sessionJti }, { revokedAt: new Date() });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ message: 'Logged out.' });
}));

// GET /api/auth/me
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// POST /api/auth/verify-email { token }
router.post('/auth/verify-email', asyncHandler(async (req, res) => {
  const raw = typeof (req.body && req.body.token) === 'string' ? req.body.token : '';
  const rec = raw && (await EmailToken.findOne({ tokenHash: hashToken(raw), type: 'verify_email', usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }));
  if (!rec) throw new HttpError(400, 'This verification link is invalid or has expired.');
  const user = await User.findById(rec.user);
  if (!user) throw new HttpError(400, 'This verification link is invalid or has expired.');
  user.emailVerified = true; user.emailVerifiedAt = new Date();
  rec.usedAt = new Date();
  await Promise.all([user.save(), rec.save(), Referral.updateOne({ referred: user._id, emailVerifiedAt: { $exists: false } }, { emailVerifiedAt: new Date() })]);
  res.json({ message: 'Email verified.' });
}));

// POST /api/auth/resend-verification
router.post('/auth/resend-verification', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.emailVerified) return res.json({ message: 'Email already verified.' });
  const r = await sendVerification(req.user);
  res.json({ message: r.sent ? 'Verification email sent.' : 'Email delivery is not configured yet. Please contact support.', sent: r.sent });
}));

// POST /api/auth/forgot-password { email }  (always the same response: no account enumeration)
router.post('/auth/forgot-password', asyncHandler(async (req, res) => {
  const email = cleanText(req.body && req.body.email, 254).toLowerCase();
  const user = isEmail(email) ? await User.findOne({ email, isActive: true }) : null;
  if (user) {
    const t = newToken();
    await EmailToken.create({ user: user._id, type: 'reset_password', tokenHash: t.hash, expiresAt: new Date(Date.now() + 3600000) });
    await sendTemplate('reset_password', user.email, { name: user.name, link: `${APP_URL()}/reset-password?token=${t.raw}` });
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
}));

// POST /api/auth/reset-password { token, password }
router.post('/auth/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new HttpError(400, 'Password must be 8 to 128 characters.');
  const rec = typeof token === 'string' && (await EmailToken.findOne({ tokenHash: hashToken(token), type: 'reset_password', usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }));
  if (!rec) throw new HttpError(400, 'This reset link is invalid or has expired.');
  const user = await User.findById(rec.user).select('+passwordHash');
  user.passwordHash = await bcrypt.hash(password, 12);
  rec.usedAt = new Date();
  await Promise.all([user.save(), rec.save(), Session.updateMany({ user: user._id, revokedAt: { $exists: false } }, { revokedAt: new Date() })]);
  await sendTemplate('security_alert', user.email, { name: user.name, event: 'Your password was changed.', link: `${APP_URL()}/forgot-password` });
  res.json({ message: 'Password updated. Please log in.' });
}));

// GET /api/profile (legacy) and PUT /api/profile
router.get('/profile', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  if (b.name !== undefined) u.name = cleanText(b.name, 120) || u.name;
  if (b.phone !== undefined) { const p = cleanText(b.phone, 30); if (p !== u.phone) u.phoneVerified = false; u.phone = p; }
  if (b.city !== undefined) u.city = cleanText(b.city, 80);
  if (b.country !== undefined) u.country = cleanText(b.country, 2).toUpperCase();
  if (b.language !== undefined) u.language = cleanText(b.language, 8) || 'en';
  if (b.companyName !== undefined) u.companyName = cleanText(b.companyName, 160);
  if (b.notificationPrefs && typeof b.notificationPrefs === 'object') {
    if (typeof b.notificationPrefs.email === 'boolean') u.notificationPrefs.email = b.notificationPrefs.email;
    if (typeof b.notificationPrefs.marketing === 'boolean') u.notificationPrefs.marketing = b.notificationPrefs.marketing;
  }
  if (b.profile && typeof b.profile === 'object') {
    if (b.profile.about !== undefined) u.profile.about = cleanText(b.profile.about, 1000);
    if (b.profile.address !== undefined) u.profile.address = cleanText(b.profile.address, 300);
  }
  await u.save();
  res.json({ user: publicUser(u) });
}));

// PUT /api/password  – revokes all other sessions
router.put(['/password', '/auth/password'], requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) throw new HttpError(400, 'New password must be 8 to 128 characters.');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) throw new HttpError(401, 'Current password is incorrect.');
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  await Session.updateMany({ user: user._id, jti: { $ne: req.sessionJti }, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  await sendTemplate('security_alert', user.email, { name: user.name, event: 'Your password was changed.', link: `${APP_URL()}/forgot-password` });
  res.json({ message: 'Password updated.' });
}));

// GET /api/auth/export  – data export for the account holder
router.get('/auth/export', requireAuth, asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const models = {
    profile: () => require('../models/BusinessProfile').findOne({ owner: uid }).lean(),
    store: () => require('../models/Store').findOne({ owner: uid }).lean(),
    products: () => require('../models/Product').find({ seller: uid }).lean(),
    rfqs: () => require('../models/Rfq').find({ buyer: uid }).lean(),
    quotations: () => require('../models/Quotation').find({ supplier: uid }).lean(),
    favorites: () => require('../models/Favorite').find({ user: uid }).lean(),
    notifications: () => require('../models/Notification').find({ user: uid }).limit(1000).lean()
  };
  const out = { exportedAt: new Date(), user: publicUser(req.user) };
  for (const [k, fn] of Object.entries(models)) out[k] = await fn();
  res.setHeader('Content-Disposition', 'attachment; filename="msukasha-data-export.json"');
  res.json(out);
}));

// DELETE /api/auth/account  – soft-delete: deactivates the account, unpublishes content, revokes sessions
router.delete('/auth/account', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(String((req.body && req.body.password) || ''), user.passwordHash))) throw new HttpError(401, 'Password is incorrect.');
  if (user.role === 'admin') throw new HttpError(403, 'Staff accounts must be removed by a super admin.');
  user.isActive = false; user.deletedAt = new Date();
  await user.save();
  await Promise.all([
    Session.updateMany({ user: user._id, revokedAt: { $exists: false } }, { revokedAt: new Date() }),
    require('../models/Product').updateMany({ seller: user._id, status: 'active' }, { status: 'archived' }),
    require('../models/Store').updateMany({ owner: user._id }, { status: 'draft' })
  ]);
  await audit(req, 'account.delete', { type: 'user', id: user._id });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ message: 'Account deactivated. Personal data is erased according to the Privacy Policy retention schedule.' });
}));

module.exports = router;
