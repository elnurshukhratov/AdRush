'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { applyCoins, COIN_TX, CURRENCY } = require('../coins/coinService');

const TX_OPTS = Object.freeze({ maxWait: 5000, timeout: 10000 });

function fail(reason, extra = {}) {
  return { success: false, reason, ...extra };
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Tranzaksiya ichida: dailyCap -> AdReward yaratadi -> user balansiga +DIAMOND_PER_AD olmos (ledger bilan) -> sessiyani REWARDED qiladi.
 * Hammasi bitta tranzaksiya: biror qadam yiqilsa hech narsa yozilmaydi.
 * Chaqiruvchi lockUser() ni ushlab turgan bo'lishi shart.
 * Eslatma: DB xatosi (masalan unique) tranzaksiyani buzadi, shuning uchun bu yerda ushlanmaydi — runTx ushlaydi.
 */
async function award(tx, session, now, meta) {
  if (config.ads.dailyCap > 0) {
    const today = await tx.adReward.count({
      where: { userId: session.userId, createdAt: { gte: startOfUtcDay(now) } },
    });
    if (today >= config.ads.dailyCap) {
      await tx.adSession.update({
        where: { id: session.id },
        data: { status: 'REJECTED', rejectReason: 'DAILY_LIMIT_REACHED' },
      });
      return fail('DAILY_LIMIT_REACHED');
    }
  }

  const diamonds = config.diamond.perAd;

  await tx.adReward.create({
    data: {
      userId: session.userId,
      externalRewardId: session.id, // UNIQUE — duplicate/replay ning DB darajasidagi kafolati
      metadata: {
        verifyMode: config.adsgram.verifyMode,
        sessionCreatedAt: session.createdAt.toISOString(),
        elapsedMs: now.getTime() - session.createdAt.getTime(),
        diamonds,
        ...meta,
      },
    },
  });

  const credit = await applyCoins(tx, {
    userId: session.userId,
    amount: diamonds,
    currency: CURRENCY.DIAMOND,
    type: COIN_TX.ADS_REWARD,
    idempotencyKey: `ADS_REWARD:${session.id}`, // ikkinchi himoya qatlami (AdReward.externalRewardId dan tashqari)
    refType: 'ad_session',
    refId: session.id,
  });
  if (!credit.ok) throw new Error('ADS_REWARD_CREDIT_FAILED'); // +N hech qachon "yetarli emas" bo'lmaydi — bo'lsa rollback

  await tx.adSession.update({ where: { id: session.id }, data: { status: 'REWARDED', rewardedAt: now } });

  return { success: true, status: 'REWARDED', counted: true, reward: diamonds, diamonds: credit.balance };
}

/** Tranzaksiya wrapperi: externalRewardId unique buzilsa DUPLICATE_REWARD qaytaradi, qolganini tashlaydi. */
async function runTx(fn) {
  try {
    return await prisma.$transaction(fn, TX_OPTS);
  } catch (err) {
    if (err && err.code === 'P2002') {
      const target = String(err.meta && err.meta.target);
      if (target.includes('externalRewardId') || target.includes('idempotencyKey')) return fail('DUPLICATE_REWARD');
    }
    throw err;
  }
}

module.exports = { TX_OPTS, fail, award, runTx, startOfUtcDay };