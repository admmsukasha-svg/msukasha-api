// In-app notifications. Never throws.
async function notify(userId, type, title, body = '', link = '') {
  try {
    const Notification = require('../models/Notification');
    await Notification.create({ user: userId, type, title: String(title).slice(0, 160), body: String(body).slice(0, 500), link: String(link).slice(0, 300) });
  } catch (e) { console.error('notify failed:', e.message); }
}
module.exports = { notify };
