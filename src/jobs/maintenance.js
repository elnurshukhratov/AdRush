'use strict';

const logger = require('../utils/logger');
const { prisma } = require('../db/prisma');

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Davriy tozalash (idempotent, bir nechta instansiyada ham xavfsiz):
 *  - muddati o'tgan PENDING/CLAIMED reklama sessiyalari EXPIRED bo'ladi (holat to'g'ri ko'rinsin, claim/confirm ularni qabul qilmaydi).
 * Hech qanday ma'lumot o'chirilmaydi (AdReward, MonthlyStat, Winner, audit tarixi saqlanadi).
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
  }

  function tick() {
    if (current) return current;
    current = run().finally(() => {
      current = null;
    });
    return current;
  }

  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();

  return {
    tick,
    async stop() {
      clearInterval(timer);
      if (current) await current;
    },
  };
}

module.exports = { startMaintenance };
