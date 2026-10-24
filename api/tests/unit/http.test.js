// HTTP-level checks that do not need a database: the DB middleware is stubbed to a no-op and
// every route tested here must reject BEFORE touching the database.
process.env.JWT_SECRET = 'y'.repeat(48);
process.env.NODE_ENV = 'test';
const Module = require('module');
const path = require('path');
const dbPath = require.resolve('../../src/config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: async () => null };
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../src/app');

test('health endpoint reports configuration without secrets', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.config.jwt, true);
  assert.equal(r.body.config.email, false);
  assert.ok(!JSON.stringify(r.body).includes('yyyy'));
});
test('private endpoints require authentication', async () => {
  for (const [m, p] of [['get', '/api/auth/me'], ['get', '/api/business/me'], ['post', '/api/rfqs'], ['get', '/api/conversations'], ['get', '/api/favorites'], ['get', '/api/dashboard/supplier'], ['get', '/api/admin/overview'], ['get', '/api/admin/audit'], ['put', '/api/business/profile'], ['post', '/api/products'], ['get', '/api/uploads/sign']]) {
    const r = await request(app)[m](p).send({});
    assert.equal(r.status, 401, `${m.toUpperCase()} ${p} should be 401, got ${r.status}`);
  }
});
test('a forged / unsigned / jti-less token is rejected', async () => {
  const jwt = require('jsonwebtoken');
  const noJti = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin' }, process.env.JWT_SECRET);
  const wrong = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin', jti: 'x' }, 'not-the-secret');
  for (const t of [noJti, wrong, 'garbage']) {
    const r = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${t}`);
    assert.equal(r.status, 401);
  }
});
test('cookie-authenticated write from a foreign origin is blocked by CSRF guard', async () => {
  const r = await request(app).post('/api/rfqs').set('Cookie', 'ms_session=abc').set('Origin', 'https://evil.example').send({});
  assert.equal(r.status, 403);
});
test('registration requires accepting the terms and a valid email/password', async () => {
  let r = await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: 'longenough1', name: 'A B' });
  assert.equal(r.status, 400);
  r = await request(app).post('/api/auth/register').send({ email: 'not-an-email', password: 'longenough1', name: 'A B', acceptTerms: true });
  assert.equal(r.status, 400);
  r = await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: 'short', name: 'A B', acceptTerms: true });
  assert.equal(r.status, 400);
});
test('unknown routes return a JSON 404', async () => {
  const r = await request(app).get('/api/nope');
  assert.equal(r.status, 404);
});
