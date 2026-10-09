'use strict';

// Reward qaroriy mantiqi (client_session rejimi): validatsiya, duplicate, race, cooldown.
process.env.ADSGRAM_VERIFY_MODE = 'client_session';
process.env.AD_MIN_DURATION_MS = '8000';
process.env.AD_COOLDOWN_MS = '10000';
process.env.AD_DAILY_CAP = '3';
require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb } = require('./helpers/fakeDb');
const { claimReward } = require('../src/services/rewards/rewardService');
const { createSession } = require('../src/services/rewards/adSessionService');

test('valid reklama: faqat bir marta hisoblanadi, takroriy claim DUPLICATE_REWARD', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const sid = await f.session(u, 20_000);

  const first = await claimReward(u, sid);
  assert.equal(first.success, true);
  assert.equal(first.counted, true);
  assert.equal(first.validAds, 1);

  const again = await claimReward(u, sid);
  assert.equal(again.success, false);
  assert.equal(again.reason, 'DUPLICATE_REWARD');
  assert.equal(f.ads(u), 1);
  assert.equal(f.db.rewards.length, 1);
});

test('race: bitta sessiya uchun 25 ta parallel claim — aynan 1 ta reward', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const sid = await f.session(u, 20_000);

  const results = await Promise.all(Array.from({ length: 25 }, () => claimReward(u, sid)));
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(results.filter((r) => r.reason === 'DUPLICATE_REWARD').length, 24);
  assert.equal(f.ads(u), 1);
  assert.equal(f.db.rewards.length, 1);
});

test('juda tez claim (reklama ko\'rilmagan): REJECTED, ball yo\'q, sessiya qayta ishlatilmaydi', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const sid = await f.session(u, 500);

  const r = await claimReward(u, sid);
  assert.equal(r.reason, 'CLAIM_TOO_FAST');
  assert.equal(f.ads(u), 0);
  assert.equal(f.db.sessions[sid].status, 'REJECTED');

  f.db.sessions[sid].createdAt = new Date(Date.now() - 60_000); // vaqt o'tgach ham qayta ishlatib bo'lmaydi
  assert.equal((await claimReward(u, sid)).reason, 'SESSION_REJECTED');
  assert.equal(f.ads(u), 0);
});

test('boshqa userning sessiyasi: SESSION_NOT_FOUND (mavjudligi oshkor qilinmaydi), ball yo\'q', async () => {
  const f = createFakeDb();
  const owner = f.user(1);
  const thief = f.user(2);
  const sid = await f.session(owner, 20_000);

  const r = await claimReward(thief, sid);
  assert.equal(r.reason, 'SESSION_NOT_FOUND');
  assert.equal(f.ads(thief), 0);
  assert.equal(f.ads(owner), 0);
  assert.equal(f.db.sessions[sid].status, 'PENDING'); // egasi hali ishlata oladi
});

test('cooldown: ketma-ket ikkinchi reklama COOLDOWN, sessiya PENDING qoladi', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  assert.equal((await claimReward(u, await f.session(u, 20_000))).success, true);

  const second = await f.session(u, 20_000);
  const r = await claimReward(u, second);
  assert.equal(r.reason, 'COOLDOWN');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 10_000);
  assert.equal(f.db.sessions[second].status, 'PENDING');
  assert.equal(f.ads(u), 1);
});

test('kunlik limit: AD_DAILY_CAP dan keyin DAILY_LIMIT_REACHED', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  for (let i = 0; i < 3; i += 1) {
    f.db.rewards.length && (f.db.rewards[f.db.rewards.length - 1].createdAt = new Date(Date.now() - 60_000)); // cooldown o'tgan
    assert.equal((await claimReward(u, await f.session(u, 20_000))).success, true);
  }
  f.db.rewards[f.db.rewards.length - 1].createdAt = new Date(Date.now() - 60_000);
  const r = await claimReward(u, await f.session(u, 20_000));
  assert.equal(r.reason, 'DAILY_LIMIT_REACHED');
  assert.equal(f.ads(u), 3);
});

test('competition yopilgan/ACTIVE emas: reward hisoblanmaydi', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const sid = await f.session(u, 20_000);
  f.db.comp.status = 'ENDED';
  const r = await claimReward(u, sid);
  assert.equal(r.reason, 'COMPETITION_CLOSED');
  assert.equal(f.ads(u), 0);
});

test('createSession: faol competition yo\'q bo\'lsa NO_ACTIVE; yangi sessiya eskisini EXPIRED qiladi', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const { prisma } = require('../src/db/prisma');

  const a = await createSession(u);
  const b = await createSession(u);
  assert.equal(a.success && b.success, true);
  assert.equal(f.db.sessions[a.sessionId].status, 'EXPIRED');
  assert.equal(f.db.sessions[b.sessionId].status, 'PENDING');
  assert.equal(b.minDurationMs, 8000);

  prisma.monthlyCompetition = { findFirst: async () => null };
  assert.equal((await createSession(u)).reason, 'NO_ACTIVE_COMPETITION');
});

test('tranzaksiya xatosida rollback: yarim hisoblangan reward qolmaydi', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  const sid = await f.session(u, 20_000);
  // monthlyStat.upsert yiqilsa: AdReward ham bekor bo'lishi kerak
  const orig = f.tx.monthlyStat.upsert;
  f.tx.monthlyStat.upsert = async () => { throw new Error('db down'); };
  await assert.rejects(() => claimReward(u, sid), /db down/);
  f.tx.monthlyStat.upsert = orig;
  assert.equal(f.db.rewards.length, 0);
  assert.equal(f.db.sessions[sid].status, 'PENDING');
  assert.equal((await claimReward(u, sid)).success, true); // keyin qayta urinish ishlaydi
});
