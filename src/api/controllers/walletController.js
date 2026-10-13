'use strict';

const { z } = require('zod');
const config = require('../../config');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const { MAX_COINS, getPublicConfig, createTopup, getPayment, buyCoins } = require('../../services/wallet/walletService');

const REASON_STATUS = Object.freeze({
  WALLET_UNAVAILABLE: 503, // PAYMENT_PROVIDER_TOKEN yo'q — wallet o'chiq
  INVALID_AMOUNT: 400,
  INSUFFICIENT_FUNDS: 402, // so'm balans yetmaydi
  DUPLICATE_REQUEST: 200, // idempotent: qayta yuborish xato emas, lekin qayta yechilmaydi
  INVOICE_FAILED: 502, // Telegram invoice yaratib bermadi
  PAYMENT_NOT_FOUND: 404,
});

// Faqat amountUzs (so'm). Narx/kurs/userId bodyda KERAK EMAS (identifikatsiya — telegramAuth)
const topupSchema = z
  .object({
    amountUzs: z.number().int().min(config.wallet.topupMinUzs).max(config.wallet.topupMaxUzs),
  })
  .strict();

// Faqat coins (tanga miqdori) va requestId. Narx/kurs bodyda KERAK EMAS — serverda hisoblanadi
const buySchema = z
  .object({
    coins: z.number().int().min(config.wallet.coinBuyMin).max(MAX_COINS),
    requestId: z.string().uuid(), // klient yaratgan UUID — idempotentlik uchun
  })
  .strict();

function send(res, result) {
  res.set('Cache-Control', 'private, no-store');
  if (result.success) return res.json(result);
  return res.status(REASON_STATUS[result.reason] || 400).json(result);
}

/** GET /api/wallet/config — min/max/narx/paketlar/enabled (Mini App qattiq yozilgan qiymat ishlatmaydi) */
const walletConfig = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...getPublicConfig() });
});

/**
 * POST /api/wallet/topup { amountUzs }
 * Invoice yaratadi. Javob: { success, paymentId, invoiceUrl }. Balans bu yerda O'ZGARMAYDI — faqat successful_payment da.
 */
const topup = asyncHandler(async (req, res) => {
  const parsed = topupSchema.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'amountUzs')) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Miqdor noto\'g\'ri', { min: config.wallet.topupMinUzs, max: config.wallet.topupMaxUzs });
    }
    throw parsed.error;
  }
  send(res, await createTopup(req.auth.user, parsed.data.amountUzs));
});

/** GET /api/wallet/payments/:id — faqat o'z to'lovi holati (PENDING | PAID | FAILED | CANCELLED) */
const paymentStatus = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  send(res, await getPayment(req.auth.user, id));
});

/**
 * POST /api/wallet/buy-coins { coins, requestId }
 * So'm balansdan Rush Coin sotib oladi (narx serverda: coins * COIN_PRICE_UZS).
 * Javob: { success, balanceUzs, rushCoins, bought:{ coins, priceUzs } } yoki { success:false, reason, balanceUzs, rushCoins }.
 * reason: INSUFFICIENT_FUNDS (402) | DUPLICATE_REQUEST (200) | WALLET_UNAVAILABLE (503) | INVALID_AMOUNT (400)
 */
const buyCoinsHandler = asyncHandler(async (req, res) => {
  const parsed = buySchema.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'coins')) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Miqdor noto\'g\'ri', { min: config.wallet.coinBuyMin, max: MAX_COINS });
    }
    throw parsed.error;
  }
  send(res, await buyCoins(req.auth.user, parsed.data.coins, parsed.data.requestId));
});

module.exports = { walletConfig, topup, paymentStatus, buyCoins: buyCoinsHandler };