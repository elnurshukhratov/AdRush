'use strict';

const { randomInt } = require('crypto');
const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { TX_OPTS, TxAbort, fail } = require('../coins/coinService');
const engine = require('./chessEngine');

/**
 * Onlayn navbat va juftlashtirish (polling asosida, yangi infratuzilmasiz).
 *  - Har bir amal tranzaksiyada: avval o'z advisory-qulfi (lockUser), keyin o'z navbat qatori FOR UPDATE.
 *  - Raqib `FOR UPDATE ... SKIP LOCKED` bilan tanlanadi va uning advisory-qulfi pg_try_advisory_xact_lock bilan olinadi
 *    (kutmaymiz — ikki tomon bir vaqtda bir-birini juftlamoqchi bo'lsa deadlock bo'lmaydi, keyingi pollingda juftlashadi).
 *    Shu tufayli bir foydalanuvchi ikki o'yinga tushmaydi (bot o'yini / boshqa juftlik ham o'sha qulfni oladi) va o'zi bilan juftlashmaydi.
 *  - Vaqt solishtirish DB soatida (UTC); CHESS_QUEUE_STALE_SECONDS dan ko'p "ko'rinmagan" yozuvlar e'tiborga olinmaydi va o'chiriladi.
 * Natija: { success:true, status:'searching', waitedSec } | { status:'matched', gameId } | { status:'idle' }.
 */

const MAX_CANDIDATES = 5;

function staleSec() {
  return config.chess.queueStaleSeconds;
}

/** Eskirgan navbat yozuvlarini o'chiradi (exceptUserId — joriy foydalanuvchining o'z yozuvi tegilmaydi). */
async function cleanupStale(tx, exceptUserId = 0) {
  const sec = staleSec();
  return tx.$executeRaw`
    DELETE FROM "ChessQueue"
    WHERE "userId" <> ${exceptUserId}
      AND "lastSeenAt" < (NOW() AT TIME ZONE 'UTC') - make_interval(secs => ${sec}::int)`;
}

