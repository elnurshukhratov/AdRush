'use strict';

const { prisma } = require('../../db/prisma');
const { ApiError } = require('../../utils/apiError');
const { record } = require('../audit/auditService');
const { periodOf } = require('./competitionService');
const { closeCompetition } = require('./closeService');
const { deleteImage } = require('../uploads/imageService');

const MIN_DURATION_MS = 60 * 60 * 1000; // kamida 1 soat
const MAX_DURATION_MS = 400 * 24 * 3600 * 1000;

function toAdmin(c, extra = {}) {
  return {
    id: c.id,
    title: c.title,
    description: c.description || null,
    status: c.status,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
    endedAt: c.lockedAt ? c.lockedAt.toISOString() : null,
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    ...extra,
  };
}

function assertDates(startAt, endAt) {
  const span = endAt.getTime() - startAt.getTime();
  if (span < MIN_DURATION_MS) throw new ApiError(400, 'INVALID_DATES', 'Tugash vaqti boshlanishidan kamida 1 soat keyin bo\'lishi kerak');
  if (span > MAX_DURATION_MS) throw new ApiError(400, 'INVALID_DATES', 'Competition 400 kundan uzun bo\'lishi mumkin emas');
}

/** Competition qatorini FOR UPDATE bilan qulflaydi (reward FOR SHARE, yopish va tahrirlash bilan ketma-ketlik). */
async function lockRow(tx, id) {
  const rows = await tx.$queryRaw`
    SELECT "id", "title", "status"::text AS "status", "startAt", "endAt"
    FROM "MonthlyCompetition"
    WHERE "id" = ${id}
    FOR UPDATE`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Competition topilmadi');
  return rows[0];
}

async function statsFor(ids) {
  if (!ids.length) return new Map();
  const [stats, prizes, winners] = await Promise.all([
    prisma.monthlyStat.groupBy({
      by: ['competitionId'],
      where: { competitionId: { in: ids }, validAds: { gt: 0 } },
      _count: { _all: true },
      _sum: { validAds: true },
    }),
    prisma.prize.groupBy({ by: ['competitionId'], where: { competitionId: { in: ids } }, _count: { _all: true } }),
    prisma.winner.groupBy({ by: ['competitionId'], where: { competitionId: { in: ids } }, _count: { _all: true } }),
  ]);
  const map = new Map(ids.map((id) => [id, { participants: 0, validAds: 0, prizeCount: 0, winnerCount: 0 }]));
  for (const s of stats) Object.assign(map.get(s.competitionId), { participants: s._count._all, validAds: s._sum.validAds || 0 });
  for (const p of prizes) map.get(p.competitionId).prizeCount = p._count._all;
  for (const w of winners) map.get(w.competitionId).winnerCount = w._count._all;
  return map;
}

async function list() {
  const rows = await prisma.monthlyCompetition.findMany({ orderBy: [{ startAt: 'desc' }, { id: 'desc' }], take: 100 });
  const stats = await statsFor(rows.map((r) => r.id));
  return rows.map((r) => toAdmin(r, stats.get(r.id)));
}

async function get(id) {
  const c = await prisma.monthlyCompetition.findUnique({ where: { id } });
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Competition topilmadi');
  const stats = await statsFor([id]);
  return toAdmin(c, stats.get(id));
}

async function create(data, actorTelegramId) {
  assertDates(data.startAt, data.endAt);
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.monthlyCompetition.create({
      data: {
        title: data.title,
        description: data.description || null,
        startAt: data.startAt,
        endAt: data.endAt,
        status: 'DRAFT',
        ...periodOf(data.startAt),
      },
    });
    await record('COMPETITION_CREATED', { actorTelegramId, entityType: 'competition', entityId: c.id, details: { title: c.title } }, tx);
    return c;
  });
  return toAdmin(row);
}

