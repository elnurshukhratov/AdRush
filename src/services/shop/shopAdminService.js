'use strict';

const { prisma } = require('../../db/prisma');
const { ApiError } = require('../../utils/apiError');
const { lockUser } = require('../../utils/dbLock');
const { isUniqueViolation } = require('../../utils/dbErrors');
const { record } = require('../audit/auditService');
const { saveShopImage, saveProofImage, deleteImage } = require('../uploads/imageService');
const { COIN_TX, CURRENCY, TX_OPTS, applyCoins } = require('../coins/coinService');
const { clearProductsCache } = require('./shopService');

const ORDER_STATUSES = Object.freeze(['PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED']);
const FINAL_STATUSES = Object.freeze(['DELIVERED', 'CANCELLED']);
// Ruxsat etilgan holat o'tishlari. DELIVERED / CANCELLED dan keyin holat o'zgarmaydi.
const TRANSITIONS = Object.freeze({
  PENDING: ['PROCESSING', 'DELIVERED', 'CANCELLED'],
  PROCESSING: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
});

function toAdminProduct(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    imageUrl: p.imageUrl,
    priceRush: p.priceRush,
    kind: p.kind,
    stock: p.stock,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    ordersCount: p._count ? p._count.orders : undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toAdminOrder(o) {
  return {
    id: o.id,
    productId: o.productId,
    productTitle: o.productTitle,
    productKind: o.productKind,
    priceRush: o.priceRush,
    status: o.status,
    adminNote: o.adminNote,
    proofImage: o.proofImage,
    imageUrl: o.product ? o.product.imageUrl : null,
    user: { id: o.user.id, telegramId: o.user.telegramId.toString(), username: o.user.username, firstName: o.user.firstName },
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    resolvedAt: o.resolvedAt ? o.resolvedAt.toISOString() : null,
  };
}

// ---------- Mahsulotlar ----------

/** Barcha mahsulotlar (faol bo'lmaganlari ham), buyurtmalar soni bilan. */
async function listProducts() {
  const rows = await prisma.shopProduct.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    include: { _count: { select: { orders: true } } },
  });
  return rows.map(toAdminProduct);
}

async function createProduct(data, actorTelegramId) {
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.shopProduct.create({ data });
    await record(
      'ADMIN_SHOP_PRODUCT_CREATE',
      { actorTelegramId, entityType: 'shop_product', entityId: created.id, details: { title: created.title, priceRush: created.priceRush, kind: created.kind, stock: created.stock } },
      tx,
    );
    return created;
  });
  clearProductsCache();
  return toAdminProduct(row);
}

async function updateProduct(id, patch, actorTelegramId) {
  const { old, row } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ShopProduct" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.shopProduct.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Mahsulot topilmadi');
    const updated = await tx.shopProduct.update({ where: { id }, data: patch });
    await record(
      'ADMIN_SHOP_PRODUCT_UPDATE',
      {
        actorTelegramId,
        entityType: 'shop_product',
        entityId: id,
        details: { changed: Object.keys(patch), priceRush: { from: existing.priceRush, to: updated.priceRush }, stock: { from: existing.stock, to: updated.stock }, isActive: { from: existing.isActive, to: updated.isActive } },
      },
      tx,
    );
    return { old: existing, row: updated };
  });
  clearProductsCache();
  if (old.imageUrl && old.imageUrl !== row.imageUrl) await deleteImage(old.imageUrl); // almashtirilgan/olib tashlangan rasm diskdan ketadi
  return toAdminProduct(row);
}

