'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { lockUser } = require('../../utils/dbLock');
const { logSuspicious } = require('../../utils/securityLog');
const { getSettings } = require('../ads/adSettingsService');
const { fail, award, runTx, providerOf, placementOf, cooldownRemainingMs } = require('./rewardCore');

/**
 * POST /api/ads/reward — klient "reklama ko'rildi" deganda. Klient hodisasi O'ZI mukofot berish uchun yetarli EMAS.
 *
 * Ketma-ketlik (hammasi bitta tranzaksiya + user bo'yicha advisory lock ichida):
 *  1. Sessiya shu userniki va PENDING ekanini tekshirish (boshqa holat -> DUPLICATE_REWARD / EXPIRED / REJECTED)
 *  2. Muddat
 *  3. Provayderga qarab:
 *     monetag  — claim mukofot BERMAYDI. Mukofot faqat Monetag server postbacki (registerMonetagPostback, ymid = sessiya ID)
 *                tasdiqlaganda beriladi. Bu yerda faqat holat qaytadi.
 *     adsgram  — minimal ko'rish vaqti, cooldown; server_confirmed: Reward URL tasdig'i bor bo'lsa award(), yo'q bo'lsa
 *                sessiya CLAIMED bo'lib tasdiq kutadi; client_session (zaifroq, ixtiyoriy rejim): darhol award().
 *     onclicka — adsgram bilan bir xil server_confirmed oqimi (client_session rejimi OnClickA ga TAALLUQLI EMAS).
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

    const provider = providerOf(session);
    const placement = placementOf(session);

    switch (session.status) {
      case 'REWARDED':
        // Monetag: postback klient claimidan OLDIN kelib mukofotni allaqachon hisoblagan bo'lishi mumkin — bu xato emas
        if (provider === 'monetag') return { success: true, status: 'REWARDED', counted: false };
        return fail('DUPLICATE_REWARD');
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

    // TEST MODE: test reklamasi server tasdig'ini yubormaydi — sessiya (idempotency kaliti) orqali darhol hisoblanadi.
    // Duplicate: sessiya REWARDED bo'lgach yuqorida DUPLICATE_REWARD qaytadi, AdReward.externalRewardId esa UNIQUE.
    if (testMode) {
      return award(tx, session, now, { via: 'test_mode' });
    }

    // Monetag: klientdan mukofot yo'q. Faqat server postback. Klient holatni /api/ads/session/:id orqali kuzatadi.
    if (provider === 'monetag') {
      return { success: true, status: 'PENDING_CONFIRMATION', counted: false };
    }

    const elapsedMs = now.getTime() - session.createdAt.getTime();
    if (elapsedMs < config.ads.minDurationMs) {
      // Haqiqiy reklama bunchalik tez tugamaydi — sessiyani yopamiz (qayta urinib bo'lmasin)
      await tx.adSession.update({
        where: { id: session.id },
        data: { status: 'REJECTED', rejectReason: 'CLAIM_TOO_FAST' },
      });
      logSuspicious('CLAIM_TOO_FAST', {
        telegramId: user.telegramId.toString(),
        sessionId: session.id,
        provider,
        elapsedMs,
        minDurationMs: config.ads.minDurationMs,
      });
      return fail('CLAIM_TOO_FAST');
    }

    // Cooldown HAR BIR KARTA (provayder + joy) uchun alohida
    const wait = await cooldownRemainingMs(tx, session, now);
    if (wait > 0) {
      // Sessiya PENDING qoladi — klient biroz kutib qayta urinishi mumkin
      return fail('COOLDOWN', { retryAfterMs: wait });
    }

    // client_session — faqat AdsGram uchun, ixtiyoriy va zaifroq rejim. Monetag/OnClickA hech qachon shu yo'lga tushmaydi.
    if (provider === 'adsgram' && config.adsgram.verifyMode === 'client_session') {
      return award(tx, session, now, { via: 'client_claim' });
    }

    // server_confirmed: provayder tasdig'i allaqachon kelganmi? (u klient claimidan oldin kelishi mumkin)
    // Faqat SHU provayder va SHU joydan kelgan tasdiq hisobga olinadi.
    const confirmation = await tx.adsgramConfirmation.findFirst({
      where: {
        telegramId: user.telegramId,
        provider,
        placement,
        sessionId: null,
        receivedAt: { gte: session.createdAt, lte: now },
      },
      orderBy: { receivedAt: 'asc' },
    });

    if (confirmation) {
      await tx.adsgramConfirmation.update({ where: { id: confirmation.id }, data: { sessionId: session.id } });
      return award(tx, session, now, {
        via: `client_claim+${provider}_confirmation`,
        confirmationId: confirmation.id.toString(),
      });
    }

    await tx.adSession.update({ where: { id: session.id }, data: { status: 'CLAIMED', claimedAt: now } });
    return { success: true, status: 'PENDING_CONFIRMATION', counted: false };
  });
}

/**
 * Server-to-server tasdiq (AdsGram Reward URL yoki OnClickA): GET ...?userid=<telegramId>.
 * Tasdiq bitta CLAIMED sessiyaga (eng eskisiga) ko'pi bilan bir marta bog'lanadi va FAQAT shu provayder + joyning
 * sessiyasiga (boshqa provayder yoki quick/task ga hech qachon). Mos sessiya hali yo'q bo'lsa tasdiq saqlanadi va
 * klient claimi kelganda ishlatiladi.
 */
