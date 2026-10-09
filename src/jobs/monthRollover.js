'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { prisma } = require('../db/prisma');
const { closeCompetition } = require('../services/competition/closeService');

/**
 * Auto-end job'i: endAt o'tgan ACTIVE competitionlarni tugatadi (rank + sovrin place bo'yicha Winner). Keyingisini admin yaratadi.
 * Bir nechta instansiya ishlasa ham xavfsiz: closeCompetition qator qulfi bilan idempotent.
 * notify(result) — oy avtomatik yopilganda adminlarga xabar yuborish uchun (ixtiyoriy).
 */
function startMonthRollover({ notify } = {}) {
  let current = null;

  async function run() {
    try {
      const now = new Date();
      const due = await prisma.monthlyCompetition.findMany({
        where: { status: 'ACTIVE', endAt: { lte: now } },
        orderBy: { endAt: 'asc' },
        select: { id: true },
      });

      for (const { id } of due) {
        const result = await closeCompetition(id, { auto: true });
        if (!result.ok) continue; // boshqa instansiya yopib bo'lgan
        logger.info(
          { competitionId: id, participants: result.participants, winners: result.winners.length },
          'Competition avtomatik tugatildi',
        );
        if (notify) {
          try {
            await notify(result);
          } catch (err) {
            logger.warn({ err }, 'Adminlarga competition tugagani haqida xabar yuborib bo\'lmadi');
          }
        }
      }

    } catch (err) {
      logger.error({ err }, 'Auto-end job xatosi');
    }
  }

  function tick() {
    if (current) return current; // oldingi ishlash tugamagan
    current = run().finally(() => {
      current = null;
    });
    return current;
  }

  const timer = setInterval(tick, config.rollover.intervalMs);
  timer.unref();
  tick();

  return {
    tick,
    async stop() {
      clearInterval(timer);
      if (current) await current;
    },
  };
}

module.exports = { startMonthRollover };
