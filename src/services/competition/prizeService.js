'use strict';

const { prisma } = require('../../db/prisma');
const { ApiError } = require('../../utils/apiError');
const { record } = require('../audit/auditService');
const { deleteImage } = require('../uploads/imageService');

const PRIZE_EDITABLE = ['DRAFT', 'ACTIVE']; // tugagan/arxivlangan competition sovrinlari o'zgarmaydi

function toPublicPrize(p) {
  return {
    id: p.id,
    place: p.place,
    title: p.title,
    description: p.description || null,
    imageUrl: p.imageUrl || null,
    value: p.value || null,
    quantity: p.quantity,
  };
}

function toAdminPrize(p) {
  return { ...toPublicPrize(p), competitionId: p.competitionId, status: p.status, updatedAt: p.updatedAt.toISOString() };
}

/** Foydalanuvchilarga ko'rinadigan sovrinlar (faqat status=ACTIVE), place bo'yicha. */
async function getActivePrizes(competitionId, client = prisma) {
  return client.prize.findMany({ where: { competitionId, status: 'ACTIVE' }, orderBy: { place: 'asc' } });
}

async function listForAdmin(competitionId) {
  const rows = await prisma.prize.findMany({ where: { competitionId }, orderBy: { place: 'asc' } });
  return rows.map(toAdminPrize);
}

async function requireEditableCompetition(tx, competitionId) {
  const c = await tx.monthlyCompetition.findUnique({ where: { id: competitionId }, select: { id: true, status: true } });
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Competition topilmadi');
  if (!PRIZE_EDITABLE.includes(c.status)) {
    throw new ApiError(409, 'COMPETITION_LOCKED', 'Tugagan competition sovrinlarini o\'zgartirib bo\'lmaydi');
  }
  return c;
}

function mapUnique(err) {
  if (err && err.code === 'P2002') return new ApiError(409, 'PLACE_TAKEN', 'Bu o\'rin uchun sovrin allaqachon mavjud');
  return err;
}

async function create(competitionId, data, actorTelegramId) {
  try {
    const row = await prisma.$transaction(async (tx) => {
      await requireEditableCompetition(tx, competitionId);
      const created = await tx.prize.create({ data: { competitionId, ...data } });
      await record(
        'PRIZE_CREATED',
        { actorTelegramId, entityType: 'prize', entityId: created.id, details: { competitionId, place: created.place, title: created.title } },
        tx,
      );
      return created;
    });
    return toAdminPrize(row);
  } catch (err) {
    throw mapUnique(err);
  }
}

async function update(prizeId, data, actorTelegramId) {
  let oldImage = null;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.prize.findUnique({ where: { id: prizeId } });
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Sovrin topilmadi');
      await requireEditableCompetition(tx, existing.competitionId);

      if (data.imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== data.imageUrl) oldImage = existing.imageUrl;
      const updated = await tx.prize.update({ where: { id: prizeId }, data });
      await record(
        'PRIZE_UPDATED',
        { actorTelegramId, entityType: 'prize', entityId: prizeId, details: { competitionId: existing.competitionId, fields: Object.keys(data) } },
        tx,
      );
      return updated;
    });
    if (oldImage) await deleteImage(oldImage); // tranzaksiya muvaffaqiyatli tugagandan keyin
    return toAdminPrize(row);
  } catch (err) {
    throw mapUnique(err);
  }
}

async function remove(prizeId, actorTelegramId) {
  let image = null;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.prize.findUnique({ where: { id: prizeId } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Sovrin topilmadi');
    await requireEditableCompetition(tx, existing.competitionId);
    image = existing.imageUrl;
    await tx.prize.delete({ where: { id: prizeId } });
    await record(
      'PRIZE_DELETED',
      { actorTelegramId, entityType: 'prize', entityId: prizeId, details: { competitionId: existing.competitionId, place: existing.place, title: existing.title } },
      tx,
    );
  });
  if (image) await deleteImage(image);
  return { ok: true };
}

module.exports = { getActivePrizes, listForAdmin, create, update, remove, toPublicPrize, toAdminPrize };
