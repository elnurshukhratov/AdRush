'use strict';

const { prisma } = require('../../db/prisma');

/**
 * Tartib qoidasi: validAds kamayish, tenglikda avval yetgan (updatedAt o'sish) yuqorida.
 * Hammasi DB tomonida hisoblanadi (composite index mavjud).
 */
async function getTop(competitionId, limit = 10) {
  const rows = await prisma.monthlyStat.findMany({
    where: { competitionId, validAds: { gt: 0 }, user: { isBlocked: false } },
    orderBy: [{ validAds: 'desc' }, { updatedAt: 'asc' }],
    take: limit,
    select: {
      validAds: true,
      user: { select: { telegramId: true, username: true, firstName: true } },
    },
  });

  return rows.map((r, i) => ({
    rank: i + 1,
    telegramId: r.user.telegramId.toString(),
    username: r.user.username,
    firstName: r.user.firstName,
    validAds: r.validAds,
  }));
}

/** Foydalanuvchining joriy statistikasi: validAds, rank, keyingi o'ringacha reklama soni. */
async function getUserStats(userId, competitionId) {
  const stat = await prisma.monthlyStat.findUnique({
    where: { userId_competitionId: { userId, competitionId } },
  });

  if (!stat || stat.validAds === 0) {
    return { validAds: 0, rank: null, nextRank: null, adsToNextRank: null };
  }

  const aheadWhere = {
    competitionId,
    user: { isBlocked: false },
    OR: [
      { validAds: { gt: stat.validAds } },
      { validAds: stat.validAds, updatedAt: { lt: stat.updatedAt } },
    ],
  };

  const [ahead, directlyAbove] = await Promise.all([
    prisma.monthlyStat.count({ where: aheadWhere }),
    prisma.monthlyStat.findFirst({
      where: aheadWhere,
      orderBy: [{ validAds: 'asc' }, { updatedAt: 'desc' }],
      select: { validAds: true },
    }),
  ]);

  const rank = ahead + 1;
  // Tenglikda avval yetgan yuqorida, shuning uchun o'zib o'tish uchun +1 kerak
  const adsToNextRank = directlyAbove ? directlyAbove.validAds - stat.validAds + 1 : null;

  return { validAds: stat.validAds, rank, nextRank: rank > 1 ? rank - 1 : null, adsToNextRank };
}

module.exports = { getTop, getUserStats };
