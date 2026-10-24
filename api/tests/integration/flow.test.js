// End-to-end API flow against a REAL MongoDB.
//   - Set MONGODB_URI_TEST to a throwaway database (NEVER production), or
//   - leave it unset to let mongodb-memory-server download and run a temporary MongoDB.
// If neither is possible the whole file is skipped and says so.
process.env.JWT_SECRET = 'z'.repeat(48);
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'false';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

let app, mem, skip = false;
const ORIGIN = 'http://localhost:3000';

test.before(async () => {
  try {
    let uri = process.env.MONGODB_URI_TEST;
    if (!uri) { const { MongoMemoryServer } = require('mongodb-memory-server'); mem = await MongoMemoryServer.create(); uri = mem.getUri(); }
    process.env.MONGODB_URI = uri;
    app = require('../../src/app');
    await require('../../src/config/db')();
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  } catch (e) { skip = `MongoDB unavailable: ${e.message.split('\n')[0]}`; }
});
test.after(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); if (mem) await mem.stop(); });

const Models = () => ({ User: require('../../src/models/User'), EmailToken: require('../../src/models/EmailToken'), Category: require('../../src/models/Category'), Product: require('../../src/models/Product'), Referral: require('../../src/models/Referral'), Store: require('../../src/models/Store') });

async function register(email, extra = {}) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/register').set('Origin', ORIGIN).send({ name: 'Test ' + email.split('@')[0], email, password: 'CorrectHorse1', country: 'PK', acceptTerms: true, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { agent, user: r.body.user, token: r.body.token };
}
async function verifyEmail(userId) {
  const { User } = Models(); await User.updateOne({ _id: userId }, { emailVerified: true, emailVerifiedAt: new Date() });
}
const t = (name, fn) => test(name, async (c) => { if (skip) return c.skip(skip); await fn(c); });

const ctx = {};

