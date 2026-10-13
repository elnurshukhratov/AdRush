'use strict';

const { t } = require('../i18n');

/** Bloklangan userga javob beradi (o'z tilida; til yo'q bo'lsa uz) va keyingi handlerlarni to'xtatadi. */
function blockedGuard() {
  return async (ctx, next) => {
    // Pul allaqachon olingan: successful_payment bloklangan userda ham hisobga olinadi (pul yo'qolmasin)
    if (ctx.message && ctx.message.successful_payment) return next();
    if (ctx.dbUser?.isBlocked) {
      const text = t(ctx.dbUser.language, 'blocked');
      if (ctx.preCheckoutQuery) {
        // pre_checkout da chat yo'q (reply ishlamaydi): to'lovni rad etamiz
        await ctx.answerPreCheckoutQuery(false, text);
      } else if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text, show_alert: true });
      } else {
        await ctx.reply(text);
      }
      return;
    }
    return next();
  };
}

module.exports = { blockedGuard };