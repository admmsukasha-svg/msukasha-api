// Audit log for sensitive and admin actions. Never throws.
async function audit(req, action, target = {}, meta = {}) {
  try {
    const AuditLog = require('../models/AuditLog');
    await AuditLog.create({
      actor: req && req.user ? req.user._id : undefined,
      actorRole: req && req.user ? req.user.role : 'system',
      action,
      targetType: target.type || '',
      targetId: target.id ? String(target.id) : '',
      onBehalfOf: meta.onBehalfOf,
      meta: meta.data || {},
      ip: req && req.ip ? String(req.ip).slice(0, 64) : ''
    });
  } catch (e) { console.error('audit failed:', e.message); }
}
module.exports = { audit };
