'use strict';

const logger = require('../utils/logger');
const { prisma } = require('../db/prisma');
const chessGame = require('../services/chess/chessGameService');
const chessMatch = require('../services/chess/chessMatchService');

const INTERVAL_MS = 5 * 60 * 1000;
const CHESS_ONLINE_INTERVAL_MS = 15 * 1000; // onlayn o'yin soati va navbat — tez-tez tekshiriladi (hech kim so'ramasa ham o'yin vaqtida tugasin)

/**
 * Davriy tozalash (idempotent, bir nechta instansiyada ham xavfsiz):
 *  - muddati o'tgan PENDING/CLAIMED reklama sessiyalari EXPIRED bo'ladi (holat to'g'ri ko'rinsin, claim/confirm ularni qabul qilmaydi);
 *  - CHESS_BOT_IDLE_MINUTES dan ortiq harakatsiz bot o'yinlari foydalanuvchi yutqazgan (ABANDON) sifatida tugatiladi (-1 💎).
 *  - Onlayn shahmat (har 15 s, alohida taymer): vaqti tugagan o'yinlar TIMEOUT bilan yakunlanadi, eskirgan navbat yozuvlari tozalanadi.
 * Har bir qadam alohida try/catch'da — biri xato qilsa ikkinchisi to'xtamaydi.
 * Hech qanday ma'lumot o'chirilmaydi (AdReward, ledger, audit, shahmat tarixi saqlanadi).
 */
function startMaintenance() {
  let current = null;

  async function run() {
    try {
      const res = await prisma.adSession.updateMany({
        where: { status: { in: ['PENDING', 'CLAIMED'] }, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
      if (res.count > 0) logger.info({ expired: res.count }, 'Eskirgan reklama sessiyalari yopildi');
    } catch (err) {
      logger.error({ err }, 'Maintenance job xatosi');
    }

    try {
      const finished = await chessGame.finishIdleBotGames();
      if (finished > 0) logger.info({ finished }, 'Harakatsiz bot o\'yinlari tugatildi');
    } catch (err) {
      logger.error({ err }, 'Maintenance: shahmat o\'yinlarini tugatishda xato');
    }
  }

  let currentChess = null;

  async function runChessOnline() {
    try {
      const finished = await chessGame.finishTimedOutOnlineGames();
      if (finished > 0) logger.info({ finished }, 'Vaqti tugagan onlayn shahmat o\'yinlari tugatildi');
    } catch (err) {
      logger.error({ err }, 'Maintenance: onlayn shahmat vaqtini tekshirishda xato');
    }

    try {
      await chessMatch.cleanupStaleQueue();
    } catch (err) {
      logger.error({ err }, 'Maintenance: shahmat navbatini tozalashda xato');
    }
  }

  function tick() {
    if (current) return current;
    current = run().finally(() => {
      current = null;
    });
    return current;
  }

  function tickChess() {
    if (currentChess) return currentChess;
    currentChess = runChessOnline().finally(() => {
      currentChess = null;
    });
    return currentChess;
  }

  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  const chessTimer = setInterval(tickChess, CHESS_ONLINE_INTERVAL_MS);
  chessTimer.unref();

  return {
    tick,
    async stop() {
      clearInterval(timer);
      clearInterval(chessTimer);
      if (current) await current;
      if (currentChess) await currentChess;
    },
  };
}

module.exports = { startMaintenance };