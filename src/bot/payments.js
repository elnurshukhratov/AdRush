'use strict';

const { prisma } = require('../db/prisma');
const config = require('../config');
const logger = require('../utils/logger');
const { lockUser } = require('../utils/dbLock');
const { isUniqueViolation, isDbUnavailable } = require('../utils/dbErrors');
const { COIN_TX, CURRENCY, TX_OPTS, applyCoins } = require('../services/coins/coinService');
const { t } = require('./i18n');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// pre_checkout rad etish xabarlari (Telegram to'lov oynasida ko'rinadi, <= 200 belgi)
const MSG = Object.freeze({
  generic: 'Xatolik yuz berdi. Birozdan so\'ng qayta urinib ko\'ring.',
  unavailable: 'To\'lov hozircha mavjud emas.',
  blocked: 'Sizning akkauntingiz cheklangan.',
  notFound: 'To\'lov topilmadi. Ilovadan qaytadan urinib ko\'ring.',
  notPending: 'Bu to\'lov allaqachon yakunlangan yoki bekor qilingan. Yangi to\'lov yarating.',
  amount: 'To\'lov summasi mos kelmadi. Ilovadan qaytadan urinib ko\'ring.',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 5000 -> "5 000" */
function fmtUzs(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** pre_checkout tekshiruvi: null = mos, aks holda rad etish xabari. Faqat DB o'qiydi (10 soniya ichida javob uchun tez). */
async function checkPreCheckout(ctx) {
  const q = ctx.preCheckoutQuery;
  if (!config.wallet.enabled) return MSG.unavailable;
  if (ctx.dbUser.isBlocked) return MSG.blocked;
  if (!UUID_RE.test(q.invoice_payload || '')) return MSG.notFound;

  const p = await prisma.payment.findUnique({
    where: { id: q.invoice_payload.toLowerCase() },
    select: { userId: true, amountUzs: true, status: true },
  });
  if (!p || p.userId !== ctx.dbUser.id) return MSG.notFound;
  if (p.status !== 'PENDING') return MSG.notPending;
  if (q.currency !== 'UZS' || q.total_amount !== p.amountUzs * 100) return MSG.amount; // Telegram summasi tiyinda
  return null;
}

/**
 * successful_payment ni hisobga oladi (bitta tranzaksiya):
 *   user qulfi -> Payment PENDING -> PAID (shartli updateMany, faqat bitta chaqiruv count=1 oladi) -> so'm balansga +amountUzs (WALLET_TOPUP).
 * Takroriy hodisa (count=0 yoki UNIQUE to'qnashuvi) hech narsa qo'shmaydi va xato emas.
 * Qaytadi: { credited:true, amountUzs, balance } | { credited:false }.
 */
async function creditPayment(dbUser, sp) {
  const paymentId = String(sp.invoice_payload || '').toLowerCase();
  const chargeId = sp.telegram_payment_charge_id;
  const logCtx = { paymentId, chargeId, telegramId: String(dbUser.telegramId), total: sp.total_amount, currency: sp.currency };

  if (!UUID_RE.test(paymentId) || !chargeId) {
    logger.error(logCtx, 'successful_payment: payload yoki charge id noto\'g\'ri (pul olingan, qo\'lda tekshiring)');
    return { credited: false };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, dbUser.telegramId);

      const p = await tx.payment.findUnique({ where: { id: paymentId }, select: { userId: true, amountUzs: true, status: true } });
      if (!p || p.userId !== dbUser.id) {
        logger.error(logCtx, 'successful_payment: to\'lov topilmadi yoki boshqa userniki (pul olingan, qo\'lda tekshiring)');
        return { credited: false };
      }
      if (sp.currency !== 'UZS' || sp.total_amount !== p.amountUzs * 100) {
        logger.error({ ...logCtx, expected: p.amountUzs * 100 }, 'successful_payment: summa mos emas (pul olingan, qo\'lda tekshiring)');
        return { credited: false };
      }

      const upd = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PAID', telegramChargeId: chargeId, providerChargeId: sp.provider_payment_charge_id || null, paidAt: new Date() },
      });
      if (upd.count !== 1) {
        // Takroriy hodisa: allaqachon PAID bo'lsa jim; boshqa holatda (FAILED/CANCELLED) pul olingan — qo'lda tekshirish kerak
        if (p.status !== 'PAID') logger.error({ ...logCtx, status: p.status }, 'successful_payment: to\'lov PENDING emas (pul olingan, qo\'lda tekshiring)');
        return { credited: false };
      }

      const credit = await applyCoins(tx, {
        userId: dbUser.id,
        amount: p.amountUzs,
        currency: CURRENCY.UZS,
        type: COIN_TX.WALLET_TOPUP,
        idempotencyKey: `WALLET_TOPUP:${chargeId}`,
        refType: 'PAYMENT',
        refId: paymentId,
      });
      if (!credit.ok) throw new Error('successful_payment: so\'m kirimi yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback

      return { credited: true, amountUzs: p.amountUzs, balance: credit.balance };
    }, TX_OPTS);
  } catch (err) {
    // Bir xil hodisa ikkinchi marta (idempotencyKey / telegramChargeId UNIQUE): rollback bo'ldi, hech narsa qo'shilmadi
    if (isUniqueViolation(err)) {
      logger.warn(logCtx, 'successful_payment: takroriy hodisa, e\'tiborsiz qoldirildi');
      return { credited: false };
    }
    throw err;
  }
}

function registerPayments(bot) {
  // 10 soniya ichida javob berilishi shart. Hech qachon throw qilmaydi.
  bot.on('pre_checkout_query', async (ctx) => {
    let error = MSG.generic;
    try {
      error = await checkPreCheckout(ctx);
    } catch (err) {
      logger.error({ err, queryId: ctx.preCheckoutQuery.id }, 'pre_checkout tekshiruvi xato');
    }
    try {
      if (error) await ctx.answerPreCheckoutQuery(false, error);
      else await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      logger.error({ err: err.description || err.message, queryId: ctx.preCheckoutQuery.id }, 'answerPreCheckoutQuery xato');
    }
  });

  bot.on('message:successful_payment', async (ctx) => {
    const sp = ctx.message.successful_payment;
    try {
      let result;
      for (let attempt = 1; ; attempt += 1) {
        try {
          result = await creditPayment(ctx.dbUser, sp);
          break;
        } catch (err) {
          // Baza vaqtincha mavjud emas bo'lsa qisqa qayta urinish (pul olingan, yo'qolib qolmasin)
          if (isDbUnavailable(err) && attempt < 3) {
            await sleep(500 * attempt);
            continue;
          }
          throw err;
        }
      }
      if (!result.credited) return;

      try {
        await ctx.reply(t(ctx.dbUser.language, 'wallet_topup_ok', { amount: fmtUzs(result.amountUzs), balance: fmtUzs(result.balance) }), {
          parse_mode: 'HTML',
        });
      } catch (err) {
        logger.warn({ err: err.description || err.message, paymentId: sp.invoice_payload }, 'To\'ldirish xabarini yuborib bo\'lmadi');
      }
    } catch (err) {
      // Bot yiqilmasin: pul olingan, hodisa ma'lumotlari logda (qo'lda tekshirish uchun)
      logger.error(
        {
          err,
          paymentId: sp.invoice_payload,
          chargeId: sp.telegram_payment_charge_id,
          telegramId: String(ctx.from && ctx.from.id),
          total: sp.total_amount,
          currency: sp.currency,
        },
        'successful_payment hisobga olinmadi (pul olingan, qo\'lda tekshiring)',
      );
    }
  });
}

module.exports = registerPayments;