t('registration, session cookie, me, logout', async () => {
  const a = await register('seller@example.com', { role: 'seller' });
  ctx.seller = a;
  assert.equal(a.user.role, 'seller'); assert.equal(a.user.emailVerified, false);
  assert.equal(a.user.passwordHash, undefined);
  assert.equal((await a.agent.get('/api/auth/me')).status, 200);
  assert.equal((await request(app).post('/api/auth/register').send({ name: 'Dup User', email: 'seller@example.com', password: 'CorrectHorse1', acceptTerms: true })).status, 409, 'duplicate email');
  const out = await a.agent.post('/api/auth/logout').set('Origin', ORIGIN);
  assert.equal(out.status, 200);
  assert.equal((await a.agent.get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`)).status, 401, 'revoked session token must stop working');
});

t('login, wrong password, and lockout after repeated failures', async () => {
  const bad = () => request(app).post('/api/auth/login').send({ email: 'seller@example.com', password: 'nope-nope' });
  for (let i = 0; i < 5; i++) assert.equal((await bad()).status, 401);
  assert.equal((await bad()).status, 429);
  const { User } = Models(); await User.updateOne({ email: 'seller@example.com' }, { $unset: { lockUntil: 1 } });
  const ok = await request(app).post('/api/auth/login').send({ email: 'seller@example.com', password: 'CorrectHorse1' });
  assert.equal(ok.status, 200);
  ctx.seller.token = ok.body.token; ctx.seller.id = ok.body.user.id;
});

t('email verification with a one-time token', async () => {
  const { EmailToken } = Models();
  const { newToken } = require('../../src/lib/tokens');
  const tk = newToken();
  await EmailToken.create({ user: ctx.seller.id, type: 'verify_email', tokenHash: tk.hash, expiresAt: new Date(Date.now() + 3600000) });
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: 'bogus' })).status, 400);
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: tk.raw })).status, 200);
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: tk.raw })).status, 400, 'token is single-use');
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ctx.seller.token}`);
  assert.equal(me.body.user.emailVerified, true);
});

t('role-based authorization: sellers and buyers cannot reach admin APIs', async () => {
  const auth = { Authorization: `Bearer ${ctx.seller.token}` };
  for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/audit', '/api/admin/products']) assert.equal((await request(app).get(p).set(auth)).status, 403, p);
});

t('staff: moderator may review products but not manage categories or read audit log', async () => {
  const { User, Category } = Models();
  const m = await register('mod@example.com');
  await User.updateOne({ email: 'mod@example.com' }, { role: 'admin', staffRoles: ['moderator'], emailVerified: true });
  const login = await request(app).post('/api/auth/login').send({ email: 'mod@example.com', password: 'CorrectHorse1' });
  ctx.mod = { Authorization: `Bearer ${login.body.token}` };
  assert.equal((await request(app).get('/api/admin/products').set(ctx.mod)).status, 200);
  assert.equal((await request(app).post('/api/admin/categories').set(ctx.mod).send({ name: 'X' })).status, 403);
  assert.equal((await request(app).get('/api/admin/audit').set(ctx.mod)).status, 403);
  const s = await register('super@example.com');
  await User.updateOne({ email: 'super@example.com' }, { role: 'admin', staffRoles: ['super_admin'], emailVerified: true });
  const sl = await request(app).post('/api/auth/login').send({ email: 'super@example.com', password: 'CorrectHorse1' });
  ctx.admin = { Authorization: `Bearer ${sl.body.token}` };
  const cat = await request(app).post('/api/admin/categories').set(ctx.admin).send({ name: 'Textiles' });
  assert.equal(cat.status, 201); ctx.cat = cat.body.category.id;
  const sub = await request(app).post('/api/admin/categories').set(ctx.admin).send({ name: 'Fabrics', parent: ctx.cat });
  assert.equal(sub.status, 201);
  const tree = await request(app).get('/api/categories');
  assert.equal(tree.body.categories[0].children.length, 1);
});

t('supplier profile, store, publish gating, and private fields stay private', async () => {
  const auth = { Authorization: `Bearer ${ctx.seller.token}` };
  const bad = await request(app).put('/api/business/profile').set(auth).send({ businessType: 'hacker', companyName: 'X' });
  assert.equal(bad.status, 400);
  const p = await request(app).put('/api/business/profile').set(auth).send({ businessType: 'manufacturer', companyName: 'Lahore Textile Mills', description: 'We manufacture woven cotton fabrics for export markets in several countries.', country: 'PK', city: 'Lahore', phone: '+92300000000', email: 'sales@example.com', registrationNumber: 'REG-123', taxId: 'TAX-999', address: '1 Private Street', categories: [ctx.cat] });
  assert.equal(p.status, 200); assert.ok(p.body.completion.percent >= 50);
  assert.equal((await request(app).put('/api/business/store').set(auth).send({ intro: 'Hello buyers' })).status, 200);
  assert.equal((await request(app).get('/api/suppliers')).body.total, 0, 'unpublished stores are not listed');
  assert.equal((await request(app).post('/api/business/store/publish').set(auth).send({})).status, 200);
  const list = await request(app).get('/api/suppliers');
  assert.equal(list.body.total, 1);
  const text = JSON.stringify(list.body);
  for (const secret of ['REG-123', 'TAX-999', '1 Private Street', 'sales@example.com', '+92300000000']) assert.ok(!text.includes(secret), `${secret} leaked in public list`);
  const one = await request(app).get(`/api/suppliers/${list.body.suppliers[0].slug}`);
  assert.equal(one.status, 200);
  assert.ok(!JSON.stringify(one.body).includes('TAX-999'));
  assert.deepEqual(one.body.supplier.verificationLevels, ['email_verified']);
  ctx.supplierOwner = list.body.suppliers[0].ownerId;
});

t('products: draft -> submit -> moderation -> public search; edits go back to review', async () => {
  const auth = { Authorization: `Bearer ${ctx.seller.token}` };
  const created = await request(app).post('/api/products').set(auth).send({ name: 'Cotton Poplin Fabric 120gsm', price: 2.4, currency: 'USD', unit: 'meter', moq: 500, category: ctx.cat, description: 'Combed cotton poplin', images: ['fabric.jpg'], country: 'PK', city: 'Lahore' });
  assert.equal(created.status, 201); assert.equal(created.body.product.status, 'draft');
  const id = created.body.product.id;
  assert.equal((await request(app).get('/api/products?q=poplin')).body.total, 0, 'drafts are not public');
  assert.equal((await request(app).get(`/api/products/${id}`)).status, 404);
  assert.equal((await request(app).post(`/api/products/${id}/submit`).set(auth)).status, 200);
  assert.equal((await request(app).post(`/api/admin/products/${id}/approve`).set(ctx.mod)).status, 200);
  const found = await request(app).get('/api/products?q=poplin');
  assert.equal(found.body.total, 1);
  assert.equal((await request(app).get(`/api/products?category=${ctx.cat}&country=PK&maxMoq=1000`)).body.total, 1);
  assert.equal((await request(app).get('/api/products?maxMoq=100')).body.total, 0);
  const edit = await request(app).put(`/api/products/${id}`).set(auth).send({ description: 'Changed description' });
  assert.equal(edit.body.product.status, 'pending_review');
  assert.equal((await request(app).get('/api/products?q=poplin')).body.total, 0);
  const rej = await request(app).post(`/api/admin/products/${id}/reject`).set(ctx.mod).send({});
  assert.equal(rej.status, 400, 'a reason is required to reject');
  ctx.productId = id;
  const other = await register('other@example.com', { role: 'seller' });
  assert.equal((await request(app).put(`/api/products/${id}`).set({ Authorization: `Bearer ${other.token}` }).send({ name: 'Hijacked' })).status, 403);
});

t('RFQ + quotation flow with privacy of buyer details and private RFQs', async () => {
  const { User } = Models();
  const buyer = await register('buyer@example.com'); await verifyEmail(buyer.user.id);
  const B = { Authorization: `Bearer ${buyer.token}` }, S = { Authorization: `Bearer ${ctx.seller.token}` };
  assert.equal((await request(app).post('/api/rfqs').set(B).send({ title: 'Cotton fabric', quantity: 5000, unit: 'meter', destinationCountry: 'AE', recipients: [] })).status, 400, 'invited RFQ needs recipients');
  const rfq = await request(app).post('/api/rfqs').set(B).send({ title: 'Cotton fabric 5000m', specifications: '120gsm white', quantity: 5000, unit: 'meter', destinationCountry: 'AE', currency: 'USD', recipients: [ctx.supplierOwner] });
  assert.equal(rfq.status, 201); const rid = rfq.body.rfq.id;
  const seen = await request(app).get(`/api/rfqs/${rid}`).set(S);
  assert.equal(seen.body.role, 'supplier');
  assert.ok(!JSON.stringify(seen.body).includes('buyer@example.com'), 'buyer email must not be visible to suppliers');
  const outsider = await register('outsider@example.com', { role: 'seller' });
  assert.equal((await request(app).get(`/api/rfqs/${rid}`).set({ Authorization: `Bearer ${outsider.token}` })).status, 404, 'private RFQ is invisible to others');
  const q = { unitPrice: 2.2, currency: 'USD', moq: 500, leadTimeDays: 20, validUntil: new Date(Date.now() + 7 * 86400000).toISOString() };
  assert.equal((await request(app).post(`/api/rfqs/${rid}/quotations`).set({ Authorization: `Bearer ${outsider.token}` }).send(q)).status, 404);
  const sent = await request(app).post(`/api/rfqs/${rid}/quotations`).set(S).send(q);
  assert.equal(sent.status, 201);
  assert.equal((await request(app).post(`/api/rfqs/${rid}/quotations`).set(S).send(q)).status, 409, 'one quotation per supplier');
  const view = await request(app).get(`/api/rfqs/${rid}`).set(B);
  assert.equal(view.body.quotations.length, 1);
  assert.equal((await request(app).post(`/api/rfqs/${rid}/quotations/${sent.body.quotation.id}/accept`).set(S)).status, 404, 'only the buyer can accept');
  const acc = await request(app).post(`/api/rfqs/${rid}/quotations/${sent.body.quotation.id}/accept`).set(B);
  assert.equal(acc.status, 200); assert.equal(acc.body.rfq.status, 'awarded');
  ctx.buyer = { ...buyer, H: B }; ctx.rfqId = rid; ctx.outsider = outsider;
});

t('messaging: linked to real references, participants only, spam limits', async () => {
  const B = ctx.buyer.H, S = { Authorization: `Bearer ${ctx.seller.token}` }, O = { Authorization: `Bearer ${ctx.outsider.token}` };
  assert.equal((await request(app).post('/api/conversations').set(B).send({ recipientId: ctx.supplierOwner, refType: 'product', refId: '507f1f77bcf86cd799439011', text: 'Hi' })).status, 400, 'fake product reference rejected');
  const c = await request(app).post('/api/conversations').set(B).send({ recipientId: ctx.supplierOwner, refType: 'rfq', refId: ctx.rfqId, text: 'Can you ship faster?' });
  assert.equal(c.status, 201); const cid = c.body.conversation.id;
  assert.equal((await request(app).get(`/api/conversations/${cid}`).set(O)).status, 404, 'non-participant cannot read');
  assert.equal((await request(app).post(`/api/conversations/${cid}/messages`).set(O).send({ text: 'spy' })).status, 404);
  const sellerList = await request(app).get('/api/conversations').set(S);
  assert.equal(sellerList.body.conversations[0].unread, 1);
  const read = await request(app).get(`/api/conversations/${cid}`).set(S);
  assert.equal(read.body.messages.length, 1);
  assert.equal((await request(app).get('/api/conversations').set(S)).body.conversations[0].unread, 0);
  assert.equal((await request(app).post(`/api/conversations/${cid}/messages`).set(B).send({ text: 'Can you ship faster?' })).status, 429, 'duplicate within a minute');
  assert.equal((await request(app).post(`/api/conversations/${cid}/block`).set(S)).status, 200);
  assert.equal((await request(app).post(`/api/conversations/${cid}/messages`).set(B).send({ text: 'hello?' })).status, 403);
  const withOutsider = await request(app).post('/api/conversations').set(O).send({ recipientId: ctx.supplierOwner, refType: 'rfq', refId: ctx.rfqId, text: 'sneak' });
  assert.equal(withOutsider.status, 403, 'cannot attach to someone else\'s RFQ');
});

t('C2C listing: moderation, public visibility, prohibited items, contact details hidden', async () => {
  const B = ctx.buyer.H;
  const bad = await request(app).post('/api/c2c').set(B).send({ title: 'Firearm for sale', price: 1000, city: 'Karachi' });
  assert.equal(bad.status, 400);
  const ok = await request(app).post('/api/c2c').set(B).send({ title: 'Used office chair', price: 8000, city: 'Karachi', condition: 'used', description: 'Good condition' });
  assert.equal(ok.status, 201); assert.equal(ok.body.listing.status, 'pending');
  assert.equal((await request(app).get('/api/c2c')).body.total, 0);
  assert.equal((await request(app).post(`/api/admin/c2c/${ok.body.listing.id}/approve`).set(ctx.mod)).status, 200);
  const pub = await request(app).get('/api/c2c?city=karachi');
  assert.equal(pub.body.total, 1); assert.ok(!JSON.stringify(pub.body).includes('buyer@example.com'));
});

t('reporting and moderation', async () => {
  const B = ctx.buyer.H;
  const r = await request(app).post('/api/reports').set(B).send({ targetType: 'product', targetId: ctx.productId, reason: 'counterfeit', details: 'looks fake' });
  assert.equal(r.status, 201);
  assert.equal((await request(app).post('/api/reports').set(B).send({ targetType: 'product', targetId: ctx.productId, reason: 'spam' })).status, 409, 'one report per user per target');
  assert.equal((await request(app).get('/api/admin/reports').set({ Authorization: `Bearer ${ctx.seller.token}` })).status, 403);
  const list = await request(app).get('/api/admin/reports').set(ctx.mod);
  assert.equal(list.body.total, 1);
  assert.equal((await request(app).patch(`/api/admin/reports/${list.body.reports[0].id}`).set(ctx.mod).send({ status: 'actioned', resolution: 'Listing removed' })).status, 200);
});

t('referral tracking: attribution, activation on first approved product, no self-reward without eligibility', async () => {
  const { Referral, User } = Models();
  const referrer = await User.findOne({ email: 'buyer@example.com' });
  const friend = await register('friend@example.com', { role: 'seller', referralCode: referrer.referralCode });
  const ref = await Referral.findOne({ referred: friend.user.id });
  assert.ok(ref); assert.equal(String(ref.referrer), String(referrer._id));
  assert.equal(ref.activatedAt, undefined);
  const me = await request(app).get('/api/referrals/me').set(ctx.buyer.H);
  assert.equal(me.body.referrals.length, 1); assert.equal(me.body.referrals[0].activated, false);
  assert.equal((await request(app).get('/api/referrals/me').set({ Authorization: `Bearer ${friend.token}` })).body.referrals.length, 0);
});

t('verification documents: users cannot reference others\' private files; admin-only access', async () => {
  const S = { Authorization: `Bearer ${ctx.seller.token}` };
  const wrong = await request(app).post('/api/business/verification/documents').set(S).send({ kind: 'business_registration', publicId: 'msukasha/private/someoneelse/doc1' });
  assert.equal(wrong.status, 400);
  const ok = await request(app).post('/api/business/verification/documents').set(S).send({ kind: 'business_registration', publicId: `msukasha/private/${ctx.seller.id}/doc1`, format: 'pdf' });
  assert.equal(ok.status, 201); assert.ok(!JSON.stringify(ok.body).includes('msukasha/private'));
  assert.equal((await request(app).get('/api/admin/verifications').set(S)).status, 403);
  assert.equal((await request(app).get('/api/admin/verifications').set(ctx.mod)).status, 403, 'moderator is not a verification reviewer');
  const list = await request(app).get('/api/admin/verifications').set(ctx.admin);
  assert.equal(list.status, 200); assert.ok(!JSON.stringify(list.body).includes('msukasha/private'), 'storage ids are not exposed in listings');
  const v = list.body.verifications[0];
  assert.equal((await request(app).post(`/api/admin/verifications/${v.id}/decision`).set(ctx.admin).send({ decision: 'rejected' })).status, 400, 'rejection needs a reason');
  assert.equal((await request(app).post(`/api/admin/verifications/${v.id}/decision`).set(ctx.admin).send({ decision: 'approved' })).status, 200);
  const sup = await request(app).get(`/api/suppliers?verified=documents`);
  assert.equal(sup.body.total, 1);
  assert.ok((await request(app).get('/api/suppliers').then((r) => r.body.suppliers[0].verificationLevels)).includes('business_documents_reviewed'));
  const audit = await request(app).get('/api/admin/audit?action=verification').set(ctx.admin);
  assert.ok(audit.body.total >= 2, 'submit + decision are audited');
});

t('account export and deletion', async () => {
  const x = await register('leaver@example.com');
  const ex = await request(app).get('/api/auth/export').set({ Authorization: `Bearer ${x.token}` });
  assert.equal(ex.status, 200); assert.equal(ex.body.user.email, 'leaver@example.com'); assert.equal(ex.body.user.passwordHash, undefined);
  assert.equal((await request(app).delete('/api/auth/account').set({ Authorization: `Bearer ${x.token}` }).send({ password: 'wrong-wrong' })).status, 401);
  assert.equal((await request(app).delete('/api/auth/account').set({ Authorization: `Bearer ${x.token}` }).send({ password: 'CorrectHorse1' })).status, 200);
  assert.equal((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${x.token}` })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'leaver@example.com', password: 'CorrectHorse1' })).status, 401);
});
