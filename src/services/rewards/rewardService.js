'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { lockUser } = require('../../utils/dbLock');
const { logSuspicious } = require('../../utils/securityLog');
const { fail, award, runTx } = require('./rewardCore');

/**
 * POST /api/ads/reward — klient "reklama ko'rildi" deganda.
 *
 * Ketma-ketlik (hammasi bitta tranzaksiya + user bo'yicha advisory lock ichida):
 *  1. Sessiya shu userniki va PENDING ekanini tekshirish (boshqa holat -> DUPLICATE_REWARD / EXPIRED / REJECTED)
 *  2. Muddat, minimal ko'rish vaqti, cooldown (competition ochiqligi endi shart emas — reklama Rush Coin beradi)
 *  3. client_session rejimi: darhol award()
 *     server_confirmed rejimi: AdsGram Reward URL tasdig'i bor bo'lsa award(), yo'q bo'lsa sessiya CLAIMED
 *     bo'lib tasdiq kutadi (tasdiq kelganda registerAdsgramConfirmation() yakunlaydi)
 */
async function claimReward(user, sessionId) {
  return runTx(async (tx) => {
    await lockUser(tx, user.telegramId);
    const now = new Date();

    const session = await tx.adSession.findUnique({ where: { id: sessionId } });
    if (!session) return fail('SESSION_NOT_FOUND');
    if (session.userId !== user.id) {
      // Boshqa userning sessiya ID sini ishlatishga urinish — mavjudligini ham oshkor qilmaymiz
      logSuspicious('FOREIGN_SESSION', { telegramId: user.telegramId.toString(), sessionId });
      return fail('SESSION_NOT_FOUND');
    }

    switch (session.status) {
      case 'REWARDED':
      case 'CLAIMED':
        return fail('DUPLICATE_REWARD');
      case 'EXPIRED':
        return fail('SESSION_EXPIRED');
      case 'REJECTED':
        return fail('SESSION_REJECTED');
      default:
        break; // PENDING
    }

    if (now >= session.expiresAt) {
      await tx.adSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
      return fail('SESSION_EXPIRED');
    }

    const testMode = config.ads.rewardTestMode; // faqat development/test: config production'da yoqishga yo'l qo'ymaydi

    const elapsedMs = now.getTime() - session.createdAt.getTime();
    if (!testMode && elapsedMs < config.ads.minDurationMs) {
      // Haqiqiy reklama bunchalik tez tugamaydi — sessiyani yopamiz (qayta urinib bo'lmasin)
      await tx.adSession.update({
        where: { id: session.id },
        data: { status: 'REJECTED', rejectReason: 'CLAIM_TOO_FAST' },
      });
      logSuspicious('CLAIM_TOO_FAST', {
        telegramId: user.telegramId.toString(),
        sessionId: session.id,
        elapsedMs,
        minDurationMs: config.ads.minDurationMs,
      });
      return fail('CLAIM_TOO_FAST');
    }

    if (!testMode && config.ads.cooldownMs > 0) {
      const last = await tx.adReward.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last) {
        const sinceLast = now.getTime() - last.createdAt.getTime();
        if (sinceLast < config.ads.cooldownMs) {
          // Sessiya PENDING qoladi — klient biroz kutib qayta urinishi mumkin
          return fail('COOLDOWN', { retryAfterMs: config.ads.cooldownMs - sinceLast });
        }
      }
    }

    // TEST MODE: AdsGram test reklamasi Reward URL yubormaydi — sessiya (idempotency kaliti) orqali darhol hisoblanadi.
    // Duplicate: sessiya REWARDED bo'lgach yuqorida DUPLICATE_REWARD qaytadi, AdReward.externalRewardId esa UNIQUE.
    if (testMode) {
      return award(tx, session, now, { via: 'test_mode' });
    }

    if (config.adsgram.verifyMode === 'client_session') {
      return award(tx, session, now, { via: 'client_claim' });
    }

    // server_confirmed: AdsGram tasdig'i allaqachon kelganmi? (u klient claimidan oldin kelishi mumkin)
    const confirmation = await tx.adsgramConfirmation.findFirst({
      where: {
        telegramId: user.telegramId,
        sessionId: null,
        receivedAt: { gte: session.createdAt, lte: now },
      },
      orderBy: { receivedAt: 'asc' },
    });

    if (confirmation) {
      await tx.adsgramConfirmation.update({ where: { id: confirmation.id }, data: { sessionId: session.id } });
      return award(tx, session, now, {
        via: 'client_claim+adsgram_reward_url',
        confirmationId: confirmation.id.toString(),
      });
    }

    await tx.adSession.update({ where: { id: session.id }, data: { status: 'CLAIMED', claimedAt: now } });
    return { success: true, status: 'PENDING_CONFIRMATION', counted: false };
  });
}

/**
 * AdsGram Reward URL (GET ...?userid=<telegramId>&token=...) kelganda chaqiriladi.
 * Tasdiq bitta CLAIMED sessiyaga (eng eskisiga) ko'pi bilan bir marta bog'lanadi.
 * Mos sessiya hali yo'q bo'lsa tasdiq saqlanadi va klient claimi kelganda ishlatiladi.
 */
async function registerAdsgramConfirmation(telegramId) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, telegramId: true, isBlocked: true },
  });

  if (!user) {
    logSuspicious('CONFIRMATION_UNKNOWN_USER', { telegramId: telegramId.toString() });
    return { matched: false, reason: 'UNKNOWN_USER' };
  }
  if (user.isBlocked) {
    logger.info({ telegramId: telegramId.toString() }, 'Bloklangan user uchun AdsGram tasdig\'i e\'tiborsiz qoldirildi');
    return { matched: false, reason: 'USER_BLOCKED' };
  }

  const result = await runTx(async (tx) => {
    await lockUser(tx, telegramId);
    const now = new Date();

    const confirmation = await tx.adsgramConfirmation.create({ data: { telegramId, receivedAt: now } });

    const session = await tx.adSession.findFirst({
      where: { userId: user.id, status: 'CLAIMED', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    });
    if (!session) return { success: true, matched: false };

    await tx.adsgramConfirmation.update({ where: { id: confirmation.id }, data: { sessionId: session.id } });
    const awarded = await award(tx, session, now, {
      via: 'adsgram_reward_url',
      confirmationId: confirmation.id.toString(),
    });
    return { ...awarded, matched: true };
  });

  return result.matched
    ? { matched: true, counted: result.success === true, reason: result.reason }
    : { matched: false };
}

module.exports = { claimReward, registerAdsgramConfirmation };
