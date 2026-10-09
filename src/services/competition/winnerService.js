'use strict';

const { prisma } = require('../../db/prisma');
const { ApiError } = require('../../utils/apiError');
const { record } = require('../audit/auditService');
const { deleteImage } = require('../uploads/imageService');

// Ruxsat etilgan status o'tishlari
const TRANSITIONS = Object.freeze({
  PENDING: ['CONTACTED', 'CANCELLED'],
  CONTACTED: ['DELIVERED', 'CANCELLED', 'PENDING'],
  DELIVERED: [],
  CANCELLED: ['PENDING'],
});

function toAdminWinner(w, validAds) {
  return {
    id: w.id,
    competitionId: w.competitionId,
    place: w.place,
    prize: w.prize, // snapshot
    prizeValue: w.prizeRef ? w.prizeRef.value || null : null,
    prizeImageUrl: w.prizeRef ? w.prizeRef.imageUrl || null : null,
    status: w.status,
    note: w.note || null,
    proofImage: w.proofImage || null,
    proofUploadedAt: w.proofUploadedAt ? w.proofUploadedAt.toISOString() : null,
    validAds: validAds || 0,
    user: { telegramId: w.user.telegramId.toString(), username: w.user.username, firstName: w.user.firstName },
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

async function listForAdmin(competitionId) {
  const winners = await prisma.winner.findMany({
    where: { competitionId },
    orderBy: { place: 'asc' },
    include: {
      user: { select: { telegramId: true, username: true, firstName: true } },
      prizeRef: { select: { value: true, imageUrl: true } },
    },
  });
  const stats = winners.length
    ? await prisma.monthlyStat.findMany({
        where: { competitionId, userId: { in: winners.map((w) => w.userId) } },
        select: { userId: true, validAds: true },
      })
    : [];
  const ads = new Map(stats.map((s) => [s.userId, s.validAds]));
  return winners.map((w) => toAdminWinner(w, ads.get(w.userId)));
}

/** Status va/yoki izohni o'zgartiradi. Parallel bosilishlarga qarshi: faqat hali eski statusda bo'lsa yangilaydi. */
async function update(winnerId, { status, note }, actorTelegramId) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.winner.findUnique({ where: { id: winnerId } });
    if (!w) throw new ApiError(404, 'NOT_FOUND', 'G\'olib topilmadi');

    const data = {};
    if (status !== undefined && status !== w.status) {
      if (!TRANSITIONS[w.status].includes(status)) {
        throw new ApiError(409, 'BAD_TRANSITION', `${w.status} holatidan ${status} ga o'tib bo'lmaydi`);
      }
      data.status = status;
    }
    if (note !== undefined) data.note = note;
    if (Object.keys(data).length === 0) return { ok: true, unchanged: true, competitionId: w.competitionId };

    const res = await tx.winner.updateMany({ where: { id: w.id, status: w.status }, data });
    if (res.count !== 1) throw new ApiError(409, 'BAD_TRANSITION', 'Holat boshqa tomondan o\'zgartirilgan. Yangilab qayta urining.');

    await record(
      'WINNER_STATUS_CHANGED',
      {
        actorTelegramId,
        entityType: 'winner',
        entityId: w.id,
        details: { competitionId: w.competitionId, userId: w.userId, place: w.place, from: w.status, to: data.status || w.status, noteChanged: note !== undefined },
      },
      tx,
    );
    return { ok: true, competitionId: w.competitionId };
  });
}

/**
 * Admin: g'olibga sovrin topshirilganini tasdiqlovchi rasm biriktiradi yoki almashtiradi (rasm URL'i faqat bizning
 * /uploads/proofs/... yo'li). Eski rasm tranzaksiya muvaffaqiyatli tugagach o'chiriladi.
 */
async function setProof(winnerId, imageUrl, actorTelegramId) {
  let oldImage = null;
  let competitionId = null;
  try {
    await prisma.$transaction(async (tx) => {
      const w = await tx.winner.findUnique({ where: { id: winnerId } });
      if (!w) throw new ApiError(404, 'NOT_FOUND', 'G\'olib topilmadi');
      competitionId = w.competitionId;
      oldImage = w.proofImage || null;
      await tx.winner.update({ where: { id: w.id }, data: { proofImage: imageUrl, proofUploadedAt: new Date() } });
      await record(
        'WINNER_PROOF_UPLOADED',
        { actorTelegramId, entityType: 'winner', entityId: w.id, details: { competitionId, place: w.place, replaced: Boolean(oldImage) } },
        tx,
      );
    });
  } catch (err) {
    await deleteImage(imageUrl); // yangi yuklangan fayl yetim qolmasin
    throw err;
  }
  if (oldImage && oldImage !== imageUrl) await deleteImage(oldImage);
  return { ok: true, competitionId, proofImage: imageUrl };
}

/** Foydalanuvchilarga ko'rinadigan tarix: tugagan competitionlar va ularning g'oliblari (status/izoh chiqmaydi). */
async function publicHistory(limit = 5) {
  const comps = await prisma.monthlyCompetition.findMany({
    where: { status: { in: ['ENDED', 'ARCHIVED'] } },
    orderBy: [{ lockedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { id: true, title: true, year: true, month: true, startAt: true, endAt: true },
  });
  if (!comps.length) return [];
  const ids = comps.map((c) => c.id);

  const [winners, participants] = await Promise.all([
    prisma.winner.findMany({
      where: { competitionId: { in: ids }, status: { not: 'CANCELLED' } },
      orderBy: [{ competitionId: 'asc' }, { place: 'asc' }],
      select: {
        id: true, competitionId: true, userId: true, place: true, prize: true, status: true, proofImage: true,
        user: { select: { username: true, firstName: true } },
      },
    }),
    prisma.monthlyStat.groupBy({ by: ['competitionId'], where: { competitionId: { in: ids }, rank: { not: null } }, _count: { _all: true } }),
  ]);
  const stats = winners.length
    ? await prisma.monthlyStat.findMany({
        where: { competitionId: { in: ids }, userId: { in: winners.map((w) => w.userId) } },
        select: { competitionId: true, userId: true, validAds: true },
      })
    : [];
  const adsByKey = new Map(stats.map((s) => [`${s.competitionId}:${s.userId}`, s.validAds]));
  const countBy = new Map(participants.map((p) => [p.competitionId, p._count._all]));

  return comps.map((c) => ({
    id: c.id,
    title: c.title,
    year: c.year,
    month: c.month,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
    participants: countBy.get(c.id) || 0,
    winners: winners
      .filter((w) => w.competitionId === c.id)
      .map((w) => ({
        place: w.place,
        username: w.user.username,
        firstName: w.user.firstName,
        validAds: adsByKey.get(`${c.id}:${w.userId}`) || 0,
        prize: w.prize,
        delivered: w.status === 'DELIVERED',
        proofImage: w.proofImage || null, // null = "sovrin topshirilishi kutilmoqda"
      })),
  }));
}

module.exports = { TRANSITIONS, listForAdmin, update, setProof, publicHistory };