async function update(id, data, actorTelegramId) {
  const row = await prisma.$transaction(async (tx) => {
    const cur = await lockRow(tx, id);
    const now = new Date();

    if (cur.status === 'ENDED' || cur.status === 'ARCHIVED') {
      throw new ApiError(409, 'COMPETITION_LOCKED', 'Tugagan competition tahrirlanmaydi');
    }

    const patch = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;

    let startAt = cur.startAt;
    let endAt = cur.endAt;
    if (data.startAt !== undefined && data.startAt.getTime() !== cur.startAt.getTime()) {
      if (cur.status === 'ACTIVE' && cur.startAt <= now) {
        throw new ApiError(409, 'FIELD_LOCKED', 'Boshlangan competition ning boshlanish vaqti o\'zgarmaydi');
      }
      startAt = data.startAt;
      patch.startAt = startAt;
      Object.assign(patch, periodOf(startAt));
    }
    if (data.endAt !== undefined) {
      endAt = data.endAt;
      patch.endAt = endAt;
    }
    if (patch.startAt || patch.endAt) {
      assertDates(startAt, endAt);
      if (cur.status === 'ACTIVE' && endAt <= now) {
        throw new ApiError(400, 'INVALID_DATES', 'Faol competition tugash vaqti kelajakda bo\'lishi kerak (erta tugatish uchun "Tugatish" dan foydalaning)');
      }
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'INVALID_REQUEST', 'O\'zgartirish yo\'q');

    const updated = await tx.monthlyCompetition.update({ where: { id }, data: patch });
    await record(
      'COMPETITION_UPDATED',
      { actorTelegramId, entityType: 'competition', entityId: id, details: { fields: Object.keys(patch), status: cur.status } },
      tx,
    );
    return updated;
  });
  return toAdmin(row);
}

async function activate(id, actorTelegramId) {
  try {
    const row = await prisma.$transaction(async (tx) => {
      const cur = await lockRow(tx, id);
      if (cur.status !== 'DRAFT') throw new ApiError(409, 'BAD_STATUS', 'Faqat DRAFT competition ni faollashtirish mumkin');

      // Bir vaqtda bir nechta faol chempionat ruxsat etiladi (har biri o'z sovrini/reytingi bilan mustaqil)
      if (cur.endAt <= new Date()) {
        throw new ApiError(409, 'INVALID_DATES', 'Tugash vaqti o\'tib ketgan. Avval sanalarni tahrirlang.');
      }

      const updated = await tx.monthlyCompetition.update({ where: { id }, data: { status: 'ACTIVE' } });
      await record('COMPETITION_ACTIVATED', { actorTelegramId, entityType: 'competition', entityId: id, details: { title: cur.title } }, tx);
      return updated;
    });
    return toAdmin(row);
  } catch (err) {
    throw err;
  }
}

/** Qo'lda tugatish: closeService (rank + g'oliblar + audit) ni ishlatadi. */
async function end(id, actorTelegramId) {
  const result = await closeCompetition(id, { actorTelegramId, auto: false });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') throw new ApiError(404, 'NOT_FOUND', 'Competition topilmadi');
    throw new ApiError(409, 'BAD_STATUS', 'Faqat faol competition ni tugatish mumkin');
  }
  return result;
}

async function archive(id, actorTelegramId) {
  const row = await prisma.$transaction(async (tx) => {
    const cur = await lockRow(tx, id);
    if (cur.status !== 'ENDED') throw new ApiError(409, 'BAD_STATUS', 'Faqat tugagan competition ni arxivlash mumkin');
    const updated = await tx.monthlyCompetition.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await record('COMPETITION_ARCHIVED', { actorTelegramId, entityType: 'competition', entityId: id, details: { title: cur.title } }, tx);
    return updated;
  });
  return toAdmin(row);
}

/** Faqat hech qanday faoliyati yo'q DRAFT o'chiriladi (tarix saqlanadi). */
async function remove(id, actorTelegramId) {
  const images = [];
  await prisma.$transaction(async (tx) => {
    const cur = await lockRow(tx, id);
    if (cur.status !== 'DRAFT') throw new ApiError(409, 'BAD_STATUS', 'Faqat DRAFT competition o\'chiriladi. Tugaganlarini arxivlang.');
    const [rewards, sessions] = await Promise.all([
      tx.adReward.count({ where: { competitionId: id } }),
      tx.adSession.count({ where: { competitionId: id } }),
    ]);
    if (rewards || sessions) throw new ApiError(409, 'HAS_ACTIVITY', 'Faoliyati bor competition o\'chirilmaydi');

    const prizes = await tx.prize.findMany({ where: { competitionId: id }, select: { imageUrl: true } });
    for (const p of prizes) if (p.imageUrl) images.push(p.imageUrl);
    await tx.prize.deleteMany({ where: { competitionId: id } });
    await tx.monthlyCompetition.delete({ where: { id } });
    await record('COMPETITION_DELETED', { actorTelegramId, entityType: 'competition', entityId: id, details: { title: cur.title } }, tx);
  });
  for (const url of images) await deleteImage(url);
  return { ok: true };
}

module.exports = { list, get, create, update, activate, end, archive, remove, toAdmin };