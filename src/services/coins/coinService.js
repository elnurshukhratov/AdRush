'use strict';

const { randomUUID } = require('crypto');
const { prisma } = require('../../db/prisma');
const config = require('../../config');
const auditService = require('../audit/auditService');
const { isUniqueViolation } = require('../../utils/dbErrors');

/** Ledger harakati turlari (prisma enum CoinTxType ning ilova ishlatadigan qismi). */
const COIN_TX = Object.freeze({
  ADS_REWARD: 'ADS_REWARD',
  REFERRAL_REWARD: 'REFERRAL_REWARD',
  SUBSCRIBE_REWARD: 'SUBSCRIBE_REWARD',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  CONVERT_OUT: 'CONVERT_OUT',
  CONVERT_IN: 'CONVERT_IN',
  SHOP_PURCHASE: 'SHOP_PURCHASE',
  SHOP_REFUND: 'SHOP_REFUND',
  WALLET_TOPUP: 'WALLET_TOPUP', // +so'm (Telegram to'lovi)
  COIN_BUY_OUT: 'COIN_BUY_OUT', // -so'm (Rush Coin sotib olish)
  COIN_BUY_IN: 'COIN_BUY_IN', // +Rush Coin (sotib olingan)
  ADMIN_GRANT: 'ADMIN_GRANT', // +Rush Coin (admin paneldan qo'lda yuborilgan)
  CHESS_WIN: 'CHESS_WIN', // +olmos (shahmat g'alabasi)
  CHESS_LOSS: 'CHESS_LOSS', // -olmos (shahmat mag'lubiyati)
});

/** Ledger valyutalari (prisma enum CoinCurrency) va ularga mos User ustuni. UZS — butun so'm. */
const CURRENCY = Object.freeze({ RUSH: 'RUSH', DIAMOND: 'DIAMOND', UZS: 'UZS' });
const CURRENCY_FIELD = Object.freeze({ RUSH: 'rushCoins', DIAMOND: 'diamonds', UZS: 'balanceUzs' });

const TX_OPTS = Object.freeze({ maxWait: 5000, timeout: 10000 });

/** Tranzaksiyani rollback qilib, aniq natija qaytarish uchun. */
class TxAbort extends Error {
  constructor(result) {
    super(result.reason);
    this.result = result;
  }
}

function fail(reason, extra = {}) {
  return { success: false, reason, ...extra };
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Tranzaksiya (tx) ICHIDA user balansini o'zgartiradi va ledger (CoinTransaction) yozadi.
 *  - currency: 'RUSH' (default, User.rushCoins), 'DIAMOND' (User.diamonds) yoki 'UZS' (User.balanceUzs).
 *  - amount > 0: kirim, amount < 0: chiqim. Chiqimda balans yetmasa { ok:false, reason:'INSUFFICIENT_FUNDS' } (hech narsa yozilmaydi).
 *  - Balans atomik UPDATE ... SET <balans> = <balans> + N orqali o'zgaradi (read-modify-write emas);
 *    chiqimda `<balans> >= N` sharti shu UPDATE ning o'zida, shuning uchun parallel so'rovlar balansni manfiy qila olmaydi.
 *  - idempotencyKey UNIQUE: bir hodisa ikkinchi marta yozilsa Prisma P2002 tashlaydi — chaqiruvchi tranzaksiyasi rollback bo'ladi.
 * Chaqiruvchi tranzaksiyani o'zi boshqaradi: ok:false qaytsa ham o'zi qaror qiladi (rollback uchun throw yoki return).
 */
async function applyCoins(tx, { userId, amount, type, idempotencyKey, refType = null, refId = null, currency = CURRENCY.RUSH }) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error('applyCoins: amount nolga teng bo\'lmagan butun son bo\'lishi kerak');
  if (!COIN_TX[type]) throw new Error(`applyCoins: noma'lum tur: ${type}`);
  const field = CURRENCY_FIELD[currency];
  if (!field) throw new Error(`applyCoins: noma'lum valyuta: ${currency}`);
  if (!idempotencyKey) throw new Error('applyCoins: idempotencyKey majburiy');

  const where = amount < 0 ? { id: userId, [field]: { gte: -amount } } : { id: userId };
  const res = await tx.user.updateMany({ where, data: { [field]: { increment: amount } } });
  if (res.count !== 1) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };

  await tx.coinTransaction.create({
    data: { userId, amount, currency, type, idempotencyKey, refType, refId: refId == null ? null : String(refId) },
  });

  const row = await tx.user.findUnique({ where: { id: userId }, select: { [field]: true } });
  return { ok: true, balance: row[field], currency };
}

async function getBalance(userId, client = prisma) {
  const row = await client.user.findUnique({ where: { id: userId }, select: { rushCoins: true } });
  return row ? row.rushCoins : 0;
}

/** Barcha balanslar: { rushCoins, diamonds, balanceUzs }. */
async function getBalances(userId, client = prisma) {
  const row = await client.user.findUnique({ where: { id: userId }, select: { rushCoins: true, diamonds: true, balanceUzs: true } });
  return { rushCoins: row ? row.rushCoins : 0, diamonds: row ? row.diamonds : 0, balanceUzs: row ? row.balanceUzs : 0 };
}

/**
 * Foydalanuvchining tarixi (Rush Coin, olmos va so'm, yangisi birinchi). cursor = oxirgi ko'rilgan id.
 * Faqat ilova ishlatadigan turlar (COIN_TX) qaytadi; eski yozuvlar bazada qoladi, lekin ko'rsatilmaydi.
 */
