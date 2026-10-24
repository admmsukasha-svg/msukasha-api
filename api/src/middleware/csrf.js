// CSRF protection for cookie-authenticated requests. Bearer-token requests are not CSRF-prone.
// Unsafe methods must come from an allowed Origin (or Referer). Combined with SameSite=Lax cookies.
module.exports = function csrfGuard(allowedOrigins) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers.authorization) return next();
    if (!req.cookies || !req.cookies.ms_session) return next();
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) { try { origin = new URL(req.headers.referer).origin; } catch { /* ignore */ } }
    if (!origin || !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Request blocked (cross-site request).' });
    next();
  };
};
