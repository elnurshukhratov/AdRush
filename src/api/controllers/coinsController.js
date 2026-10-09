'use strict';

const { z } = require('zod');
const config = require('../../config');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const { getHistory, getBalances, transferCoins } = require('../../services/coins/coinService');
const { convertDiamonds } = require('../../services/coins/convertService');

// Faqat toTelegramId, amount va requestId qabul qilinadi: yuboruvchi va balans bodyda KERAK EMAS (identifikatsiya — telegramAuth)
const transferSchema = z
  .object({
    // Telegram ID: faqat raqamlardan iborat satr yoki xavfsiz butun son (BigInt'ga aniq o'tadi)
    toTelegramId: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().positive().safe()]).transform((v) => String(v)),
    amount: z.number().int().min(config.rush.transferMin).max(config.rush.transferMax),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
  })
  .strict();

// Olmos -> Rush Coin: faqat olmos miqdori va requestId. Rush miqdori serverda hisoblanadi (kurs configda)
const CONVERT_MAX = 1_000_000;
const convertSchema = z
  .object({
    diamonds: z.number().int().min(1).max(CONVERT_MAX),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
  })
  .strict();

const CONVERT_FAIL = Object.freeze({
  INSUFFICIENT_FUNDS: [402, 'Olmos yetarli emas'],
  DUPLICATE_REQUEST: [409, 'Bu almashtirish allaqachon qabul qilingan'],
});

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
 * Faqat o'zining tarixi (Rush Coin va olmos): har bir yozuvda currency ('RUSH' | 'DIAMOND') bor.
 */
const history = asyncHandler(async (req, res) => {
  const { limit, cursor } = querySchema.parse(req.query);
  const userId = req.auth.user.id;
  const [page, balances] = await Promise.all([getHistory(userId, { limit, cursor }), getBalances(userId)]);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...balances, ...page });
});

/**
 * POST /api/coins/convert { diamonds, requestId }
 * Olmosni Rush Coin ga almashtiradi (1 olmos = DIAMOND_TO_RUSH Rush). Javob: { success, diamonds, rushCoins (yangi balanslar), converted:{ diamonds, rush } }.
 * Xatolar standart formatda: INSUFFICIENT_FUNDS | DUPLICATE_REQUEST | INVALID_AMOUNT.
 */
const convert = asyncHandler(async (req, res) => {
  const parsed = convertSchema.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'diamonds')) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Miqdor noto\'g\'ri', { min: 1, max: CONVERT_MAX });
    }
    throw parsed.error;
  }
  const { diamonds, requestId } = parsed.data;

  const result = await convertDiamonds(req.auth.user, diamonds, requestId);
  res.set('Cache-Control', 'private, no-store');
  if (!result.success) {
    const [status, message] = CONVERT_FAIL[result.reason] || [400, 'Almashtirish amalga oshmadi'];
    const { success: _s, reason, ...extra } = result; // joriy balanslar klientga ketadi
    throw new ApiError(status, reason, message, extra);
  }
  return res.json(result);
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

module.exports = { history, transfer, convert };