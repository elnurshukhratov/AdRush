'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { isUniqueViolation } = require('../../utils/dbErrors');
const { COIN_TX, CURRENCY, TX_OPTS, TxAbort, fail, applyCoins, getBalances } = require('./coinService');

/**
 * Olmosni Rush Coin ga almashtirish: config.diamond.convert kursi bo'yicha (standart 12 olmos = 4 Rush Coin, qadam: 3 olmos = 1 Rush).
 * Klientdan faqat `diamonds` (nechta olmos) va `requestId` keladi; Rush miqdori serverda hisoblanadi.
 * Bitta tranzaksiyada: user qulfi -> olmos -N (CONVERT_OUT) -> Rush +N/qadam*qadamRush (CONVERT_IN). Ikkala ledger yozuvi
 * refType='CONVERT' va bir xil refId (requestId) bilan bog'langan. Idempotent: bir xil requestId ikkinchi marta DUPLICATE_REQUEST.
 * Qaytadi: { success:true, diamonds, rushCoins, converted:{ diamonds, rush } } yoki { success:false, reason, diamonds, rushCoins }.
 *  reason: INSUFFICIENT_FUNDS | DUPLICATE_REQUEST
 */
async function convertDiamonds(user, diamonds, requestId) {
  if (!Number.isSafeInteger(diamonds) || diamonds <= 0) throw new Error('convertDiamonds: diamonds musbat butun son bo\'lishi kerak');
  if (!requestId) throw new Error('convertDiamonds: requestId majburiy');

  const { stepDiamonds, stepRush } = config.diamond.convert;
  if (diamonds % stepDiamonds !== 0) throw new Error(`convertDiamonds: olmos ${stepDiamonds} ning karraligida bo'lishi kerak`);
  const rush = (diamonds / stepDiamonds) * stepRush;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);

      const debit = await applyCoins(tx, {
        userId: user.id,
        amount: -diamonds,
        currency: CURRENCY.DIAMOND,
        type: COIN_TX.CONVERT_OUT,
        idempotencyKey: `CONVERT_OUT:${user.id}:${requestId}`,
        refType: 'CONVERT',
        refId: requestId,
      });
      if (!debit.ok) throw new TxAbort(fail('INSUFFICIENT_FUNDS'));

      const credit = await applyCoins(tx, {
        userId: user.id,
        amount: rush,
        currency: CURRENCY.RUSH,
        type: COIN_TX.CONVERT_IN,
        idempotencyKey: `CONVERT_IN:${user.id}:${requestId}`,
        refType: 'CONVERT',
        refId: requestId,
      });
      if (!credit.ok) throw new Error('convertDiamonds: Rush kirimi yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback

      return {
        success: true,
        diamonds: debit.balance,
        rushCoins: credit.balance,
        converted: { diamonds, rush },
      };
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return { ...err.result, ...(await getBalances(user.id)) };
    // Bir xil requestId ikkinchi marta: idempotencyKey UNIQUE to'qnashuvi (birinchi almashtirish o'z holicha qoladi)
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return { ...fail('DUPLICATE_REQUEST'), ...(await getBalances(user.id)) };
    }
    throw err;
  }
}

module.exports = { convertDiamonds };