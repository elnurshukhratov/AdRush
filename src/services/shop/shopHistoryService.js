'use strict';

const { prisma } = require('../../db/prisma');
const { createTtlCache } = require('../../utils/ttlCache');
const { isValidImageUrl } = require('../uploads/imageService');

// Ommaviy Tarix qisqa muddat keshlanadi; admin tasdiqlaganda / isbot rasmini almashtirganda tozalanadi
const historyCache = createTtlCache({ ttlMs: 10_000, maxEntries: 5 });

const PROOF_PREFIX = '/uploads/proofs/';
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;

// Ommaviy Tarixda doimo eng so'nggi shuncha tasdiqlangan sovg'a ko'rinadi (eskilari bazada saqlanadi, o'chirilmaydi)
const HISTORY_LIMIT = 10;
// Rasm yo'li validatsiyasidan o'tmagan yozuvlar tufayli ro'yxat 10 tadan kam bo'lib qolmasligi uchun zaxira bilan olinadi
const HISTORY_FETCH = 30;

function clearHistoryCache() {
  historyCache.clear();
}

/** Oluvchi: Telegram username bo'lsa @username, bo'lmasa xavfsiz ID (ichki id; telegramId HECH QACHON chiqmaydi). */
function recipientLabel(user) {
  if (user.username && USERNAME_RE.test(user.username)) return `@${user.username}`;
  return `ID ${user.id}`;
}

/**
 * Ommaviy Tarix: FAQAT haqiqiy topshirilgan (DELIVERED) VA admin isbot rasmini yuklagan (confirmedAt to'ldirilgan) buyurtmalar.
 * Bekor qilingan, kutilayotgan, jarayondagi yoki rasmsiz buyurtmalar chiqmaydi. Har bir buyurtma bitta qator — takror yo'q.
 * Faqat eng so'nggi HISTORY_LIMIT (10) tasi qaytadi: confirmedAt bo'yicha eng yangisidan eng eskisiga (teng bo'lsa id bo'yicha).
 * Yangi (11-) sovg'a tasdiqlanganda eng eskisi ro'yxatdan tushadi, lekin bazada (va uning rasmi diskda) saqlanib qoladi.
 * Rasm faqat bizning /uploads/proofs/<uuid>.<jpg|png|webp> yo'li bo'lsa qaytadi (yo'l validatsiyasi imageService da).
 * Qaytadi: { items: [{ id, productTitle, recipient, confirmedAt, proofImage }] }.
 */
async function listPublicHistory() {
  return historyCache.wrap('latest', async () => {
    const rows = await prisma.shopOrder.findMany({
      where: { status: 'DELIVERED', confirmedAt: { not: null }, proofImage: { startsWith: PROOF_PREFIX } },
      orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_FETCH,
      select: {
        id: true,
        productTitle: true,
        proofImage: true,
        confirmedAt: true,
        user: { select: { id: true, username: true } },
      },
    });

    const items = rows
      .filter((o) => o.confirmedAt && isValidImageUrl(o.proofImage) && o.proofImage.startsWith(PROOF_PREFIX))
      .slice(0, HISTORY_LIMIT)
      .map((o) => ({
        id: o.id,
        productTitle: o.productTitle,
        recipient: recipientLabel(o.user),
        confirmedAt: o.confirmedAt.toISOString(),
        proofImage: o.proofImage,
      }));

    return { items };
  });
}

module.exports = { listPublicHistory, clearHistoryCache, HISTORY_LIMIT };