async function registerConfirmation(provider, placement, telegramId) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, telegramId: true, isBlocked: true },
  });

  if (!user) {
    logSuspicious('CONFIRMATION_UNKNOWN_USER', { provider, telegramId: telegramId.toString() });
    return { matched: false, reason: 'UNKNOWN_USER' };
  }
  if (user.isBlocked) {
    logger.info({ provider, telegramId: telegramId.toString() }, 'Bloklangan user uchun reklama tasdig\'i e\'tiborsiz qoldirildi');
    return { matched: false, reason: 'USER_BLOCKED' };
  }

  const result = await runTx(async (tx) => {
    await lockUser(tx, telegramId);
    const now = new Date();

    const confirmation = await tx.adsgramConfirmation.create({ data: { telegramId, provider, placement, receivedAt: now } });

    const session = await tx.adSession.findFirst({
      where: { userId: user.id, provider, placement, status: 'CLAIMED', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    });
    if (!session) return { success: true, matched: false };

    await tx.adsgramConfirmation.update({ where: { id: confirmation.id }, data: { sessionId: session.id } });
    const awarded = await award(tx, session, now, {
      via: `${provider}_confirmation`,
      confirmationId: confirmation.id.toString(),
    });
    return { ...awarded, matched: true };
  });

  return result.matched
    ? { matched: true, counted: result.success === true, reason: result.reason }
    : { matched: false };
}

/** AdsGram Reward URL (eski nom saqlangan). placement: 'task' | 'quick'. */
function registerAdsgramConfirmation(telegramId, placement = 'task') {
  return registerConfirmation('adsgram', placement, telegramId);
}

/** OnClickA tasdig'i (faqat Vazifalar kartasi). */
function registerOnclickaConfirmation(telegramId) {
  return registerConfirmation('onclicka', 'task', telegramId);
}

/**
 * Monetag reward postback. Monetag ymid ni (= bizning sessiya UUID imiz) qaytaradi, shuning uchun bu AdsGram/OnClickA dan
 * kuchliroq: tasdiq aniq bitta sessiyaga bog'lanadi.
 *
 * Mukofot faqat quyidagilarning HAMMASI bajarilganda:
 *  - event_type=impression va reward_event_type=valued (click / non_valued mukofot BERMAYDI)
 *  - zone_id admin sozlagan Monetag zonasiga teng
 *  - ymid bizning MONETAG sessiyamiz (boshqa provayder sessiyasi emas)
 *  - telegram_id (agar kelgan bo'lsa) sessiya egasi bilan bir xil
 *  - sessiya PENDING/CLAIMED va muddati o'tmagan; user bloklanmagan; cooldown va kunlik limit
 * Takroriy postbacklar (Monetag qayta urinishi, click) sessiya REWARDED bo'lgani uchun hech narsa qo'shmaydi.
 */
async function registerMonetagPostback({ ymid, zoneId, eventType, rewardEventType, telegramId }) {
  if (eventType !== 'impression') return { handled: false, reason: 'IGNORED_EVENT' };
  if (rewardEventType !== 'valued') return { handled: true, counted: false, reason: 'NOT_VALUED' };

  const { values } = await getSettings();
  if (!values.monetagZoneId || String(zoneId) !== String(values.monetagZoneId)) {
    logSuspicious('MONETAG_ZONE_MISMATCH', { zoneId });
    return { handled: false, reason: 'ZONE_MISMATCH' };
  }

  const result = await runTx(async (tx) => {
    const probe = await tx.adSession.findUnique({ where: { id: ymid }, select: { id: true, userId: true, provider: true } });
    if (!probe || providerOf(probe) !== 'monetag') {
      logSuspicious('MONETAG_UNKNOWN_YMID', { ymid });
      return { success: true, handled: false, reason: 'UNKNOWN_SESSION' };
    }

    const user = await tx.user.findUnique({ where: { id: probe.userId }, select: { id: true, telegramId: true, isBlocked: true } });
    if (!user) return { success: true, handled: false, reason: 'UNKNOWN_USER' };
    await lockUser(tx, user.telegramId);

    // Lockdan KEYIN qayta o'qiymiz: parallel postback/claim holatni o'zgartirgan bo'lishi mumkin
    const session = await tx.adSession.findUnique({ where: { id: ymid } });
    const now = new Date();

    if (telegramId !== null && telegramId !== user.telegramId) {
      logSuspicious('MONETAG_TELEGRAM_ID_MISMATCH', { ymid, telegramId: user.telegramId.toString() });
      return { success: true, handled: false, reason: 'TELEGRAM_ID_MISMATCH' };
    }
    if (session.status === 'REWARDED') return { success: true, handled: true, counted: false, reason: 'ALREADY_REWARDED' };
    if (session.status !== 'PENDING' && session.status !== 'CLAIMED') {
      return { success: true, handled: true, counted: false, reason: `SESSION_${session.status}` };
    }
    if (user.isBlocked) return { success: true, handled: false, reason: 'USER_BLOCKED' };
    if (now >= session.expiresAt) {
      await tx.adSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
      return { success: true, handled: true, counted: false, reason: 'SESSION_EXPIRED' };
    }

    const wait = await cooldownRemainingMs(tx, session, now);
    if (wait > 0) {
      await tx.adSession.update({ where: { id: session.id }, data: { status: 'REJECTED', rejectReason: 'COOLDOWN' } });
      return { success: true, handled: true, counted: false, reason: 'COOLDOWN' };
    }

    const awarded = await award(tx, session, now, { via: 'monetag_postback', monetagZoneId: String(zoneId) });
    return { success: true, handled: true, counted: awarded.success === true, reason: awarded.reason };
  });

  return result.success === false ? { handled: true, counted: false, reason: result.reason } : result;
}

module.exports = {
  claimReward,
  registerAdsgramConfirmation,
  registerOnclickaConfirmation,
  registerMonetagPostback,
};