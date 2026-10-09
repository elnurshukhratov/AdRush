'use strict';

const { prisma } = require('../../db/prisma');

/** Hozir ACTIVE barcha chempionatlar (bir vaqtda bir nechta bo'lishi mumkin): avval tugaydigani birinchi. */
async function listActive(client = prisma) {
  return client.monthlyCompetition.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ endAt: 'asc' }, { id: 'asc' }] });
}

/** Eski chaqiruvchilar uchun: eng yaqin tugaydigan ACTIVE chempionat (yo'q bo'lsa null). */
async function getActive(client = prisma) {
  return client.monthlyCompetition.findFirst({ where: { status: 'ACTIVE' }, orderBy: [{ endAt: 'asc' }, { id: 'asc' }] });
}

/** Aynan shu id dagi chempionat ACTIVE bo'lsa qaytaradi, aks holda null. */
async function getActiveById(id, client = prisma) {
  return client.monthlyCompetition.findFirst({ where: { id, status: 'ACTIVE' } });
}

/** year/month — startAt (UTC) dan hosil qilinadi (eski ustunlar bilan moslik). */
function periodOf(startAt) {
  return { year: startAt.getUTCFullYear(), month: startAt.getUTCMonth() + 1 };
}

/** API uchun faqat public maydonlar. */
function toPublic(c) {
  return {
    id: c.id,
    title: c.title,
    description: c.description || null,
    year: c.year,
    month: c.month,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
    status: c.status,
  };
}

/** Reytingga kirgan (validAds > 0) bloklanmagan ishtirokchilar soni. */
async function countParticipants(competitionId) {
  return prisma.monthlyStat.count({
    where: { competitionId, validAds: { gt: 0 }, user: { isBlocked: false } },
  });
}

module.exports = { getActive, listActive, getActiveById, periodOf, toPublic, countParticipants };