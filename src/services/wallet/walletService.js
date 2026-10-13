'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { lockUser } = require('../../utils/dbLock');
const { isUniqueViolation } = require('../../utils/dbErrors');
const { COIN_TX, CURRENCY, TX_OPTS, TxAbort, fail, applyCoins, getBalances } = require('../coins/coinService');

// Narx Int ga sig'ishi uchun texnik yuqori chegara (biznes limit emas): coins * coinPriceUzs <= 2^31-1
const MAX_COINS = Math.floor(2_147_483_647 / config.wallet.coinPriceUzs);

/**
 * Telegram Bot API chaqiruvi. { ok, result, description } qaytaradi, hech qachon throw qilmaydi.
 * Faqat TARMOQ xatosida (ulanish o'rnatilmadi / timeout) 3 martagacha qayta uriniladi: bunday so'rov Telegramga yetmagan.
 * Telegram javob bergan bo'lsa (ok:false ham) qayta urinilmaydi.
 */
async function tg(method, params) {
  let description = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
        signal: AbortSignal.timeout(6000),
      });
      const data = await res.json();
      return { ok: Boolean(data && data.ok), result: data && data.result, description: data && data.description };
    } catch (err) {
      const code = (err && err.cause && err.cause.code) || err.name || '';
      description = `${err.message}${code ? ` (${code})` : ''}`;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return { ok: false, result: null, description };
}

/** 5000 -> "5 000" (invoice matni uchun) */
function fmtUzs(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Mini App uchun OMMAVIY wallet sozlamalari (provider token hech qachon qaytmaydi). */
function getPublicConfig() {
  const w = config.wallet;
  return {
    enabled: w.enabled,
    coinPriceUzs: w.coinPriceUzs,
    topupMinUzs: w.topupMinUzs,
    topupMaxUzs: w.topupMaxUzs, // texnik yuqori chegara (biznes limit emas)
    coinBuyMin: w.coinBuyMin,
    packages: w.coinPackages,
  };
}

/**
 * So'm balansni to'ldirish uchun invoice yaratadi. Klientdan faqat amountUzs (so'm) keladi.
 * Payment(PENDING) yaratiladi, payload = payment.id. Balansga pul FAQAT successful_payment hodisasida qo'shiladi (bot/payments.js).
 * Telegram summasi TIYINDA: so'm * 100.
 * Qaytadi: { success:true, paymentId, invoiceUrl } yoki { success:false, reason, ...extra }.
 *  reason: WALLET_UNAVAILABLE | INVALID_AMOUNT | INVOICE_FAILED
 */
async function createTopup(user, amountUzs) {
  if (!config.wallet.enabled) return fail('WALLET_UNAVAILABLE');
  const { topupMinUzs, topupMaxUzs } = config.wallet;
  if (!Number.isSafeInteger(amountUzs) || amountUzs < topupMinUzs || amountUzs > topupMaxUzs) {
    return fail('INVALID_AMOUNT', { min: topupMinUzs, max: topupMaxUzs });
  }

  const payment = await prisma.payment.create({
    data: { userId: user.id, amountUzs },
    select: { id: true },
  });

  const r = await tg('createInvoiceLink', {
    title: 'Hamyonni to\'ldirish',
    description: `Hamyonga ${fmtUzs(amountUzs)} so'm qo'shiladi`,
    payload: payment.id,
    provider_token: config.wallet.providerToken,
    currency: 'UZS',
    prices: [{ label: 'Hamyon', amount: amountUzs * 100 }],
  });

  if (!r.ok || typeof r.result !== 'string' || !r.result) {
    // Invoice yaratilmadi: to'lov hech qachon bo'lmaydi, PENDING qolib ketmasin
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
    logger.error({ paymentId: payment.id, err: r.description }, 'createInvoiceLink xato');
    return fail('INVOICE_FAILED');
  }

  return { success: true, paymentId: payment.id, invoiceUrl: r.result };
}

/** Faqat O'Z to'lovi holati. Boshqa user to'lovi — PAYMENT_NOT_FOUND (mavjudligi ham oshkor bo'lmaydi). */
async function getPayment(user, paymentId) {
  const row = await prisma.payment.findFirst({
    where: { id: paymentId, userId: user.id },
    select: { id: true, amountUzs: true, status: true, paidAt: true },
  });
  if (!row) return fail('PAYMENT_NOT_FOUND');
  return {
    success: true,
    paymentId: row.id,
    status: row.status, // PENDING | PAID | FAILED | CANCELLED
    amountUzs: row.amountUzs,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  };
}

/**
 * So'm balansdan Rush Coin sotib olish. Klientdan faqat `coins` (nechta tanga) va `requestId` keladi;
 * narx (priceUzs = coins * COIN_PRICE_UZS) serverda, butun sonlarda hisoblanadi.
 * Bitta tranzaksiyada: user qulfi -> so'm -narx (COIN_BUY_OUT) -> Rush +coins (COIN_BUY_IN). Ikkala ledger yozuvi
 * refType='COIN_BUY' va bir xil refId (requestId) bilan bog'langan. Idempotent: bir xil requestId ikkinchi marta DUPLICATE_REQUEST.
 * Qaytadi: { success:true, balanceUzs, rushCoins, bought:{ coins, priceUzs } } yoki { success:false, reason, balanceUzs, rushCoins }.
 *  reason: WALLET_UNAVAILABLE | INVALID_AMOUNT | INSUFFICIENT_FUNDS | DUPLICATE_REQUEST
 */
async function buyCoins(user, coins, requestId) {
  if (!requestId) throw new Error('buyCoins: requestId majburiy');
  const { coinBuyMin, coinPriceUzs } = config.wallet;
  if (!config.wallet.enabled) return fail('WALLET_UNAVAILABLE', await getBalances(user.id));
  if (!Number.isSafeInteger(coins) || coins < coinBuyMin || coins > MAX_COINS) {
    return fail('INVALID_AMOUNT', { min: coinBuyMin, max: MAX_COINS, ...(await getBalances(user.id)) });
  }
  const priceUzs = coins * coinPriceUzs; // faqat serverda hisoblanadi

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);

      const debit = await applyCoins(tx, {
        userId: user.id,
        amount: -priceUzs,
        currency: CURRENCY.UZS,
        type: COIN_TX.COIN_BUY_OUT,
        idempotencyKey: `COIN_BUY_OUT:${user.id}:${requestId}`,
        refType: 'COIN_BUY',
        refId: requestId,
      });
      if (!debit.ok) throw new TxAbort(fail('INSUFFICIENT_FUNDS', await getBalances(user.id, tx)));

      const credit = await applyCoins(tx, {
        userId: user.id,
        amount: coins,
        currency: CURRENCY.RUSH,
        type: COIN_TX.COIN_BUY_IN,
        idempotencyKey: `COIN_BUY_IN:${user.id}:${requestId}`,
        refType: 'COIN_BUY',
        refId: requestId,
      });
      if (!credit.ok) throw new Error('buyCoins: Rush kirimi yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback

      return { success: true, balanceUzs: debit.balance, rushCoins: credit.balance, bought: { coins, priceUzs } };
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    // Bir xil requestId ikkinchi marta: idempotencyKey UNIQUE to'qnashuvi (birinchi xarid o'z holicha qoladi)
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return fail('DUPLICATE_REQUEST', await getBalances(user.id));
    }
    throw err;
  }
}

module.exports = { MAX_COINS, getPublicConfig, createTopup, getPayment, buyCoins };