async function getHistory(userId, { limit = 20, cursor = null } = {}) {
  const rows = await prisma.coinTransaction.findMany({
    where: { userId, type: { in: Object.values(COIN_TX) }, ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    select: { id: true, amount: true, currency: true, type: true, createdAt: true },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((r) => ({
      id: r.id.toString(),
      amount: r.amount,
      currency: r.currency,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
  };
}

/**
 * Foydalanuvchidan foydalanuvchiga Rush Coin o'tkazmasi (komissiyasiz). Faqat BO'SH balans yuboriladi
 * (tikilgan coinlar balansdan allaqachon yechilgan). `toTelegramId` va `amount` faqat klientdan; balans va limitlar DB'dan.
 * Bitta tranzaksiyada:
 *   ikkala user qatori FOR UPDATE (DOIM id o'sish tartibida — deadlock bo'lmaydi) -> qabul qiluvchi bloklanganmi ->
 *   balans -> kunlik limit -> yuboruvchiga TRANSFER_OUT (-) va qabul qiluvchiga TRANSFER_IN (+) ledger yozuvlari -> audit.
 * Ikkala ledger yozuvi refType='TRANSFER' va bir xil refId (shu o'tkazma UUID'si) bilan bog'langan.
 * requestKey (klient UUID'si) idempotentlik uchun: bir xil so'rov ikkinchi marta o'tkazma yaratmaydi (DUPLICATE_REQUEST).
 * Qaytadi: { success:true, rushCoins, amount, to:{ firstName, username } } yoki { success:false, reason, ...extra }.
 *  reason: USER_NOT_FOUND | SELF_TRANSFER | RECEIVER_BLOCKED | INSUFFICIENT_FUNDS | TRANSFER_LIMIT | DUPLICATE_REQUEST
 */
async function transferCoins(fromUserId, toTelegramId, amount, requestKey) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('transferCoins: amount musbat butun son bo\'lishi kerak');
  if (!requestKey) throw new Error('transferCoins: requestKey majburiy');

  // Qabul qiluvchining ichki id'sini topamiz (qulfsiz); haqiqiy tekshiruvlar qulfdan KEYIN, tranzaksiya ichida qaytariladi
  const found = await prisma.user.findUnique({ where: { telegramId: BigInt(toTelegramId) }, select: { id: true } });
  if (!found) return fail('USER_NOT_FOUND');
  if (found.id === fromUserId) return fail('SELF_TRANSFER');
  const toUserId = found.id;

  try {
    return await prisma.$transaction(async (tx) => {
      // Qatorlarni har doim bir xil tartibda (id o'sish) qulflaymiz
      const [firstId, secondId] = fromUserId < toUserId ? [fromUserId, toUserId] : [toUserId, fromUserId];
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${firstId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${secondId} FOR UPDATE`;

      const rows = await tx.user.findMany({
        where: { id: { in: [fromUserId, toUserId] } },
        select: { id: true, telegramId: true, username: true, firstName: true, isBlocked: true, rushCoins: true },
      });
      const sender = rows.find((u) => u.id === fromUserId);
      const receiver = rows.find((u) => u.id === toUserId);
      if (!sender || !receiver) throw new TxAbort(fail('USER_NOT_FOUND'));
      if (receiver.isBlocked) throw new TxAbort(fail('RECEIVER_BLOCKED'));
      if (sender.rushCoins < amount) throw new TxAbort(fail('INSUFFICIENT_FUNDS', { rushCoins: sender.rushCoins }));

      const dailyLimit = config.rush.transferDailyLimit;
      if (dailyLimit > 0) {
        const agg = await tx.coinTransaction.aggregate({
          where: { userId: fromUserId, type: COIN_TX.TRANSFER_OUT, createdAt: { gte: startOfUtcDay(new Date()) } },
          _sum: { amount: true },
        });
        const sentToday = -(agg._sum.amount || 0); // TRANSFER_OUT manfiy saqlanadi
        if (sentToday + amount > dailyLimit) {
          throw new TxAbort(fail('TRANSFER_LIMIT', { dailyLimit, remaining: Math.max(0, dailyLimit - sentToday) }));
        }
      }

      const transferId = randomUUID();
      const debit = await applyCoins(tx, {
        userId: fromUserId,
        amount: -amount,
        type: COIN_TX.TRANSFER_OUT,
        idempotencyKey: `TRANSFER_OUT:${fromUserId}:${requestKey}`,
        refType: 'TRANSFER',
        refId: transferId,
      });
      if (!debit.ok) throw new TxAbort(fail('INSUFFICIENT_FUNDS', { rushCoins: sender.rushCoins }));

      const credit = await applyCoins(tx, {
        userId: toUserId,
        amount,
        type: COIN_TX.TRANSFER_IN,
        idempotencyKey: `TRANSFER_IN:${fromUserId}:${requestKey}`,
        refType: 'TRANSFER',
        refId: transferId,
      });
      if (!credit.ok) throw new Error('transferCoins: qabul qiluvchiga kirim yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback

      await auditService.record(
        'COIN_TRANSFER',
        {
          actorTelegramId: sender.telegramId,
          entityType: 'CoinTransfer',
          entityId: transferId,
          details: { fromUserId, toUserId, toTelegramId: receiver.telegramId, amount },
        },
        tx,
      );

      return {
        success: true,
        rushCoins: debit.balance,
        amount,
        to: { firstName: receiver.firstName, username: receiver.username },
      };
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    // Bir xil requestId ikkinchi marta: idempotencyKey UNIQUE to'qnashuvi (birinchi o'tkazma o'z holicha qoladi)
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return fail('DUPLICATE_REQUEST', { rushCoins: await getBalance(fromUserId) });
    }
    throw err;
  }
}

module.exports = { COIN_TX, CURRENCY, TX_OPTS, TxAbort, fail, applyCoins, getBalance, getBalances, getHistory, transferCoins };