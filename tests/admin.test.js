'use strict';

// Admin autorizatsiyasi, validatsiya va rasm yuklash (DB siz: prisma soxta).
const os = require('os');
const path = require('path');
const fs = require('fs');
const ADMIN_TG_ID = 777001;
const OTHER_TG_ID = 555002;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adrush-up-'));
process.env.ADMIN_IDS = String(ADMIN_TG_ID);
process.env.UPLOAD_DIR = uploadDir;

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { prisma } = require('../src/db/prisma');
const { createApp } = require('../src/app');
const { detectType, isValidImageUrl } = require('../src/services/uploads/imageService');
const { TRANSITIONS } = require('../src/services/competition/winnerService');

const audits = [];
const users = new Map([
  [ADMIN_TG_ID, { id: 1, telegramId: BigInt(ADMIN_TG_ID), username: 'boss', firstName: 'Boss', isBlocked: false }],
  [OTHER_TG_ID, { id: 2, telegramId: BigInt(OTHER_TG_ID), username: 'user', firstName: 'User', isBlocked: false }],
]);
prisma.user = { findUnique: async ({ where }) => users.get(Number(where.telegramId)) || null, upsert: async () => { throw new Error('unexpected'); } };
prisma.admin = { findUnique: async () => null }; // Admin jadvalida hech kim yo'q: faqat ADMIN_IDS
prisma.auditLog = { create: async ({ data }) => { audits.push(data); return data; } };

function initData(tgId, username, first) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, first_name: first, username }), query_id: 'AAA' });
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
const adminAuth = { Authorization: 'tma ' + initData(ADMIN_TG_ID, 'boss', 'Boss') };
const userAuth = { Authorization: 'tma ' + initData(OTHER_TG_ID, 'user', 'User') };

async function withServer(fn) {
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}

const ADMIN_ENDPOINTS = [
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/competitions'],
  ['POST', '/api/admin/competitions'],
  ['GET', '/api/admin/competitions/1'],
  ['PATCH', '/api/admin/competitions/1'],
  ['DELETE', '/api/admin/competitions/1'],
  ['POST', '/api/admin/competitions/1/activate'],
  ['POST', '/api/admin/competitions/1/end'],
  ['POST', '/api/admin/competitions/1/archive'],
  ['POST', '/api/admin/competitions/1/prizes'],
  ['PATCH', '/api/admin/prizes/1'],
  ['DELETE', '/api/admin/prizes/1'],
  ['GET', '/api/admin/competitions/1/winners'],
  ['PATCH', '/api/admin/winners/1'],
  ['POST', '/api/admin/uploads/prize-image'],
  ['GET', '/api/admin/audit'],
  ['GET', '/api/admin/users'],
  ['POST', '/api/admin/users/123456/block'],
  ['POST', '/api/admin/users/123456/unblock'],
];

