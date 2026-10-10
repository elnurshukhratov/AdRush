'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { getSettings, stateFor } = require('../ads/adSettingsService');
const { fail, runTx, PROVIDERS, PLACEMENTS } = require('./rewardCore');

/**
 * Reklama ko'rishdan OLDIN server sessiya ochadi. Reward faqat shu sessiya orqali hisoblanadi,
 * shuning uchun klient o'zi "reward ID" o'ylab topa olmaydi.
 * Har bir sessiya aynan bitta provayder (adsgram | monetag | onclicka) va joyga (task | quick) bog'langan.
 * Bitta userda bir vaqtda bitta PENDING sessiya: yangisi eskisini EXPIRED qiladi.
 *
 * Javobda FAQAT tanlangan provayderning identifikatorlari qaytadi — boshqa provayderning ID si hech qachon aralashmaydi.
 */
async function createSession(user, { provider = 'adsgram', placement = 'task' } = {}) {
  if (!PROVIDERS.includes(provider)) return fail('INVALID_PROVIDER');
  if (!PLACEMENTS.includes(placement)) return fail('INVALID_PLACEMENT');
  // Tepada doim turadigan +1 olmos reklamasi faqat AdsGram orqali
  if (placement === 'quick' && provider !== 'adsgram') return fail('INVALID_PLACEMENT');

  const settings = await getSettings();
  const state = stateFor(settings, provider, placement);
  if (!state.enabled) return fail('PROVIDER_UNAVAILABLE', { provider, placement, detail: state.reason });

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
        provider,
        placement,
        expiresAt: new Date(now.getTime() + config.ads.sessionTtlMs),
      },
    });
    return { success: true, session };
  });

  if (!result.success) return result;

  const { values } = settings;
  const sessionId = result.session.id;
  const base = {
    success: true,
    sessionId,
    provider,
    placement,
    expiresAt: result.session.expiresAt,
    minDurationMs: config.ads.minDurationMs,
  };

  if (provider === 'adsgram') {
    const blockId = placement === 'quick' ? values.adsgramQuickBlockId : values.adsgramTaskBlockId;
    return { ...base, adsgram: { blockId, verifyMode: config.adsgram.verifyMode } };
  }
  if (provider === 'monetag') {
    // ymid = sessiya UUID si: faqat harf/raqam/- (Monetag talabiga mos). Postback shu ymid orqali sessiyani topadi.
    return {
      ...base,
      monetag: { zoneId: values.monetagZoneId, sdkUrl: values.monetagSdkUrl, ymid: sessionId, requestVar: `adrush_${placement}` },
    };
  }
  return { ...base, onclicka: { spotId: values.onclickaSpotId, sdkUrl: values.onclickaSdkUrl } };
}

/** Faqat o'z sessiyasining holatini ko'rsatadi (PENDING_CONFIRMATION kutayotgan klient uchun). */
async function getSessionStatus(user, sessionId) {
  const s = await prisma.adSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, status: true, provider: true, placement: true, expiresAt: true, rewardedAt: true },
  });
  if (!s || s.userId !== user.id) return fail('SESSION_NOT_FOUND');
  return {
    success: true,
    sessionId: s.id,
    status: s.status,
    provider: s.provider,
    placement: s.placement,
    expiresAt: s.expiresAt,
    rewardedAt: s.rewardedAt,
  };
}

module.exports = { createSession, getSessionStatus };