/** Buyurtmasi bor mahsulot o'chirilmaydi — o'rniga isActive=false. Buyurtmasi yo'q bo'lsa to'liq o'chadi. */
async function deleteProduct(id, actorTelegramId) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ShopProduct" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.shopProduct.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Mahsulot topilmadi');

    if (existing._count.orders > 0) {
      const updated = await tx.shopProduct.update({ where: { id }, data: { isActive: false } });
      await record('ADMIN_SHOP_PRODUCT_DEACTIVATE', { actorTelegramId, entityType: 'shop_product', entityId: id, details: { title: existing.title, orders: existing._count.orders } }, tx);
      return { deleted: false, deactivated: true, product: toAdminProduct({ ...updated, _count: existing._count }), imageUrl: null };
    }
    await tx.shopProduct.delete({ where: { id } });
    await record('ADMIN_SHOP_PRODUCT_DELETE', { actorTelegramId, entityType: 'shop_product', entityId: id, details: { title: existing.title } }, tx);
    return { deleted: true, deactivated: false, product: null, imageUrl: existing.imageUrl };
  });
  clearProductsCache();
  if (result.imageUrl) await deleteImage(result.imageUrl);
  const { imageUrl: _i, ...out } = result;
  return out;
}

/** Mahsulot rasmini saqlaydi (faqat /uploads/shop/...). Formati noto'g'ri bo'lsa 400. */
async function uploadProductImage(buf) {
  const imageUrl = await saveShopImage(buf);
  if (!imageUrl) throw new ApiError(400, 'INVALID_IMAGE', 'Rasm formati noto\'g\'ri (JPG, PNG yoki WebP)');
  return imageUrl;
}

// ---------- Buyurtmalar ----------

