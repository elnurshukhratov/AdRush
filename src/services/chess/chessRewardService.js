'use strict';

const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { applyCoins, CURRENCY, COIN_TX } = require('../coins/coinService');

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Tugagan o'yinning g'olibi: 'w' | 'b' | null (durang yoki natija yo'q). */
function winnerColor(game) {
  if (game.result === 'WHITE') return 'w';
  if (game.result === 'BLACK') return 'b';
  return null;
}

/** Yarim yurishlar (ply) soni bo'yicha tomonning o'z yurishlari: oq — yuqoriga, qora — pastga yaxlitlanadi. */
function userMoves(moveCount, color) {
  return color === 'w' ? Math.ceil(moveCount / 2) : Math.floor(moveCount / 2);
}

/**
 * O'yindagi haqiqiy foydalanuvchilarning user qatorlarini (advisory lock) BIR XIL TARTIBDA (telegramId o'sish) qulflaydi —
 * ikki tomon bir vaqtda tugatilganda deadlock bo'lmasligi uchun. O'yin yozuvlarini o'zgartiradigan har bir servis
 * (yurish, taslim, vaqt tugashi, maintenance) tranzaksiya boshida shuni chaqirishi kerak; settleGame ham chaqiradi (qayta qulf zararsiz).
 */
async function lockPlayers(tx, game) {
  const ids = [game.whiteUserId, game.blackUserId].filter((x) => x != null);
  if (!ids.length) return [];
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, telegramId: true } });
  users.sort((a, b) => (a.telegramId < b.telegramId ? -1 : a.telegramId > b.telegramId ? 1 : 0));
  for (const u of users) await lockUser(tx, u.telegramId);
  return users;
}

/**
 * Olmosni o'zgartiradi (faqat applyCoins orqali, DIAMOND). Mag'lubiyatda balans yetmasa yetganicha ayiriladi (0 bo'lsa hech nima).
 * Qaytadi: haqiqatda o'zgargan miqdor (musbat — berildi, manfiy — ayirildi, 0 — o'zgarmadi).
 */
async function applyChessDelta(tx, game, userId, wanted) {
  if (!wanted) return 0;
  const key = `chess:${game.id}:${userId}`;
  const base = { userId, idempotencyKey: key, refType: 'CHESS', refId: game.id, currency: CURRENCY.DIAMOND };

  if (wanted > 0) {
    const r = await applyCoins(tx, { ...base, amount: wanted, type: COIN_TX.CHESS_WIN });
    if (!r.ok) throw new Error('chess: yutuq olmosi yozilmadi'); // kirimda bo'lmasligi kerak — rollback
    return wanted;
  }

  // Chiqim: balans 0 dan pastga tushmasin. Parallel sarf (boshqa oqim) bo'lsa — qayta o'qib, bir marta qayta urinamiz.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { diamonds: true } });
    const take = Math.min(-wanted, row ? row.diamonds : 0);
    if (take <= 0) return 0;
    const r = await applyCoins(tx, { ...base, amount: -take, type: COIN_TX.CHESS_LOSS });
    if (r.ok) return -take;
  }
  return 0;
}

/**
 * Tugagan o'yinni BIR MARTA hisob-kitob qiladi (tranzaksiya tx ICHIDA, chaqiruvchi tranzaksiyasi bilan birga commit bo'ladi).
 * Chaqiruvchi o'yinni FINISHED qilib, result va endReason ni yozgan bo'lishi kerak (ichkarida qayta o'qiladi).
 * Idempotent: settledAt allaqachon yozilgan bo'lsa hech narsa o'zgarmaydi va avvalgi natija qaytadi.
 *
 * Qoidalar:
 *  - Bot o'yini: yutuq +CHESS_WIN_DIAMONDS — faqat foydalanuvchi >= CHESS_MIN_USER_MOVES yurish qilgan va kunlik (UTC) bot limiti
 *    to'lmagan bo'lsa; aks holda 0. Mag'lubiyat (mat, taslim, harakatsizlik) har doim -CHESS_LOSS_DIAMONDS (yetganicha). Durang 0.
 *  - Onlayn: ikkala tomon ham yetarli yurish qilmagan bo'lsa — hech kimga berilmaydi, hech kimdan ayirilmaydi. Juftlik 24 soatlik limiti
 *    to'lgan bo'lsa ham shunday. Aks holda g'olibga +, yutqazganga - (g'olib yetarli yurish qilmagan bo'lsa g'olibga berilmaydi).
 *
 * Qaytadi: { settled, whiteDelta, blackDelta, rewardGranted, limit } — limit: null | 'MIN_MOVES' | 'BOT_DAILY_LIMIT' | 'PAIR_LIMIT'
 * (limit faqat shu chaqiruvda hisoblanadi; qayta chaqirilganda null).
 */
