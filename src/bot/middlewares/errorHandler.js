'use strict';

const logger = require('../../utils/logger');
const { isDbUnavailable } = require('../../utils/dbErrors');

const MSG_GENERIC = '⚠️ Kechirasiz, xatolik yuz berdi. Iltimos, birozdan so\'ng qayta urinib ko\'ring.';
const MSG_DB = '🛠 Xizmat vaqtincha mavjud emas. Iltimos, bir necha daqiqadan so\'ng qayta urinib ko\'ring.';

/** Telegram API xatosi: foydalanuvchi botni bloklagan / chat yo'q — bu bizning xatomiz emas. */
function isUserGone(e) {
  return !!e && e.name === 'GrammyError' && (e.error_code === 403 || /chat not found|user is deactivated/i.test(e.description || ''));
}

/** bot.catch() uchun: xatoni turiga qarab loglaydi va userga chiroyli xabar yuboradi. */
function createErrorHandler() {
  return async (botError) => {
    const ctx = botError.ctx;
    const err = botError.error || botError;
    const meta = { updateId: ctx?.update?.update_id, fromId: ctx?.from?.id };

    if (isUserGone(err)) {
      logger.warn({ ...meta, desc: err.description }, 'Foydalanuvchiga xabar yuborib bo\'lmadi (bot bloklangan?)');
      return; // javob berishga urinmaymiz
    }

    if (isDbUnavailable(err)) {
      logger.error({ ...meta, err }, 'Bot: database mavjud emas');
    } else if (err && err.name === 'HttpError') {
      logger.error({ ...meta, err: err.message }, 'Bot: Telegram bilan tarmoq xatosi');
    } else if (err && err.name === 'GrammyError') {
      logger.error({ ...meta, code: err.error_code, desc: err.description, method: err.method }, 'Bot: Telegram API xatosi');
    } else {
      logger.error({ ...meta, err }, 'Bot handler xatosi');
    }

    try {
      const text = isDbUnavailable(err) ? MSG_DB : MSG_GENERIC;
      if (ctx?.callbackQuery) {
        await ctx.answerCallbackQuery({ text, show_alert: true });
      } else if (ctx?.chat) {
        await ctx.reply(text);
      }
    } catch (replyErr) {
      logger.warn({ err: replyErr.message }, 'Xato xabarini yuborib bo\'lmadi');
    }
  };
}

module.exports = { createErrorHandler };
