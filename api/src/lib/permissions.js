// Role-based permissions. Enforced on the SERVER for every privileged action.
// `user.role === 'admin'` is the gate to the admin area; `user.staffRoles` decides what the staff member may do.
// A legacy admin with no staffRoles is treated as super_admin so existing admins keep working.

const STAFF_ROLES = ['super_admin', 'moderator', 'verification_reviewer', 'support_agent'];

const PERMISSIONS = {
  super_admin: ['*'],
  moderator: [
    'products.review', 'c2c.moderate', 'reports.manage', 'categories.read', 'users.read', 'rfq.read', 'analytics.read'
  ],
  verification_reviewer: ['verification.review', 'users.read', 'profiles.read'],
  support_agent: ['tickets.manage', 'users.read', 'messages.contactSupport', 'onboarding.assist']
};

function rolesOf(user) {
  if (!user || user.role !== 'admin') return [];
  const r = (user.staffRoles || []).filter((x) => STAFF_ROLES.includes(x));
  return r.length ? r : ['super_admin'];
}

function can(user, permission) {
  return rolesOf(user).some((r) => PERMISSIONS[r].includes('*') || PERMISSIONS[r].includes(permission));
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
    if (!can(req.user, permission)) return res.status(403).json({ error: 'You do not have permission to do this.' });
    next();
  };
}

module.exports = { STAFF_ROLES, PERMISSIONS, rolesOf, can, requirePermission };
