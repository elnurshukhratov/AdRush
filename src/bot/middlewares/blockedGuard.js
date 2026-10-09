'use strict';

const { t } = require('../i18n');

/** Bloklangan userga javob beradi (o'z tilida; til yo'q bo'lsa uz) va keyingi handlerlarni to'xtatadi. */
function blockedGuard() {
  return async (ctx, next) => {
    if (ctx.dbUser?.isBlocked) {
      const text = t(ctx.dbUser.language, 'blocked');
      if (ctx.callbackQuery) {
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