const json = (headers, body) => ({ headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('admin endpointlar: Authorization yo\'q — 401', async () => {
  await withServer(async (base) => {
    for (const [method, p] of ADMIN_ENDPOINTS) {
      const res = await fetch(base + p, { method });
      assert.equal(res.status, 401, `${method} ${p}`);
    }
  });
});

test('oddiy user HAR BIR admin endpointda 403 Forbidden oladi', async () => {
  await withServer(async (base) => {
    for (const [method, p] of ADMIN_ENDPOINTS) {
      const res = await fetch(base + p, { method, headers: { ...userAuth, 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
      assert.equal(res.status, 403, `${method} ${p}`);
      assert.equal((await res.json()).reason, 'FORBIDDEN');
    }
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(audits.some((a) => a.action === 'SUSPICIOUS:ADMIN_ACCESS_DENIED'), 'rad etilgan urinish audit ga yozilishi kerak');
});

test('/api/users/me: oddiy user isAdmin=false, admin isAdmin=true', async () => {
  await withServer(async (base) => {
    const u = await (await fetch(`${base}/api/users/me`, { headers: userAuth })).json();
    assert.equal(u.isAdmin, false);
    assert.equal(u.role, null);
    const a = await (await fetch(`${base}/api/users/me`, { headers: adminAuth })).json();
    assert.equal(a.isAdmin, true);
    assert.equal(a.role, 'SUPER_ADMIN');
  });
});

test('admin: noto\'g\'ri competition so\'rovlari 400 (DB ga yetmasdan)', async () => {
  await withServer(async (base) => {
    const bad = [
      {},
      { title: 'ab', startAt: '2026-10-01T00:00:00Z', endAt: '2026-11-01T00:00:00Z' },
      { title: 'Valid nom', startAt: 'ertaga', endAt: '2026-11-01T00:00:00Z' },
      { title: 'Valid nom', startAt: '2026-10-01T00:00:00Z', endAt: '2026-11-01T00:00:00Z', status: 'ACTIVE' }, // status create da yo'q (strict)
    ];
    for (const body of bad) {
      const res = await fetch(`${base}/api/admin/competitions`, { method: 'POST', ...json(adminAuth, body) });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).reason, 'INVALID_REQUEST');
    }
    const badId = await fetch(`${base}/api/admin/competitions/abc`, { headers: adminAuth });
    assert.equal(badId.status, 400);
  });
});

test('admin: sovrin validatsiyasi (tashqi rasm URL, noto\'g\'ri place/quantity, ortiqcha maydon)', async () => {
  await withServer(async (base) => {
    const bad = [
      { place: 1, title: 'X', imageUrl: 'https://evil.example/x.png' },
      { place: 1, title: 'X', imageUrl: '/uploads/prizes/../../etc/passwd' },
      { place: 0, title: 'X' },
      { place: 1, title: '' },
      { place: 1, title: 'X', quantity: 0 },
      { place: 1, title: 'X', hack: true },
    ];
    for (const body of bad) {
      const res = await fetch(`${base}/api/admin/competitions/1/prizes`, { method: 'POST', ...json(adminAuth, body) });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const empty = await fetch(`${base}/api/admin/prizes/1`, { method: 'PATCH', ...json(adminAuth, {}) });
    assert.equal(empty.status, 400);
    const badWinner = await fetch(`${base}/api/admin/winners/1`, { method: 'PATCH', ...json(adminAuth, { status: 'CONFIRMED' }) });
    assert.equal(badWinner.status, 400); // eski status nomi endi yo'q
  });
});

test('admin xavfsizlik endpointlari: noto\'g\'ri so\'rovlar 400, o\'zini bloklash 409', async () => {
  await withServer(async (base) => {
    for (const q of ['kind=hack', 'limit=0', 'limit=1000', 'before=abc', 'extra=1']) {
      const res = await fetch(`${base}/api/admin/audit?${q}`, { headers: adminAuth });
      assert.equal(res.status, 400, q);
    }
    const tooLong = await fetch(`${base}/api/admin/users?q=${'a'.repeat(65)}`, { headers: adminAuth });
    assert.equal(tooLong.status, 400);
    const badId = await fetch(`${base}/api/admin/users/abc/block`, { method: 'POST', headers: adminAuth });
    assert.equal(badId.status, 400);
    const self = await fetch(`${base}/api/admin/users/${ADMIN_TG_ID}/block`, { method: 'POST', headers: adminAuth });
    assert.equal(self.status, 409);
    assert.equal((await self.json()).reason, 'CANNOT_BLOCK_SELF');
  });
});

test('rasm yuklash: faqat haqiqiy JPEG/PNG/WebP (magic bytes), boshqasi 415', async () => {
  await withServer(async (base) => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const ok = await fetch(`${base}/api/admin/uploads/prize-image`, { method: 'POST', headers: { ...adminAuth, 'Content-Type': 'image/png' }, body: png });
    assert.equal(ok.status, 201);
    const { url } = await ok.json();
    assert.ok(isValidImageUrl(url), url);
    assert.ok(fs.existsSync(path.join(uploadDir, 'prizes', path.basename(url))));

    const served = await fetch(base + url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');

    // Content-Type image/png, lekin ichi HTML — rad etiladi
    const fake = await fetch(`${base}/api/admin/uploads/prize-image`, { method: 'POST', headers: { ...adminAuth, 'Content-Type': 'image/png' }, body: Buffer.from('<html><script>alert(1)</script></html>') });
    assert.equal(fake.status, 415);

    const text = await fetch(`${base}/api/admin/uploads/prize-image`, { method: 'POST', headers: { ...adminAuth, 'Content-Type': 'text/plain' }, body: 'hello' });
    assert.equal(text.status, 415);

    // Oddiy user yuklay olmaydi
    const forbidden = await fetch(`${base}/api/admin/uploads/prize-image`, { method: 'POST', headers: { ...userAuth, 'Content-Type': 'image/png' }, body: png });
    assert.equal(forbidden.status, 403);
  });
});

test('imageService: detectType va isValidImageUrl', () => {
  assert.equal(detectType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpg');
  assert.equal(detectType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])), 'webp');
  assert.equal(detectType(Buffer.from('GIF89a......')), null);
  assert.equal(isValidImageUrl('/uploads/prizes/123e4567-e89b-12d3-a456-426614174000.webp'), true);
  assert.equal(isValidImageUrl('/uploads/prizes/../x.png'), false);
  assert.equal(isValidImageUrl('https://evil.example/a.png'), false);
  assert.equal(isValidImageUrl('/uploads/prizes/123e4567-e89b-12d3-a456-426614174000.svg'), false);
});

test('winner status o\'tishlari: DELIVERED yakuniy, PENDING -> DELIVERED to\'g\'ridan-to\'g\'ri mumkin emas', () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), ['CANCELLED', 'CONTACTED', 'DELIVERED', 'PENDING']);
  assert.deepEqual(TRANSITIONS.DELIVERED, []);
  assert.ok(!TRANSITIONS.PENDING.includes('DELIVERED'));
});
