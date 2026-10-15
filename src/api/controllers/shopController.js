'use strict';

const { z } = require('zod');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const { getBalance } = require('../../services/coins/coinService');
const shopService = require('../../services/shop/shopService');
const shopHistory = require('../../services/shop/shopHistoryService');

const buySchema = z
  .object({
    productId: z.number().int().positive().safe(),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
  })
  .strict();

const ordersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^\d{1,10}$/).optional(),
  })
  .strict();

const BUY_FAIL = Object.freeze({
  PRODUCT_NOT_FOUND: [404, 'Mahsulot topilmadi'],
  OUT_OF_STOCK: [409, 'Mahsulot tugagan'],
  INSUFFICIENT_FUNDS: [402, 'Rush Coin yetarli emas'],
  DUPLICATE_REQUEST: [409, 'Bu xarid allaqachon qabul qilingan'],
});

/** GET /api/shop/products — faqat faol va zaxirasi bor mahsulotlar; bo'sh bo'lsa bo'sh ro'yxat. */
const products = asyncHandler(async (req, res) => {
  const [items, rushCoins] = await Promise.all([shopService.listProducts(), getBalance(req.auth.user.id)]);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, rushCoins, items });
});

/** POST /api/shop/buy { productId, requestId } */
const buy = asyncHandler(async (req, res) => {
  const { productId, requestId } = buySchema.parse(req.body);
  const result = await shopService.buyProduct(req.auth.user, productId, requestId);
  res.set('Cache-Control', 'private, no-store');
  if (!result.success) {
    const [status, message] = BUY_FAIL[result.reason] || [400, 'Xarid amalga oshmadi'];
    const { success: _s, reason, ...extra } = result;
    throw new ApiError(status, reason, message, extra);
  }
  return res.json(result);
});

/** GET /api/shop/orders?limit=20&cursor=<id> — faqat o'zining buyurtmalari. */
const orders = asyncHandler(async (req, res) => {
  const { limit, cursor } = ordersQuerySchema.parse(req.query);
  const page = await shopService.listMyOrders(req.auth.user.id, { limit, cursor });
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...page });
});

/** GET /api/shop/history — ommaviy Tarix: eng so'nggi 10 ta topshirilgan va admin tasdiqlagan sovg'a (sahifalash yo'q). */
const history = asyncHandler(async (_req, res) => {
  const page = await shopHistory.listPublicHistory();
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...page });
});

module.exports = { products, buy, orders, history };