async function listOrders({ status = null, limit = 30, cursor = null } = {}) {
  const rows = await prisma.shopOrder.findMany({
    where: { ...(status ? { status } : {}), ...(cursor ? { id: { lt: Number(cursor) } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    include: {
      user: { select: { id: true, telegramId: true, username: true, firstName: true } },
      product: { select: { imageUrl: true } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page.map(toAdminOrder), nextCursor: hasMore ? String(page[page.length - 1].id) : null };
}

/**
 * Holat va/yoki izohni o'zgartiradi. Bitta tranzaksiyada: user qulfi -> buyurtma qatori FOR UPDATE -> o'tish tekshiruvi.
 * CANCELLED: Rush qaytariladi (SHOP_REFUND, kalit SHOP_REFUND:<orderId>, faqat bir marta) va zaxira bo'lsa +1.
 * Qaytadi: { order, notify } — notify faqat holat DELIVERED/CANCELLED ga o'tganda to'ldiriladi (bot xabari tranzaksiyadan keyin yuboriladi).
 */
async function updateOrder(orderId, { status, adminNote }, actorTelegramId) {
  const head = await prisma.shopOrder.findUnique({ where: { id: orderId }, select: { user: { select: { telegramId: true } } } });
  if (!head) throw new ApiError(404, 'NOT_FOUND', 'Buyurtma topilmadi');

  let out;
  try {
    out = await prisma.$transaction(async (tx) => {
      await lockUser(tx, head.user.telegramId);
      await tx.$queryRaw`SELECT "id" FROM "ShopOrder" WHERE "id" = ${orderId} FOR UPDATE`;

      const order = await tx.shopOrder.findUnique({ where: { id: orderId }, include: { user: { select: { id: true, telegramId: true, language: true } } } });
      if (!order) throw new ApiError(404, 'NOT_FOUND', 'Buyurtma topilmadi');

      const changesStatus = status !== undefined && status !== order.status;
      if (changesStatus && !TRANSITIONS[order.status].includes(status)) {
        throw new ApiError(409, FINAL_STATUSES.includes(order.status) ? 'ORDER_FINAL' : 'INVALID_TRANSITION', 'Buyurtma holatini bu holatga o\'zgartirib bo\'lmaydi', { status: order.status });
      }

      const data = {};
      if (adminNote !== undefined) data.adminNote = adminNote;
      let refunded = false;

      if (changesStatus) {
        data.status = status;
        if (FINAL_STATUSES.includes(status)) data.resolvedAt = new Date();

        if (status === 'CANCELLED') {
          const credit = await applyCoins(tx, {
            userId: order.userId,
            amount: order.priceRush,
            currency: CURRENCY.RUSH,
            type: COIN_TX.SHOP_REFUND,
            idempotencyKey: `SHOP_REFUND:${order.id}`,
            refType: 'SHOP_ORDER',
            refId: order.id,
          });
          if (!credit.ok) throw new Error('updateOrder: refund kirimi yozilmadi'); // kirimda bu bo'lmasligi kerak — rollback
          refunded = true;
          if (order.productId) {
            // Mahsulot o'chgan bo'lsa (productId NULL) zaxira qaytmaydi; cheksiz (stock NULL) mahsulotda increment ta'sir qilmaydi
            await tx.shopProduct.updateMany({ where: { id: order.productId, stock: { not: null } }, data: { stock: { increment: 1 } } });
          }
        }
      }

      if (Object.keys(data).length === 0) {
        const same = await tx.shopOrder.findUnique({ where: { id: orderId }, include: { user: { select: { id: true, telegramId: true, username: true, firstName: true } }, product: { select: { imageUrl: true } } } });
        return { order: same, notify: null };
      }

      const updated = await tx.shopOrder.update({
        where: { id: orderId },
        data,
        include: { user: { select: { id: true, telegramId: true, username: true, firstName: true } }, product: { select: { imageUrl: true } } },
      });
      await record(
        'ADMIN_SHOP_ORDER_UPDATE',
        {
          actorTelegramId,
          entityType: 'shop_order',
          entityId: orderId,
          details: { userId: order.userId, from: order.status, to: updated.status, noteChanged: adminNote !== undefined, refunded, priceRush: order.priceRush },
        },
        tx,
      );

      const notify =
        changesStatus && FINAL_STATUSES.includes(status)
          ? { telegramId: order.user.telegramId, language: order.user.language, status, orderId: order.id, productTitle: order.productTitle, priceRush: order.priceRush }
          : null;
      return { order: updated, notify };
    }, TX_OPTS);
  } catch (err) {
    // SHOP_REFUND:<orderId> allaqachon bor -> qaytarish ikki marta bo'lmaydi
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      throw new ApiError(409, 'ORDER_FINAL', 'Buyurtma allaqachon yakunlangan');
    }
    throw err;
  }

  if (out.notify) clearProductsCache(); // CANCELLED da zaxira qaytgan bo'lishi mumkin
  return { order: toAdminOrder(out.order), notify: out.notify };
}

/** Yetkazilganini tasdiqlovchi rasm. Bekor qilingan buyurtmaga yuklanmaydi; eski rasm almashtiriladi. */
async function setOrderProof(orderId, buf, actorTelegramId) {
  const existing = await prisma.shopOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true, proofImage: true } });
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Buyurtma topilmadi');
  if (existing.status === 'CANCELLED') throw new ApiError(409, 'ORDER_FINAL', 'Bekor qilingan buyurtmaga isbot yuklab bo\'lmaydi');

  const url = await saveProofImage(buf);
  if (!url) throw new ApiError(400, 'INVALID_IMAGE', 'Rasm formati noto\'g\'ri (JPG, PNG yoki WebP)');

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.shopOrder.updateMany({ where: { id: orderId, status: { not: 'CANCELLED' } }, data: { proofImage: url } });
      if (row.count !== 1) throw new ApiError(409, 'ORDER_FINAL', 'Bekor qilingan buyurtmaga isbot yuklab bo\'lmaydi');
      await record('ADMIN_SHOP_ORDER_PROOF', { actorTelegramId, entityType: 'shop_order', entityId: orderId }, tx);
      return tx.shopOrder.findUnique({
        where: { id: orderId },
        include: { user: { select: { id: true, telegramId: true, username: true, firstName: true } }, product: { select: { imageUrl: true } } },
      });
    });
  } catch (err) {
    await deleteImage(url); // DB ga yozilmadi — yetim fayl qolmasin
    throw err;
  }
  if (existing.proofImage) await deleteImage(existing.proofImage);
  return toAdminOrder(updated);
}

module.exports = {
  ORDER_STATUSES,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  listOrders,
  updateOrder,
  setOrderProof,
};