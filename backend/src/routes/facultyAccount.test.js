import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

process.env.SESSION_SECRET = 'account-route-test-secret-only';
const { default: router } = await import('./facultyAccount.js');
const { pool } = await import('../db/pool.js');
const key = new TextEncoder().encode(process.env.SESSION_SECRET);

test('faculty account HTTP endpoints', async t => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/faculty/account';
  const originalQuery = pool.query;
  let queries = [];
  pool.query = async (...args) => {
    const handler = queries.shift();
    assert.ok(handler, 'Unexpected database query');
    return handler(...args);
  };
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });
  async function cookie(role = 'FACULTY') {
    const token = await new SignJWT({ role, userID: '10', facultyID: '20' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(key);
    return 'cict_session=' + token;
  }
  const facultyCookie = await cookie();
  async function request(method = 'GET', body, suffix = '', session = facultyCookie) {
    const response = await fetch(base + suffix, {
      method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  const account = { facultyID: '20', firstName: 'Ana', lastName: 'Reyes', email: 'ana@example.test', canIssue: false };
  await t.test('rejects anonymous and student access on all endpoints', async () => {
    for (const session of ['', await cookie('STUDENT')]) {
      for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['POST', '/password']]) {
        assert.equal((await request(method, method === 'GET' ? undefined : {}, suffix, session)).status, 401);
      }
    }
  });
  await t.test('reads only the signed-in faculty account without caching', async () => {
    queries.push((_sql, params) => { assert.deepEqual(params, ['20', '10']); return { rows: [account] }; });
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, account);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
  await t.test('rejects empty and oversized names without querying', async () => {
    for (const firstName of ['', '   ', 'x'.repeat(256), 42]) {
      assert.equal((await request('PATCH', { firstName, lastName: 'Reyes' })).status, 400);
    }
  });
  await t.test('trims names and ignores injected account IDs and permissions', async () => {
    queries.push((sql, params) => {
      assert.deepEqual(params, ['Ana', 'Reyes', '20', '10']);
      assert.match(sql, /SET "firstName" = \$1, "lastName" = \$2/);
      return { rows: [account] };
    });
    const result = await request('PATCH', { firstName: ' Ana ', lastName: ' Reyes ', facultyID: '99', userID: '99', canIssue: true, email: 'other@example.test' });
    assert.equal(result.status, 200);
    assert.equal(result.data.canIssue, false);
  });
  await t.test('reports a deleted account', async () => {
    queries.push(() => ({ rows: [] }));
    assert.equal((await request()).status, 401);
  });
  const currentPassword = 'original-password';
  const newPassword = 'a-new-long-password';
  const valid = { currentPassword, newPassword, confirmPassword: newPassword };
  await t.test('rejects short, mismatched, unchanged, and over-byte-limit passwords', async () => {
    for (const body of [
      { ...valid, newPassword: 'short', confirmPassword: 'short' },
      { ...valid, confirmPassword: 'different-password' },
      { ...valid, newPassword: currentPassword, confirmPassword: currentPassword },
      { ...valid, newPassword: '😀'.repeat(20), confirmPassword: '😀'.repeat(20) },
    ]) assert.equal((await request('POST', body, '/password')).status, 400);
  });
  const oldHash = await bcrypt.hash(currentPassword, 4);
  const passwordRow = (_sql, params) => {
    assert.deepEqual(params, ['10', '20']);
    return { rows: [{ passwordHash: oldHash }] };
  };
  await t.test('rejects an incorrect current password', async () => {
    queries.push(passwordRow);
    assert.equal((await request('POST', { ...valid, currentPassword: 'wrong-password' }, '/password')).status, 400);
  });
  await t.test('stores a valid new hash and checks the previous hash atomically', async () => {
    queries.push(passwordRow, async (_sql, params) => {
      assert.equal(params[1], '10');
      assert.equal(params[2], oldHash);
      assert.notEqual(params[0], newPassword);
      assert.ok(await bcrypt.compare(newPassword, params[0]));
      assert.equal(await bcrypt.compare(currentPassword, params[0]), false);
      return { rowCount: 1 };
    });
    const result = await request('POST', valid, '/password');
    assert.equal(result.status, 200);
    assert.equal(result.data.passwordHash, undefined);
  });
  await t.test('detects concurrent password changes', async () => {
    queries.push(passwordRow, () => ({ rowCount: 0 }));
    assert.equal((await request('POST', valid, '/password')).status, 409);
  });
  await t.test('rate-limits repeated password attempts', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await request('POST', {}, '/password')).status, 400);
    assert.equal((await request('POST', {}, '/password')).status, 429);
  });
  assert.equal(queries.length, 0);
});

