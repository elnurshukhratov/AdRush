'use strict';

const { z } = require('zod');
const { asyncHandler } = require('../../utils/apiError');
const { createSession, getSessionStatus } = require('../../services/rewards/adSessionService');
const { claimReward } = require('../../services/rewards/rewardService');

const REASON_STATUS = Object.freeze({
  DUPLICATE_REWARD: 200, // idempotent: qayta yuborish xato emas, lekin hisoblanmaydi
  SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  SESSION_REJECTED: 422,
  CLAIM_TOO_FAST: 422,
  COOLDOWN: 429,
  DAILY_LIMIT_REACHED: 429,
});

const sessionIdSchema = z.object({ sessionId: z.string().uuid() }).strict();
const startSchema = z.object({ slot: z.number().int().min(0).max(9).optional() }).strict(); // eski klient body yubormasa slot = 0

function send(res, result) {
  if (result.success) return res.json(result);
  return res.status(REASON_STATUS[result.reason] || 400).json(result);
}

/** POST /api/ads/session — reklama ko'rishdan oldin sessiya ochadi */
const startSession = asyncHandler(async (req, res) => {
  const { slot = 0 } = startSchema.parse(req.body || {});
  send(res, await createSession(req.auth.user, slot));
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

module.exports = { startSession, reward, sessionStatus };