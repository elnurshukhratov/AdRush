'use strict';

const { z } = require('zod');
const { asyncHandler } = require('../../utils/apiError');
const { createSession, getSessionStatus } = require('../../services/rewards/adSessionService');
const { claimReward } = require('../../services/rewards/rewardService');
const { PROVIDERS, PLACEMENTS } = require('../../services/rewards/rewardCore');
const { getPublicConfig } = require('../../services/ads/adSettingsService');

const REASON_STATUS = Object.freeze({
  DUPLICATE_REWARD: 200, // idempotent: qayta yuborish xato emas, lekin hisoblanmaydi
  SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  SESSION_REJECTED: 422,
  CLAIM_TOO_FAST: 422,
  COOLDOWN: 429,
  DAILY_LIMIT_REACHED: 429,
  INVALID_PROVIDER: 400,
  INVALID_PLACEMENT: 400,
  PROVIDER_UNAVAILABLE: 503, // provayder sozlanmagan / token yo'q — faqat shu karta "mavjud emas" bo'ladi, boshqalari ishlayveradi
});

const sessionIdSchema = z.object({ sessionId: z.string().uuid() }).strict();
// provider/placement berilmasa — adsgram + task (eski klient body yubormasa ham ishlaydi). `slot` eski maydon: qabul qilinadi, e'tiborga olinmaydi.
const startSchema = z
  .object({
    provider: z.enum(PROVIDERS).optional(),
    placement: z.enum(PLACEMENTS).optional(),
    slot: z.number().int().min(0).max(9).optional(),
  })
  .strict();

function send(res, result) {
  if (result.success) return res.json(result);
  return res.status(REASON_STATUS[result.reason] || 400).json(result);
}

/** GET /api/ads/config — Mini App uchun OMMAVIY sozlamalar (block/zone/spot ID lar). Tokenlar hech qachon qaytmaydi. */
const adsConfig = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...(await getPublicConfig()) });
});

/** POST /api/ads/session { provider?, placement? } — reklama ko'rishdan oldin sessiya ochadi */
const startSession = asyncHandler(async (req, res) => {
  const { provider = 'adsgram', placement = 'task' } = startSchema.parse(req.body || {});
  send(res, await createSession(req.auth.user, { provider, placement }));
});

/**
 * POST /api/ads/reward  body: { sessionId }
 * userId/telegramId bodyda KERAK EMAS va ishlatilmaydi — identifikatsiya initData orqali.
 */
const reward = asyncHandler(async (req, res) => {
  const { sessionId } = sessionIdSchema.parse(req.body);
  send(res, await claimReward(req.auth.user, sessionId));
});

/** GET /api/ads/session/:id — sessiya holati (PENDING_CONFIRMATION kutayotganda polling uchun) */
const sessionStatus = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  send(res, await getSessionStatus(req.auth.user, id));
});

module.exports = { adsConfig, startSession, reward, sessionStatus };