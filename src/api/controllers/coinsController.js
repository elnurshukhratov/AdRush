'use strict';

const { z } = require('zod');
const config = require('../../config');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const { getHistory, getBalance, transferCoins } = require('../../services/coins/coinService');

// Faqat toTelegramId, amount va requestId qabul qilinadi: yuboruvchi va balans bodyda KERAK EMAS (identifikatsiya — telegramAuth)
const transferSchema = z
  .object({
    // Telegram ID: faqat raqamlardan iborat satr yoki xavfsiz butun son (BigInt'ga aniq o'tadi)
    toTelegramId: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().positive().safe()]).transform((v) => String(v)),
    amount: z.number().int().min(config.rush.transferMin).max(config.rush.transferMax),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
  })
  .strict();

const TRANSFER_FAIL = Object.freeze({
  USER_NOT_FOUND: [404, 'Bunday foydalanuvchi topilmadi'],
  SELF_TRANSFER: [400, 'O\'zingizga yuborib bo\'lmaydi'],
  RECEIVER_BLOCKED: [403, 'Bu foydalanuvchiga yuborib bo\'lmaydi'],
  INSUFFICIENT_FUNDS: [402, 'Rush Coin yetarli emas'],
  TRANSFER_LIMIT: [409, 'Kunlik yuborish limiti oshib ketadi'],
  DUPLICATE_REQUEST: [409, 'Bu o\'tkazma allaqachon qabul qilingan'],
});

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^\d{1,18}$/).optional(),
  })
  .strict();

/**
 * GET /api/coins/history?limit=20&cursor=<id>
 * Faqat o'zining Rush Coin tarixi: +5 ADS_REWARD, +20 REFERRAL_REWARD, -50 COMPETITION_BET, +30 LOSS_REFUND ...
 */
const history = asyncHandler(async (req, res) => {
  const { limit, cursor } = querySchema.parse(req.query);
  const userId = req.auth.user.id;
  const [page, rushCoins] = await Promise.all([getHistory(userId, { limit, cursor }), getBalance(userId)]);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, rushCoins, ...page });
});

/**
 * POST /api/coins/transfer { toTelegramId, amount, requestId }
 * Foydalanuvchi o'z BO'SH balansidan boshqa foydalanuvchiga Rush Coin yuboradi (komissiya yo'q).
 * Javob: { success, rushCoins (yuboruvchining yangi balansi), amount, to:{ firstName, username } } — qabul qiluvchi haqida boshqa ma'lumot qaytmaydi.
 * Xatolar standart formatda: USER_NOT_FOUND | SELF_TRANSFER | RECEIVER_BLOCKED | INSUFFICIENT_FUNDS | TRANSFER_LIMIT | DUPLICATE_REQUEST | INVALID_AMOUNT.
 */
const transfer = asyncHandler(async (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    // Miqdor chegaradan chiqqan bo'lsa klientga aniq chegaralar qaytadi; qolgan hollarda umumiy INVALID_REQUEST (errorHandler)
    if (parsed.error.issues.some((i) => i.path[0] === 'amount')) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Miqdor noto\'g\'ri', { min: config.rush.transferMin, max: config.rush.transferMax });
    }
    throw parsed.error;
  }
  const { toTelegramId, amount, requestId } = parsed.data;

  const result = await transferCoins(req.auth.user.id, toTelegramId, amount, requestId);
  res.set('Cache-Control', 'private, no-store');
  if (!result.success) {
    const [status, message] = TRANSFER_FAIL[result.reason] || [400, 'O\'tkazma amalga oshmadi'];
    const { success: _s, reason, ...extra } = result; // rushCoins / dailyLimit / remaining klientga ketadi
    throw new ApiError(status, reason, message, extra);
  }
  return res.json(result);
});

module.exports = { history, transfer };