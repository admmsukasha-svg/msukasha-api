process.env.JWT_SECRET = 'x'.repeat(48);
const test = require('node:test');
const assert = require('node:assert/strict');
const { can, rolesOf, requirePermission } = require('../../src/lib/permissions');
const { newToken, hashToken, referralCode } = require('../../src/lib/tokens');
const { slugify, cleanText, cleanUrl, cleanImage, stripOperators, isObjectId, clampInt, escapeRegex } = require('../../src/utils/helpers');
const { render, sendTemplate } = require('../../src/lib/mailer');
const storage = require('../../src/lib/storage');
const csrfGuard = require('../../src/middleware/csrf');

test('permissions: legacy admin without staffRoles is super admin', () => {
  assert.deepEqual(rolesOf({ role: 'admin', staffRoles: [] }), ['super_admin']);
  assert.equal(can({ role: 'admin', staffRoles: [] }, 'anything.at.all'), true);
});
test('permissions: non-admin roles can do nothing, even with staffRoles set', () => {
  assert.equal(can({ role: 'seller', staffRoles: ['super_admin'] }, 'products.review'), false);
  assert.equal(can({ role: 'buyer' }, 'products.review'), false);
  assert.equal(can(null, 'products.review'), false);
});
test('permissions: staff roles are limited to their grants', () => {
  const mod = { role: 'admin', staffRoles: ['moderator'] };
  assert.equal(can(mod, 'products.review'), true);
  assert.equal(can(mod, 'verification.review'), false);
  assert.equal(can(mod, 'categories.manage'), false);
  assert.equal(can(mod, 'staff.manage'), false);
  const ver = { role: 'admin', staffRoles: ['verification_reviewer'] };
  assert.equal(can(ver, 'verification.review'), true);
  assert.equal(can(ver, 'products.review'), false);
  assert.equal(can({ role: 'admin', staffRoles: ['support_agent'] }, 'audit.read'), false);
});
test('permissions: middleware answers 401 / 403 / next', () => {
  const run = (user) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; } }; let nexted = false; requirePermission('products.review')({ user }, res, () => { nexted = true; }); return { out, nexted }; };
  assert.equal(run(undefined).out.status, 401);
  assert.equal(run({ role: 'seller' }).out.status, 403);
  assert.equal(run({ role: 'admin', staffRoles: ['moderator'] }).nexted, true);
});

test('tokens: raw token differs from stored hash and hash is deterministic', () => {
  const t = newToken();
  assert.notEqual(t.raw, t.hash);
  assert.equal(hashToken(t.raw), t.hash);
  assert.ok(t.raw.length >= 40);
  assert.notEqual(newToken().raw, t.raw);
});
test('tokens: referral codes avoid ambiguous characters', () => {
  for (let i = 0; i < 200; i++) assert.match(referralCode(), /^[A-HJ-NP-Z2-9]{8}$/);
});

test('helpers: cleanText strips angle brackets and control characters', () => {
  assert.equal(cleanText('<script>alert(1)</script>Hi\u0000'), 'scriptalert(1)/scriptHi');
  assert.equal(cleanText('  x  ', 5), 'x');
  assert.equal(cleanText('abcdef', 3), 'abc');
});
test('helpers: cleanUrl blocks javascript: and data: URLs', () => {
  assert.throws(() => cleanUrl('javascript:alert(1)'));
  assert.throws(() => cleanUrl('data:text/html,hi'));
  assert.equal(cleanUrl(''), '');
  assert.equal(cleanUrl('https://msukasha.com'), 'https://msukasha.com/');
});
test('helpers: cleanImage rejects path traversal', () => {
  assert.throws(() => cleanImage('../../etc/passwd'));
  assert.equal(cleanImage('earbuds.jpg'), 'earbuds.jpg');
});
test('helpers: stripOperators removes Mongo operators recursively', () => {
  const body = { email: { $ne: null }, nested: { $where: 'x', ok: 1 }, 'a.b': 1, fine: 'y' };
  stripOperators(body);
  assert.deepEqual(body, { email: {}, nested: { ok: 1 }, fine: 'y' });
});
test('helpers: misc', () => {
  assert.equal(slugify('  Hello, World & Co!  '), 'hello-world-co');
  assert.equal(slugify('!!!'), 'item');
  assert.equal(isObjectId('507f1f77bcf86cd799439011'), true);
  assert.equal(isObjectId('123456789012'), false);
  assert.equal(clampInt('abc', 1, 10, 5), 5);
  assert.equal(clampInt('99', 1, 10, 5), 10);
  assert.equal(new RegExp(escapeRegex('a.*b')).test('axxb'), false);
});

test('mailer: placeholder rendering', () => {
  assert.equal(render('Hi {{name}}, {{missing}}!', { name: 'Ali' }), 'Hi Ali, !');
});
test('mailer: does not claim to send when email is not configured', async () => {
  delete process.env.SMTP_HOST; process.env.EMAIL_ENABLED = 'false';
  const r = await sendTemplate('welcome', 'a@b.co', { name: 'A' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'email_not_configured');
  assert.equal((await sendTemplate('nope', 'a@b.co')).reason, 'unknown_template');
});

test('storage: reports unconfigured and refuses to sign', () => {
  delete process.env.CLOUDINARY_CLOUD_NAME;
  assert.equal(storage.isConfigured(), false);
  assert.equal(storage.signUpload('image', 'u1'), null);
  assert.equal(storage.signedPrivateUrl('x'), null);
});
test('storage: signing is scoped to the user folder, private docs use authenticated type', () => {
  Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' });
  const img = storage.signUpload('image', 'u1'), doc = storage.signUpload('document', 'u1');
  assert.equal(img.folder, 'msukasha/public/u1');
  assert.equal(doc.folder, 'msukasha/private/u1');
  assert.equal(doc.type, 'authenticated');
  assert.ok(/^[a-f0-9]{40}$/.test(img.signature));
  assert.ok(!JSON.stringify(img).includes('"s"'), 'API secret must never be returned');
  assert.equal(storage.isOwnAssetUrl('https://res.cloudinary.com/demo/image/upload/a.jpg'), true);
  assert.equal(storage.isOwnAssetUrl('https://res.cloudinary.com/other/image/upload/a.jpg'), false);
  assert.equal(storage.isOwnAssetUrl('https://evil.com/a.jpg'), false);
  for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k];
});

test('csrf: blocks cookie-authenticated cross-site writes, allows safe methods, bearer and same-site', () => {
  const guard = csrfGuard(['https://msukasha.com']);
  const call = (req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json() {} }; let ok = false; guard({ headers: {}, cookies: {}, ...req }, res, () => { ok = true; }); return ok ? 'next' : out.status; };
  assert.equal(call({ method: 'POST', cookies: { ms_session: 't' }, headers: { origin: 'https://evil.com' } }), 403);
  assert.equal(call({ method: 'POST', cookies: { ms_session: 't' }, headers: {} }), 403);
  assert.equal(call({ method: 'POST', cookies: { ms_session: 't' }, headers: { origin: 'https://msukasha.com' } }), 'next');
  assert.equal(call({ method: 'POST', cookies: { ms_session: 't' }, headers: { referer: 'https://msukasha.com/x' } }), 'next');
  assert.equal(call({ method: 'GET', cookies: { ms_session: 't' }, headers: { origin: 'https://evil.com' } }), 'next');
  assert.equal(call({ method: 'POST', headers: { authorization: 'Bearer x', origin: 'https://evil.com' } }), 'next');
});
