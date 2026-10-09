'use strict';

/**
 * Reward oqimi testlari uchun xotiradagi soxta DB. Tranzaksiya semantikasini taqlid qiladi:
 *  - $transaction bir vaqtda faqat bittasini bajaradi (pg_advisory_xact_lock o'rnida) — parallel so'rovlar ketma-ket o'tadi
 *  - xato bo'lsa tranzaksiya ichidagi barcha o'zgarishlar bekor qilinadi (rollback)
 *  - AdReward.externalRewardId UNIQUE buzilsa Prisma P2002 xatosi tashlanadi
 */
const { prisma } = require('../../src/db/prisma');

function createFakeDb({ competition } = {}) {
  const now = Date.now();
  const db = {
    comp: { id: 1, status: 'ACTIVE', startAt: new Date(now - 3600e3), endAt: new Date(now + 3600e3), ...competition },
    sessions: {},
    rewards: [],
    stats: {},
    confirmations: [],
    nextConfId: 1,
    nextSessionId: 1,
  };

  const uniqueErr = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['externalRewardId'] } });
  const matchStatus = (s, w) => (!w || w === undefined ? true : typeof w === 'string' ? s === w : w.in ? w.in.includes(s) : true);

  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ status: db.comp.status, startAt: db.comp.startAt, endAt: db.comp.endAt }],
    adSession: {
      findUnique: async ({ where }) => (db.sessions[where.id] ? { ...db.sessions[where.id] } : null),
      update: async ({ where, data }) => Object.assign(db.sessions[where.id], data),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of Object.values(db.sessions)) {
          if (s.userId === where.userId && matchStatus(s.status, where.status)) { Object.assign(s, data); count += 1; }
        }
        return { count };
      },
      findFirst: async ({ where }) => {
        const rows = Object.values(db.sessions)
          .filter((s) => s.userId === where.userId && s.status === where.status && s.expiresAt > where.expiresAt.gt)
          .sort((a, b) => a.createdAt - b.createdAt);
        return rows[0] ? { ...rows[0] } : null;
      },
      create: async ({ data }) => {
        const id = `00000000-0000-4000-8000-${String(db.nextSessionId++).padStart(12, '0')}`;
        db.sessions[id] = { id, status: 'PENDING', createdAt: new Date(), claimedAt: null, rewardedAt: null, rejectReason: null, ...data };
        return { ...db.sessions[id] };
      },
    },
    adReward: {
      count: async ({ where }) => db.rewards.filter((r) => r.userId === where.userId && r.createdAt >= where.createdAt.gte).length,
      findFirst: async ({ where }) => {
        const rows = db.rewards.filter((r) => r.userId === where.userId).sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ? { createdAt: rows[0].createdAt } : null;
      },
      create: async ({ data }) => {
        if (db.rewards.some((r) => r.externalRewardId === data.externalRewardId)) throw uniqueErr();
        db.rewards.push({ createdAt: new Date(), ...data });
        return data;
      },
    },
    monthlyStat: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.userId_competitionId.userId}:${where.userId_competitionId.competitionId}`;
        if (!db.stats[key]) db.stats[key] = { ...create };
        else db.stats[key].validAds += update.validAds.increment;
        return { validAds: db.stats[key].validAds };
      },
    },
    adsgramConfirmation: {
      create: async ({ data }) => {
        const row = { id: db.nextConfId++, sessionId: null, ...data };
        db.confirmations.push(row);
        return row;
      },
      findFirst: async ({ where }) =>
        db.confirmations
          .filter((c) => c.telegramId === where.telegramId && c.sessionId === null && c.receivedAt >= where.receivedAt.gte && c.receivedAt <= where.receivedAt.lte)
          .sort((a, b) => a.receivedAt - b.receivedAt)[0] || null,
      update: async ({ where, data }) => Object.assign(db.confirmations.find((c) => c.id === where.id), data),
    },
  };

  let chain = Promise.resolve();
  prisma.$transaction = (fn) => {
    const run = chain.then(async () => {
      const snap = structuredClone({ sessions: db.sessions, rewards: db.rewards, stats: db.stats, confirmations: db.confirmations });
      try {
        return await fn(tx);
      } catch (err) {
        Object.assign(db, snap); // rollback
        throw err;
      }
    });
    chain = run.catch(() => {});
    return run;
  };
  prisma.auditLog = { create: async () => ({}) };
  prisma.monthlyCompetition = { findFirst: async () => ({ ...db.comp }) };

  const user = (id, telegramId = 1000 + id) => ({ id, telegramId: BigInt(telegramId), isBlocked: false });
  /** Ma'lum yoshdagi PENDING sessiya yaratadi (createdAt ni ortga suradi). */
  const session = async (u, ageMs) => {
    const s = await tx.adSession.create({ data: { userId: u.id, competitionId: db.comp.id, expiresAt: new Date(Date.now() + 600e3) } });
    db.sessions[s.id].createdAt = new Date(Date.now() - ageMs);
    return s.id;
  };
  const ads = (u) => (db.stats[`${u.id}:${db.comp.id}`] || { validAds: 0 }).validAds;

  return { db, tx, user, session, ads };
}

module.exports = { createFakeDb };
