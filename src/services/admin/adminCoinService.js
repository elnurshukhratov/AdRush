'use strict';

const { randomUUID } = require('crypto');
const { prisma } = require('../../db/prisma');
const { ApiError } = require('../../utils/apiError');
const { lockUser } = require('../../utils/dbLock');
const { isUniqueViolation } = require('../../utils/dbErrors');
const { record } = require('../audit/auditService');
const { COIN_TX, CURRENCY, TX_OPTS, applyCoins } = require('../coins/coinService');

/**
 * Admin paneldagi "Tanga" bo'limi. "Tanga" = Rush Coin (User.rushCoins, ledger valyutasi RUSH).
 * Olmos (diamonds) va so'm (balanceUzs) balanslariga bu servis TEGMAYDI.
 *
 * Balans mavjud applyCoins() orqali o'zgaradi (atomik UPDATE + CoinTransaction ledger yozuvi), yangi balans tizimi yo'q.
 * Yuborish tarixi — AuditLog (ADMIN_COIN_GRANT): kimga, qancha, qachon va qaysi admin yuborgani; qabul qiluvchining
 * o'z Tarixida esa ledger yozuvi (ADMIN_GRANT) ko'rinadi.
 */

const GRANT_ACTION = 'ADMIN_COIN_GRANT';
const MAX_GRANT = 1_000_000; // bir marta yuboriladigan eng katta miqdor (xato kiritishdan himoya)
const INT_MAX = 2_147_483_647; // User.rushCoins — Postgres INTEGER

const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

const normUsername = (v) => String(v == null ? '' : v).trim().replace(/^@/, '').toLowerCase();

function toLookupUser(u, actorTelegramId) {
  return {
    telegramId: u.telegramId.toString(),
    username: u.username,
    firstName: u.firstName,
    isBlocked: u.isBlocked,
    rushCoins: u.rushCoins,
    isSelf: actorTelegramId != null && u.telegramId === BigInt(actorTelegramId),
  };
}

/**
 * Qidiruv so'rovini aniq turga ajratadi: faqat raqamlar = Telegram ID, aks holda username
 * (@name, t.me/name yoki name). Boshqa formatlar rad etiladi (ism bo'yicha qidirilmaydi — noto'g'ri odamga yuborish xavfi).
 */
function parseQuery(raw) {
  let q = String(raw || '').trim();
  q = q.replace(/^(https?:\/\/)?(www\.)?t\.me\//i, '');
  if (/^\d{1,15}$/.test(q)) return { kind: 'id', telegramId: BigInt(q) };
  const name = q.replace(/^@/, '');
  if (USERNAME_RE.test(name)) return { kind: 'username', username: name };
  throw new ApiError(400, 'INVALID_QUERY', 'Telegram ID (raqam) yoki @username kiriting');
}

/**
 * Qabul qiluvchini topadi (faqat o'qish). Username bo'yicha: aniq moslik (katta-kichik harf farqsiz); bir nechta
 * foydalanuvchida bir xil username saqlangan bo'lsa (username o'zgargan/qayta olingan) — AMBIGUOUS_USERNAME, Telegram ID so'raladi.
 */
async function lookupUser(rawQuery, actorTelegramId) {
  const parsed = parseQuery(rawQuery);
  let user;
  if (parsed.kind === 'id') {
    user = await prisma.user.findUnique({ where: { telegramId: parsed.telegramId } });
  } else {
    const rows = await prisma.user.findMany({
      where: { username: { equals: parsed.username, mode: 'insensitive' } },
      take: 2,
    });
    if (rows.length > 1) {
      throw new ApiError(409, 'AMBIGUOUS_USERNAME', 'Bu username bir nechta foydalanuvchida saqlangan. Telegram ID orqali qidiring');
    }
    user = rows[0] || null;
  }
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Foydalanuvchi topilmadi. U botga kamida bir marta /start bosgan bo\'lishi kerak');
  return toLookupUser(user, actorTelegramId);
}

/**
 * Tanga yuborish. Bitta tranzaksiyada:
 *   user advisory-lock (lockUser) -> User qatori FOR UPDATE -> tekshiruvlar -> applyCoins(+Rush, ADMIN_GRANT) -> audit.
 *  - Qabul qiluvchi ICHKI ID emas, o'zgarmas Telegram ID bilan aniqlanadi. `expectedUsername` — admin tasdiqlash paytida
 *    ko'rgan username; qulfdan keyin bazadagi username boshqacha bo'lsa USER_CHANGED (hech narsa yozilmaydi).
 *  - requestId (klient UUID'si) -> idempotencyKey `ADMIN_GRANT:<adminTelegramId>:<requestId>` (UNIQUE): qayta bosish/takroriy
 *    so'rov ikkinchi marta tanga qo'shmaydi (DUPLICATE_REQUEST).
 *  - Bloklangan foydalanuvchiga va o'zingizga yuborib bo'lmaydi; balans INTEGER chegarasidan oshmaydi.
 * Qaytadi: { grant: { id, amount, balanceBefore, balanceAfter, createdAt }, user }.
 */
