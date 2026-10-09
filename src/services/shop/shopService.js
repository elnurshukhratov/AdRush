'use strict';

const { prisma } = require('../../db/prisma');
const { lockUser } = require('../../utils/dbLock');
const { createTtlCache } = require('../../utils/ttlCache');
const { isUniqueViolation } = require('../../utils/dbErrors');
const { COIN_TX, CURRENCY, TX_OPTS, TxAbort, fail, applyCoins, getBalance } = require('../coins/coinService');

// Foydalanuvchiga ko'rinadigan ro'yxat qisqa muddat keshlanadi; admin o'zgartirganda va xariddan keyin tozalanadi
const productsCache = createTtlCache({ ttlMs: 10_000, maxEntries: 5 });

function clearProductsCache() {
  productsCache.clear();
}

/** Faqat faol va zaxirasi bor mahsulotlar (sortOrder, keyin yangisi birinchi). Bo'sh bo'lsa bo'sh ro'yxat. */
async function listProducts() {
  return productsCache.wrap('active', async () => {
    const rows = await prisma.shopProduct.findMany({
      where: { isActive: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
      select: { id: true, title: true, description: true, imageUrl: true, priceRush: true, kind: true, stock: true },
    });
    return rows;
  });
}

/**
 * Mahsulot sotib olish. Klientdan faqat productId va requestId; narx va zaxira faqat DB dan.
 * Bitta tranzaksiyada: user qulfi -> mahsulot qatori FOR UPDATE -> faol va zaxira -> Rush yechish (SHOP_PURCHASE) ->
 * zaxira -1 (cheklangan bo'lsa) -> ShopOrder(PENDING).
 * Qaytadi: { success:true, rushCoins, order } yoki { success:false, reason, rushCoins }.
 *  reason: PRODUCT_NOT_FOUND | OUT_OF_STOCK | INSUFFICIENT_FUNDS | DUPLICATE_REQUEST
 */
async function buyProduct(user, productId, requestId) {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('buyProduct: productId noto\'g\'ri');
  if (!requestId) throw new Error('buyProduct: requestId majburiy');

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);
      await tx.$queryRaw`SELECT "id" FROM "ShopProduct" WHERE "id" = ${productId} FOR UPDATE`;

      const product = await tx.shopProduct.findUnique({
        where: { id: productId },
        select: { id: true, title: true, kind: true, priceRush: true, stock: true, isActive: true },
      });
      if (!product || !product.isActive) throw new TxAbort(fail('PRODUCT_NOT_FOUND'));
      if (product.stock !== null && product.stock <= 0) throw new TxAbort(fail('OUT_OF_STOCK'));

      const order = await tx.shopOrder.create({
        data: {
          userId: user.id,
          productId: product.id,
          productTitle: product.title,
          productKind: product.kind,
          priceRush: product.priceRush,
          status: 'PENDING',
        },
        select: { id: true, productId: true, productTitle: true, productKind: true, priceRush: true, status: true, createdAt: true },
      });

      const debit = await applyCoins(tx, {
        userId: user.id,
        amount: -product.priceRush,
        currency: CURRENCY.RUSH,
        type: COIN_TX.SHOP_PURCHASE,
        idempotencyKey: `SHOP_PURCHASE:${user.id}:${requestId}`,
        refType: 'SHOP_ORDER',
        refId: order.id,
      });
      if (!debit.ok) throw new TxAbort(fail('INSUFFICIENT_FUNDS'));

      if (product.stock !== null) {
        const dec = await tx.shopProduct.updateMany({ where: { id: product.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (dec.count !== 1) throw new TxAbort(fail('OUT_OF_STOCK'));
      }

      return {
        success: true,
        rushCoins: debit.balance,
        order: { ...order, createdAt: order.createdAt.toISOString() },
      };
    }, TX_OPTS);

    clearProductsCache();
    return result;
  } catch (err) {
    if (err instanceof TxAbort) return { ...err.result, rushCoins: await getBalance(user.id) };
    if (isUniqueViolation(err) && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return { ...fail('DUPLICATE_REQUEST'), rushCoins: await getBalance(user.id) };
    }
    throw err;
  }
}

/** Foydalanuvchining buyurtmalari (yangisi birinchi). cursor = oxirgi ko'rilgan order id. */
async function listMyOrders(userId, { limit = 20, cursor = null } = {}) {
  const rows = await prisma.shopOrder.findMany({
    where: { userId, ...(cursor ? { id: { lt: Number(cursor) } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      productId: true,
      productTitle: true,
      productKind: true,
      priceRush: true,
      status: true,
      adminNote: true,
      proofImage: true,
      createdAt: true,
      resolvedAt: true,
      product: { select: { imageUrl: true } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((o) => ({
      id: o.id,
      productId: o.productId,
      productTitle: o.productTitle,
      productKind: o.productKind,
      priceRush: o.priceRush,
      status: o.status,
      adminNote: o.adminNote,
      proofImage: o.proofImage,
      imageUrl: o.product ? o.product.imageUrl : null,
      createdAt: o.createdAt.toISOString(),
      resolvedAt: o.resolvedAt ? o.resolvedAt.toISOString() : null,
    })),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  };
}

module.exports = { listProducts, buyProduct, listMyOrders, clearProductsCache };