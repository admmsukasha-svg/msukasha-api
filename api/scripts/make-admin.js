// Usage:  node scripts/make-admin.js you@example.com [super_admin|moderator|verification_reviewer|support_agent]
// The account must already be registered (and should have a verified email). No credentials are hardcoded anywhere.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { STAFF_ROLES } = require('../src/lib/permissions');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const role = process.argv[3] || 'super_admin';
  if (!email || !STAFF_ROLES.includes(role)) { console.error(`Usage: node scripts/make-admin.js you@example.com [${STAFF_ROLES.join('|')}]`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOneAndUpdate({ email }, { role: 'admin', accountType: 'admin', $addToSet: { staffRoles: role } }, { new: true });
  console.log(user ? `${email} is now staff with role ${role}.` : `No user found with email ${email}. Register it first.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
