'use strict';

// server_confirmed rejimi: ball faqat AdsGram Reward URL tasdig'i bilan hisoblanadi.
process.env.ADSGRAM_VERIFY_MODE = 'server_confirmed';
process.env.AD_MIN_DURATION_MS = '8000';
process.env.AD_COOLDOWN_MS = '0';
process.env.AD_DAILY_CAP = '0';
require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/db/prisma');
const { createFakeDb } = require('./helpers/fakeDb');
const { claimReward, registerAdsgramConfirmation } = require('../src/services/rewards/rewardService');

function withUser(f, u) {
  prisma.user = { findUnique: async ({ where }) => (where.telegramId === u.telegramId ? u : null) };
}

test('claim tasdiqsiz: PENDING_CONFIRMATION, ball yo\'q; keyin tasdiq kelganda aynan +1', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  withUser(f, u);
  const sid = await f.session(u, 20_000);

  const claim = await claimReward(u, sid);
  assert.equal(claim.status, 'PENDING_CONFIRMATION');
  assert.equal(claim.counted, false);
  assert.equal(f.ads(u), 0);

  const conf = await registerAdsgramConfirmation(u.telegramId);
  assert.deepEqual({ matched: conf.matched, counted: conf.counted }, { matched: true, counted: true });
  assert.equal(f.ads(u), 1);
  assert.equal(f.db.sessions[sid].status, 'REWARDED');

  // Xuddi shu tasdiq takrorlansa (AdsGram retry): ikkinchi ball yo'q
  const dup = await registerAdsgramConfirmation(u.telegramId);
  assert.equal(dup.matched, false);
  assert.equal(f.ads(u), 1);
});

test('tasdiq klient claimidan OLDIN kelsa ham to\'g\'ri hisoblanadi (bir marta)', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  withUser(f, u);
  const sid = await f.session(u, 20_000);
  f.db.sessions[sid].createdAt = new Date(Date.now() - 20_000);

  await registerAdsgramConfirmation(u.telegramId); // sessiya hali CLAIMED emas — tasdiq saqlanadi
  assert.equal(f.ads(u), 0);

  const claim = await claimReward(u, sid);
  assert.equal(claim.success, true);
  assert.equal(claim.counted, true);
  assert.equal(f.ads(u), 1);
  assert.equal(f.db.confirmations.filter((c) => c.sessionId === sid).length, 1);
});

test('tasdiq faqat bitta sessiyaga: 2 ta tasdiq + 1 ta CLAIMED sessiya = 1 ball; parallel ham', async () => {
  const f = createFakeDb();
  const u = f.user(1);
  withUser(f, u);
  const sid = await f.session(u, 20_000);
  await claimReward(u, sid);

  await Promise.all(Array.from({ length: 10 }, () => registerAdsgramConfirmation(u.telegramId)));
  assert.equal(f.ads(u), 1);
  assert.equal(f.db.rewards.length, 1);
});

test('noma\'lum user uchun tasdiq: hech narsa hisoblanmaydi', async () => {
  const f = createFakeDb();
  prisma.user = { findUnique: async () => null };
  const r = await registerAdsgramConfirmation(BigInt(999999));
  assert.equal(r.matched, false);
  assert.equal(f.db.rewards.length, 0);
});

test('bloklangan user uchun tasdiq e\'tiborsiz qoldiriladi', async () => {
  const f = createFakeDb();
  const u = { ...f.user(1), isBlocked: true };
  withUser(f, u);
  const sid = await f.session(u, 20_000);
  f.db.sessions[sid].status = 'CLAIMED';
  const r = await registerAdsgramConfirmation(u.telegramId);
  assert.equal(r.matched, false);
  assert.equal(f.ads(u), 0);
});
