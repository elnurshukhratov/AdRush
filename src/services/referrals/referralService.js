'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { lockUser } = require('../../utils/dbLock');
const { applyCoins, COIN_TX, CURRENCY } = require('../coins/coinService');
const { startOfUtcDay } = require('../rewards/rewardCore');

const TX_OPTS = Object.freeze({ maxWait: 5000, timeout: 10000 });
// Referral faqat YANGI user uchun: user yaratilganiga shuncha vaqt o'tgan bo'lsa qabul qilinmaydi (qo'shimcha himoya)
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;

let cachedBotUsername = config.rush.botUsername || null;

/** Bot username: .env dagi BOT_USERNAME, bo'lmasa Telegram getMe orqali (bir marta, keshlanadi). */
async function getBotUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data && data.ok && data.result && data.result.username) cachedBotUsername = data.result.username;
  } catch (err) {
    logger.warn({ err: err.message }, 'Bot username aniqlanmadi (getMe)');
  }
  return cachedBotUsername;
}

function parseReferrerId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^\d{1,15}$/.test(s) ? BigInt(s) : null;
}

/**
 * Yangi user referral havolasi orqali /start qilganda chaqiriladi (bot). Hammasi bitta tranzaksiyada:
 *   new user tekshiruvi -> referredByUserId yozish (faqat NULL bo'lsa) -> referrer'ga +REFERRAL_DIAMOND_REWARD olmos -> ledger
 * Qaytadi: { success:true, reward, referrerTelegramId } yoki { success:false, reason }.
 *  reason: INVALID_REFERRER | SELF_REFERRAL | NOT_NEW_USER | REFERRER_NOT_FOUND | REFERRER_BLOCKED | ALREADY_REFERRED | DAILY_CAP | DUPLICATE_REFERRAL
 * `newUser` — DB'dagi User (id, telegramId, createdAt). Referrer ID'si faqat start payload'idan olinadi.
 */
async function applyReferral(newUser, rawReferrerTelegramId) {
  const referrerTelegramId = parseReferrerId(rawReferrerTelegramId);
  if (!referrerTelegramId) return { success: false, reason: 'INVALID_REFERRER' };
  if (referrerTelegramId === BigInt(newUser.telegramId)) return { success: false, reason: 'SELF_REFERRAL' };
  if (Date.now() - new Date(newUser.createdAt).getTime() > NEW_USER_WINDOW_MS) return { success: false, reason: 'NOT_NEW_USER' };

  const referrer = await prisma.user.findUnique({
    where: { telegramId: referrerTelegramId },
    select: { id: true, telegramId: true, isBlocked: true },
  });
  if (!referrer) return { success: false, reason: 'REFERRER_NOT_FOUND' };
  if (referrer.isBlocked) return { success: false, reason: 'REFERRER_BLOCKED' };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, newUser.telegramId); // bir userning parallel /start lari ketma-ket o'tadi

      // Faqat hali hech kim taklif qilmagan user: shartli UPDATE (parallel so'rovlarda faqat bittasi count=1 oladi)
      const marked = await tx.user.updateMany({
        where: { id: newUser.id, referredByUserId: null },
        data: { referredByUserId: referrer.id },
      });
      if (marked.count !== 1) return { success: false, reason: 'ALREADY_REFERRED' };

      const cap = config.rush.referralDailyCap;
      if (cap > 0) {
        const today = await tx.user.count({
          where: { referredByUserId: referrer.id, createdAt: { gte: startOfUtcDay(new Date()) } },
        });
        if (today > cap) {
          // Limitdan oshdi: tranzaksiya rollback (referredByUserId ham yozilmaydi)
          const err = new Error('REFERRAL_DAILY_CAP');
          err.referralReason = 'DAILY_CAP';
          throw err;
        }
      }

      const reward = config.diamond.referralReward; // olmos
      const credit = await applyCoins(tx, {
        userId: referrer.id,
        amount: reward,
        currency: CURRENCY.DIAMOND,
        type: COIN_TX.REFERRAL_REWARD,
        idempotencyKey: `REFERRAL_REWARD:${newUser.id}`, // bitta yangi user = bitta reward
        refType: 'user',
        refId: newUser.id,
      });
      if (!credit.ok) throw new Error('REFERRAL_CREDIT_FAILED');

      return { success: true, reward, referrerTelegramId: referrer.telegramId.toString() };
    }, TX_OPTS);
  } catch (err) {
    if (err && err.referralReason) return { success: false, reason: err.referralReason };
    if (err && err.code === 'P2002' && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return { success: false, reason: 'DUPLICATE_REFERRAL' };
    }
    throw err;
  }
}

/** Foydalanuvchining referral statistikasi (olmosda) va havolasi. */
async function getMyReferrals(user) {
  const [invited, earned, username] = await Promise.all([
    prisma.user.count({ where: { referredByUserId: user.id } }),
    prisma.coinTransaction.aggregate({
      where: { userId: user.id, type: COIN_TX.REFERRAL_REWARD, currency: CURRENCY.DIAMOND },
      _sum: { amount: true },
    }),
    getBotUsername(),
  ]);
  return {
    invited,
    earnedDiamonds: earned._sum.amount || 0,
    rewardDiamonds: config.diamond.referralReward,
    link: username ? `https://t.me/${username}?start=ref_${user.telegramId.toString()}` : null,
  };
}

module.exports = { applyReferral, getMyReferrals, getBotUsername };