async function grantCoins({ telegramId, amount, requestId, expectedUsername }, actor) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_GRANT) {
    throw new ApiError(400, 'INVALID_AMOUNT', `Miqdor 1 dan ${MAX_GRANT} gacha butun son bo'lishi kerak`);
  }
  const target = BigInt(telegramId);
  const actorId = BigInt(actor.telegramId);
  if (target === actorId) throw new ApiError(409, 'CANNOT_GRANT_SELF', 'O\'zingizga tanga yuborib bo\'lmaydi');

  // Ichki id qulfdan oldin topiladi; barcha haqiqiy tekshiruvlar qulfdan KEYIN, tranzaksiya ichida
  const found = await prisma.user.findUnique({ where: { telegramId: target }, select: { id: true } });
  if (!found) throw new ApiError(404, 'USER_NOT_FOUND', 'Foydalanuvchi topilmadi');

  try {
    const out = await prisma.$transaction(async (tx) => {
      await lockUser(tx, target);
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${found.id} FOR UPDATE`;

      const user = await tx.user.findUnique({ where: { id: found.id } });
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Foydalanuvchi topilmadi');
      if (user.isBlocked) throw new ApiError(409, 'USER_BLOCKED', 'Foydalanuvchi bloklangan — tanga yuborib bo\'lmaydi');
      if (normUsername(user.username) !== normUsername(expectedUsername)) {
        throw new ApiError(409, 'USER_CHANGED', 'Foydalanuvchi ma\'lumoti o\'zgargan. Yangi ma\'lumotni tekshirib, qayta tasdiqlang', {
          user: toLookupUser(user, actor.telegramId),
        });
      }
      if (user.rushCoins + amount > INT_MAX) {
        throw new ApiError(409, 'BALANCE_LIMIT', 'Foydalanuvchi balansi bu miqdorni sig\'dira olmaydi');
      }

      const grantId = randomUUID();
      const credit = await applyCoins(tx, {
        userId: user.id,
        amount,
        currency: CURRENCY.RUSH,
        type: COIN_TX.ADMIN_GRANT,
        idempotencyKey: `ADMIN_GRANT:${actorId}:${requestId}`,
        refType: 'ADMIN_GRANT',
        refId: grantId,
      });
      if (!credit.ok) throw new Error('grantCoins: kirim yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback

      const audit = await record(
        GRANT_ACTION,
        {
          actorTelegramId: actorId,
          entityType: 'CoinGrant',
          entityId: grantId,
          details: {
            adminRole: actor.adminRole || null,
            userId: user.id,
            toTelegramId: user.telegramId,
            toUsername: user.username,
            toFirstName: user.firstName,
            amount,
            currency: CURRENCY.RUSH,
            balanceBefore: user.rushCoins,
            balanceAfter: credit.balance,
            requestId,
          },
        },
        tx,
      );

      return {
        grant: { id: grantId, amount, balanceBefore: user.rushCoins, balanceAfter: credit.balance, createdAt: audit.createdAt.toISOString() },
        user: toLookupUser({ ...user, rushCoins: credit.balance }, actor.telegramId),
      };
    }, TX_OPTS);
    return out;
  } catch (err) {
    // Shu admin + requestId allaqachon bajarilgan -> ikkinchi marta tanga qo'shilmaydi
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      throw new ApiError(409, 'DUPLICATE_REQUEST', 'Bu yuborish allaqachon bajarilgan. Tarixni tekshiring');
    }
    throw err;
  }
}

/** Yuborish tarixi (yangidan eskiga), barcha adminlar. `before` — oldingi sahifaning oxirgi id si (cursor). */
async function listGrants({ limit = 20, before = null } = {}) {
  const rows = await prisma.auditLog.findMany({
    where: { action: GRANT_ACTION, ...(before ? { id: { lt: BigInt(before) } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => {
      const d = r.details || {};
      return {
        id: r.id.toString(),
        adminTelegramId: r.actorTelegramId == null ? null : r.actorTelegramId.toString(),
        toTelegramId: d.toTelegramId == null ? null : String(d.toTelegramId),
        toUsername: d.toUsername || null,
        toFirstName: d.toFirstName || null,
        amount: d.amount,
        balanceAfter: d.balanceAfter,
        createdAt: r.createdAt.toISOString(),
      };
    }),
    nextCursor: rows.length > limit ? page[page.length - 1].id.toString() : null,
  };
}

module.exports = { GRANT_ACTION, MAX_GRANT, lookupUser, grantCoins, listGrants };