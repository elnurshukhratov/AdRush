'use strict';

const config = require('../../config');

/**
 * Oddiy in-memory throttle: har bir user uchun oynada ko'pi bilan `throttleMax` ta update.
 * Oshib ketsa update e'tiborsiz qoldiriladi (callback bo'lsa "osilib" qolmasligi uchun javob beriladi).
 * TODO(5-bosqich): bir nechta instansiya bo'lsa Redis ga o'tkazish.
 */
function throttle() {
  const { throttleMax: max, throttleWindowMs: windowMs } = config.bot;
  const hits = new Map(); // userId -> { start, count }

  return async (ctx, next) => {
    const id = ctx.from && ctx.from.id;
    if (!id) return next();
    // To'lov hodisalari HECH QACHON tashlab yuborilmaydi: pre_checkout javobsiz qolsa to'lov bekor bo'ladi,
    // successful_payment tashlansa pul olinib balans qo'shilmay qoladi
    if (ctx.preCheckoutQuery || (ctx.message && ctx.message.successful_payment)) return next();

    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }

    const h = hits.get(id);
    if (!h || now - h.start >= windowMs) {
      hits.set(id, { start: now, count: 1 });
      return next();
    }
    h.count += 1;
    if (h.count > max) {
      if (h.count === max + 1 && ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: 'Juda tez. Birozdan so\'ng urinib ko\'ring.' }).catch(() => {});
      }
      return undefined;
    }
    return next();
  };
}

module.exports = { throttle };