async function settleGame(tx, game) {
  await lockPlayers(tx, game);
  await tx.$queryRaw`SELECT "id" FROM "ChessGame" WHERE "id" = ${game.id}::uuid FOR UPDATE`;

  const g = await tx.chessGame.findUnique({ where: { id: game.id } });
  if (!g) throw new Error('settleGame: o\'yin topilmadi');
  if (g.settledAt) {
    return { settled: false, whiteDelta: g.whiteDelta, blackDelta: g.blackDelta, rewardGranted: g.rewardGranted, limit: null };
  }
  if (g.status !== 'FINISHED' || !g.result) throw new Error('settleGame: o\'yin hali tugamagan');

  const cfg = config.chess;
  const now = new Date();
  const winner = winnerColor(g);
  const wMoves = userMoves(g.moveCount, 'w');
  const bMoves = userMoves(g.moveCount, 'b');
  let whiteDelta = 0;
  let blackDelta = 0;
  let rewardGranted = false;
  let limit = null;

  if (g.mode === 'BOT') {
    const userColor = g.whiteUserId != null ? 'w' : 'b';
    const userId = userColor === 'w' ? g.whiteUserId : g.blackUserId;
    const myMoves = userColor === 'w' ? wMoves : bMoves;
    let delta = 0;

    if (winner === userColor) {
      if (myMoves < cfg.minUserMoves) {
        limit = 'MIN_MOVES';
      } else {
        let capped = false;
        if (cfg.botDailyWinLimit > 0) {
          const wins = await tx.chessGame.count({
            where: {
              mode: 'BOT',
              rewardGranted: true,
              settledAt: { gte: startOfUtcDay(now) },
              OR: [{ whiteUserId: userId }, { blackUserId: userId }],
            },
          });
          capped = wins >= cfg.botDailyWinLimit;
        }
        if (capped) limit = 'BOT_DAILY_LIMIT';
        else delta = await applyChessDelta(tx, g, userId, cfg.winDiamonds);
      }
      rewardGranted = delta > 0;
    } else if (winner !== null) {
      delta = await applyChessDelta(tx, g, userId, -cfg.lossDiamonds); // bot o'yinida yutqazish har doim ayiriladi
    }
    if (userColor === 'w') whiteDelta = delta;
    else blackDelta = delta;
  } else {
    // ONLINE: faqat g'olib/yutqazgan bor o'yin hisoblanadi (durang — 0)
    if (winner !== null) {
      const bothShort = wMoves < cfg.minUserMoves && bMoves < cfg.minUserMoves;
      let pairCapped = false;
      if (!bothShort && cfg.pairDailyLimit > 0) {
        const n = await tx.chessGame.count({
          where: {
            mode: 'ONLINE',
            rewardGranted: true,
            id: { not: g.id },
            settledAt: { gte: new Date(now.getTime() - DAY_MS) },
            OR: [
              { whiteUserId: g.whiteUserId, blackUserId: g.blackUserId },
              { whiteUserId: g.blackUserId, blackUserId: g.whiteUserId },
            ],
          },
        });
        pairCapped = n >= cfg.pairDailyLimit;
      }

      if (bothShort) limit = 'MIN_MOVES';
      else if (pairCapped) limit = 'PAIR_LIMIT';
      else {
        const winnerId = winner === 'w' ? g.whiteUserId : g.blackUserId;
        const loserId = winner === 'w' ? g.blackUserId : g.whiteUserId;
        const winnerMoves = winner === 'w' ? wMoves : bMoves;

        let winDelta = 0;
        if (winnerMoves >= cfg.minUserMoves) winDelta = await applyChessDelta(tx, g, winnerId, cfg.winDiamonds);
        else limit = 'MIN_MOVES';
        const lossDelta = await applyChessDelta(tx, g, loserId, -cfg.lossDiamonds);

        whiteDelta = winner === 'w' ? winDelta : lossDelta;
        blackDelta = winner === 'b' ? winDelta : lossDelta;
        rewardGranted = winDelta > 0;
      }
    }
  }

  await tx.chessGame.update({
    where: { id: g.id },
    data: { whiteDelta, blackDelta, rewardGranted, settledAt: now },
  });

  return { settled: true, whiteDelta, blackDelta, rewardGranted, limit };
}

module.exports = { settleGame, lockPlayers };