const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');

const COOKIE = 'ms_session';

function tokenFrom(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) return { token, via: 'bearer' };
  if (req.cookies && req.cookies[COOKIE]) return { token: req.cookies[COOKIE], via: 'cookie' };
  return null;
}

async function loadUser(req) {
  const found = tokenFrom(req);
  if (!found) return null;
  try {
    const payload = jwt.verify(found.token, process.env.JWT_SECRET);
    if (!payload.jti) return null;                       // old tokens without a server-side session are rejected
    const session = await Session.findOne({ jti: payload.jti, revokedAt: { $exists: false } }).lean();
    if (!session || session.expiresAt < new Date()) return null;
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive || user.deletedAt) return null;
    req.sessionJti = payload.jti;
    req.authVia = found.via;
    return user;
  } catch {
    return null;
  }
}

exports.COOKIE = COOKIE;
exports.optionalAuth = async (req, res, next) => {
  try { req.user = await loadUser(req); next(); } catch (e) { next(e); }
};
exports.requireAuth = async (req, res, next) => {
  try {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in to continue.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
};
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do this.' });
  next();
};
exports.requireVerifiedEmail = (req, res, next) => {
  if (!req.user || !req.user.emailVerified) return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  next();
};
