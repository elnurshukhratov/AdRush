'use strict';

const { z } = require('zod');
const { asyncHandler } = require('../../utils/apiError');
const adminCoinService = require('../../services/admin/adminCoinService');

const noStore = (res) => res.set('Cache-Control', 'private, no-store');

const lookupQuery = z.object({ q: z.string().trim().min(1).max(64) }).strict();

// Klient faqat: qabul qiluvchi Telegram ID, miqdor, requestId va tasdiqlash paytida ko'rgan username'ni yuboradi.
// Admin identifikatsiyasi — telegramAuth/requireAdmin (bodydan olinmaydi); balans va tekshiruvlar serverda.
const grantBody = z
  .object({
    telegramId: z.string().regex(/^\d{1,15}$/),
    amount: z.number().int().min(1).max(adminCoinService.MAX_GRANT),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
    expectedUsername: z.string().trim().max(64).nullable(),
  })
  .strict();

const historyQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().regex(/^\d{1,18}$/).optional(),
  })
  .strict();

/** GET /api/admin/coins/lookup?q=<telegramId | @username> — qabul qiluvchi va hozirgi Rush Coin balansi. */
const lookupUser = asyncHandler(async (req, res) => {
  const { q } = lookupQuery.parse(req.query);
  noStore(res);
  res.json({ success: true, user: await adminCoinService.lookupUser(q, req.auth.telegramId) });
});

/** POST /api/admin/coins/grant { telegramId, amount, requestId, expectedUsername } */
const grantCoins = asyncHandler(async (req, res) => {
  const body = grantBody.parse(req.body);
  const out = await adminCoinService.grantCoins(body, { telegramId: req.auth.telegramId, adminRole: req.auth.adminRole });
  noStore(res);
  res.json({ success: true, ...out });
});

/** GET /api/admin/coins/history?limit=20&before=<id> */
const history = asyncHandler(async (req, res) => {
  const q = historyQuery.parse(req.query);
  noStore(res);
  res.json({ success: true, ...(await adminCoinService.listGrants(q)) });
});

module.exports = { lookupUser, grantCoins, history };