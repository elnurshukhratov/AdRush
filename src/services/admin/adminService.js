'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { ApiError } = require('../../utils/apiError');
const { record } = require('../audit/auditService');

/**
 * Admin roli: .env dagi ADMIN_IDS -> SUPER_ADMIN, aks holda Admin jadvalidagi yozuv roli, aks holda null.
 * Tekshiruv HAR SAFAR serverda bajariladi (frontenddagi yashirin tugmaga ishonilmaydi).
 */
async function getAdminRole(telegramId) {
  if (config.adminIds.includes(String(telegramId))) return 'SUPER_ADMIN';
  const row = await prisma.admin.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { role: true } });
  return row ? row.role : null;
}

/** Dashboard: userlar, bloklanganlar, shubhali faollik (24 soat), valid reklamalar, olmos/Rush Coin umumiy statistikasi va buyurtmalar soni holat bo'yicha. */
async function getOverview() {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);

  const [totalUsers, blocked, lifetimeValidAds, suspicious24h, balances, orderGroups] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isBlocked: true } }),
    prisma.adReward.count(),
    prisma.auditLog.count({ where: { action: { startsWith: 'SUSPICIOUS:' }, createdAt: { gte: dayAgo } } }),
    prisma.user.aggregate({ _sum: { diamonds: true, rushCoins: true } }),
    prisma.shopOrder.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const ordersByStatus = { PENDING: 0, PROCESSING: 0, DELIVERED: 0, CANCELLED: 0 };
  for (const g of orderGroups) ordersByStatus[g.status] = g._count._all;

  return {
    totalUsers,
    blocked,
    lifetimeValidAds,
    suspicious24h,
    totalDiamonds: balances._sum.diamonds || 0,
    totalRushCoins: balances._sum.rushCoins || 0,
    ordersByStatus,
  };
}

const AUDIT_KINDS = Object.freeze(['all', 'suspicious', 'admin']);

function toAuditItem(r) {
  return {
    id: r.id.toString(),
    action: r.action,
    actorTelegramId: r.actorTelegramId == null ? null : r.actorTelegramId.toString(),
    entityType: r.entityType,
    entityId: r.entityId,
    details: r.details || null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Audit feed (yangidan eskiga). `before` — oldingi sahifaning oxirgi id si (cursor). */
async function listAudit({ kind = 'all', limit = 30, before = null } = {}) {
  const where = {};
  if (kind === 'suspicious') where.action = { startsWith: 'SUSPICIOUS:' };
  else if (kind === 'admin') where.NOT = { action: { startsWith: 'SUSPICIOUS:' } };
  if (before) where.id = { lt: BigInt(before) };

  const rows = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
  const page = rows.slice(0, limit);
  return {
    items: page.map(toAuditItem),
    nextCursor: rows.length > limit ? page[page.length - 1].id.toString() : null,
  };
}

function toAdminUser(u, extra = {}) {
  return {
    telegramId: u.telegramId.toString(),
    username: u.username,
    firstName: u.firstName,
    isBlocked: u.isBlocked,
    createdAt: u.createdAt.toISOString(),
    ...extra,
  };
}

/** Foydalanuvchilarni qidirish (username / ism / Telegram ID). q bo'sh bo'lsa — bloklanganlar, keyin eng yangilar. */
async function searchUsers({ q = '', limit = 20 } = {}) {
  const term = q.trim();
  const or = [];
  if (term) {
    const clean = term.replace(/^@/, '');
    or.push({ username: { contains: clean, mode: 'insensitive' } }, { firstName: { contains: clean, mode: 'insensitive' } });
    if (/^\d{1,15}$/.test(clean)) or.push({ telegramId: BigInt(clean) });
  }
  const rows = await prisma.user.findMany({
    where: term ? { OR: or } : {},
    orderBy: term ? { createdAt: 'desc' } : [{ isBlocked: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return rows.map((u) => toAdminUser(u));
}

/**
 * Foydalanuvchini bloklash/blokdan chiqarish. Adminlar va o'zini bloklab bo'lmaydi.
 * Bloklanganda ochiq sessiyalari yopiladi (EXPIRED), shuning uchun kechikib kelgan AdsGram tasdig'i ball bermaydi.
 */
async function setBlocked(targetTelegramId, blocked, actorTelegramId) {
  const target = BigInt(targetTelegramId);
  if (target === BigInt(actorTelegramId)) throw new ApiError(409, 'CANNOT_BLOCK_SELF', 'O\'zingizni bloklab bo\'lmaydi');
  if (await getAdminRole(target)) throw new ApiError(409, 'CANNOT_BLOCK_ADMIN', 'Adminni bloklab bo\'lmaydi');

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { telegramId: target } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Foydalanuvchi topilmadi');
    if (user.isBlocked === blocked) return toAdminUser(user);

    const updated = await tx.user.update({ where: { id: user.id }, data: { isBlocked: blocked } });
    if (blocked) {
      await tx.adSession.updateMany({ where: { userId: user.id, status: { in: ['PENDING', 'CLAIMED'] } }, data: { status: 'EXPIRED' } });
    }
    await record(
      blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      { actorTelegramId, entityType: 'user', entityId: target.toString(), details: { userId: user.id } },
      tx,
    );
    return toAdminUser(updated);
  });
}

module.exports = { getAdminRole, getOverview, listAudit, searchUsers, setBlocked, AUDIT_KINDS };