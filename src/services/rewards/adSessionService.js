'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { getClientConfig } = require('../adsgram/adsgramService');
const { fail, runTx } = require('./rewardCore');

/**
 * Reklama ko'rishdan OLDIN server sessiya ochadi. Reward faqat shu sessiya orqali hisoblanadi,
 * shuning uchun klient o'zi "reward ID" o'ylab topa olmaydi.
 * Bitta userda bir vaqtda bitta PENDING sessiya: yangisi eskisini EXPIRED qiladi.
 */
async function createSession(user) {
  const now = new Date();

  const result = await runTx(async (tx) => {
    await lockUser(tx, user.telegramId);

    await tx.adSession.updateMany({
      where: { userId: user.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

    const session = await tx.adSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(now.getTime() + config.ads.sessionTtlMs),
      },
    });
    return { success: true, session };
  });

  if (!result.success) return result;

  return {
    success: true,
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt,
    minDurationMs: config.ads.minDurationMs,
    adsgram: getClientConfig(),
  };
}

/** Faqat o'z sessiyasining holatini ko'rsatadi (PENDING_CONFIRMATION kutayotgan klient uchun). */
async function getSessionStatus(user, sessionId) {
  const s = await prisma.adSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, status: true, expiresAt: true, rewardedAt: true },
  });
  if (!s || s.userId !== user.id) return fail('SESSION_NOT_FOUND');
  return { success: true, sessionId: s.id, status: s.status, expiresAt: s.expiresAt, rewardedAt: s.rewardedAt };
}

module.exports = { createSession, getSessionStatus };