function findActiveGame(tx, userId) {
  return tx.chessGame.findFirst({
    where: { status: 'ACTIVE', OR: [{ whiteUserId: userId }, { blackUserId: userId }] },
    select: { id: true, mode: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Raqib topilsa o'yin yaratadi (ranglar tasodifiy, soat serverda), aks holda null. Chaqiruvchi o'z qulflarini olgan bo'lishi shart. */
async function tryMatch(tx, user, now) {
  const sec = staleSec();
  const candidates = await tx.$queryRaw`
    SELECT q."userId" AS "userId", u."telegramId" AS "telegramId"
    FROM "ChessQueue" q
    JOIN "User" u ON u."id" = q."userId"
    WHERE q."userId" <> ${user.id}
      AND u."isBlocked" = false
      AND q."lastSeenAt" >= (NOW() AT TIME ZONE 'UTC') - make_interval(secs => ${sec}::int)
    ORDER BY q."joinedAt" ASC
    LIMIT ${MAX_CANDIDATES}
    FOR UPDATE OF q SKIP LOCKED`;

  for (const c of candidates) {
    const lock = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${c.telegramId}::bigint) AS "ok"`;
    if (!lock[0] || !lock[0].ok) continue; // raqib hozir boshqa amal bajarmoqda — keyingisi / keyingi polling

    const busy = await findActiveGame(tx, c.userId);
    if (busy) {
      await tx.chessQueue.deleteMany({ where: { userId: c.userId } }); // eskirgan yozuv: raqibning faol o'yini bor
      continue;
    }

    await tx.chessQueue.deleteMany({ where: { userId: { in: [user.id, c.userId] } } });
    const meWhite = randomInt(2) === 0;
    const ms = config.chess.onlineTimeSeconds * 1000;
    return tx.chessGame.create({
      data: {
        mode: 'ONLINE',
        whiteUserId: meWhite ? user.id : c.userId,
        blackUserId: meWhite ? c.userId : user.id,
        fen: engine.START_FEN,
        moves: [],
        moveCount: 0,
        lastMoveAt: now,
        whiteTimeMs: ms,
        blackTimeMs: ms,
        incrementMs: config.chess.onlineIncrementSeconds * 1000,
      },
    });
  }
  return null;
}

/** join va status uchun umumiy qadam (foydalanuvchi qulfi olingan, o'z qatori mavjud). */
async function searchStep(tx, user, now) {
  await cleanupStale(tx, user.id);
  const own = await tx.$queryRaw`SELECT "id" FROM "ChessQueue" WHERE "userId" = ${user.id} FOR UPDATE`;
  if (!own.length) {
    // qatorimiz yo'q: raqib bizni allaqachon juftlagan bo'lishi mumkin
    const game = await findActiveGame(tx, user.id);
    return game && game.mode === 'ONLINE' ? { success: true, status: 'matched', gameId: game.id } : { success: true, status: 'idle' };
  }
  const game = await tryMatch(tx, user, now);
  if (game) return { success: true, status: 'matched', gameId: game.id };
  const row = await tx.chessQueue.findUnique({ where: { userId: user.id } });
  return { success: true, status: 'searching', waitedSec: Math.max(0, Math.floor((now - row.joinedAt) / 1000)) };
}

async function run(fn) {
  try {
    return await prisma.$transaction(fn, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    throw err;
  }
}

/** POST /online/queue — navbatga qo'shilish (idempotent). Faol bot o'yini bo'lsa ALREADY_ACTIVE { gameId }. */
function joinQueue(user) {
  return run(async (tx) => {
    await lockUser(tx, user.telegramId);
    const active = await findActiveGame(tx, user.id);
    if (active && active.mode === 'ONLINE') return { success: true, status: 'matched', gameId: active.id };
    if (active) throw new TxAbort(fail('ALREADY_ACTIVE', { gameId: active.id }));

    const now = new Date();
    await tx.chessQueue.upsert({
      where: { userId: user.id },
      create: { userId: user.id, joinedAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    return searchStep(tx, user, now);
  });
}

/** GET /online/queue — holat (har so'rov lastSeenAt ni yangilaydi va juftlashtirishga qayta urinadi). */
function getQueueStatus(user) {
  return run(async (tx) => {
    await lockUser(tx, user.telegramId);
    const active = await findActiveGame(tx, user.id);
    if (active && active.mode === 'ONLINE') return { success: true, status: 'matched', gameId: active.id };
    if (active) return { success: true, status: 'idle' }; // bot o'yini — navbatda emas

    const now = new Date();
    const upd = await tx.chessQueue.updateMany({ where: { userId: user.id }, data: { lastSeenAt: now } });
    if (upd.count === 0) return { success: true, status: 'idle' };
    return searchStep(tx, user, now);
  });
}

/** DELETE /online/queue — bekor qilish. Raqib bizni shu orada juftlab ulgurgan bo'lsa — matched qaytadi (o'yin boshlangan). */
function leaveQueue(user) {
  return run(async (tx) => {
    await lockUser(tx, user.telegramId);
    await tx.chessQueue.deleteMany({ where: { userId: user.id } });
    const active = await findActiveGame(tx, user.id);
    if (active && active.mode === 'ONLINE') return { success: true, status: 'matched', gameId: active.id };
    return { success: true, status: 'idle' };
  });
}

/** Maintenance: eskirgan navbat yozuvlarini tozalash. */
async function cleanupStaleQueue() {
  return prisma.$executeRaw`
    DELETE FROM "ChessQueue"
    WHERE "lastSeenAt" < (NOW() AT TIME ZONE 'UTC') - make_interval(secs => ${staleSec()}::int)`;
}

module.exports = { joinQueue, getQueueStatus, leaveQueue, cleanupStaleQueue };