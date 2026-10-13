'use strict';

const { Bot, webhookCallback } = require('grammy');
const config = require('./config');
const logger = require('./utils/logger');
const { throttle } = require('./bot/middlewares/throttle');
const { userSync } = require('./bot/middlewares/userSync');
const { blockedGuard } = require('./bot/middlewares/blockedGuard');
const { createErrorHandler } = require('./bot/middlewares/errorHandler');
const registerStart = require('./bot/commands/start');
const registerPayments = require('./bot/payments');

// Bot faqat shu update turlarini ishlatadi — Telegram boshqalarini yubormaydi (trafik va hujum yuzasi kamayadi).
// callback_query — til tanlash tugmalari uchun (busiz tugmalar ishlamaydi).
// pre_checkout_query — Telegram to'lovi (so'm hamyon): busiz to'lov oynasi 10 soniyadan keyin xato beradi.
// successful_payment alohida tur emas, u 'message' ichida keladi.
const ALLOWED_UPDATES = ['message', 'callback_query', 'pre_checkout_query'];

// Bot faqat /start. Boshqa hamma funksiya Mine App ichida.
const BOT_COMMANDS = [{ command: 'start', description: 'AdRush ni ochish' }];

function createBot() {
  const bot = new Bot(config.botToken);

  bot.catch(createErrorHandler());

  // Tartib muhim: throttle -> user -> blok tekshiruvi -> to'lovlar -> /start
  bot.use(throttle());
  bot.use(userSync());
  bot.use(blockedGuard());

  registerPayments(bot);
  registerStart(bot);

  return bot;
}

/** BOT_MODE=webhook bo'lsa Express handler qaytaradi (secret_token tekshiruvi bilan), aks holda null. */
function createWebhookHandler(bot) {
  if (config.bot.mode !== 'webhook') return null;
  return webhookCallback(bot, 'express', { secretToken: config.bot.webhookSecret });
}

async function setupCommands(bot) {
  try {
    await bot.api.setMyCommands(BOT_COMMANDS);
    // Oldingi versiyada adminlar chatiga qo'yilgan qo'shimcha buyruqlar (/admin...) menyudan olib tashlanadi
    for (const id of config.adminIds) {
      try {
        await bot.api.deleteMyCommands({ scope: { type: 'chat', chat_id: Number(id) } });
      } catch (err) {
        logger.warn({ adminId: id, err: err.description || err.message }, 'Admin chat buyruqlarini tozalab bo\'lmadi');
      }
    }
  } catch (err) {
    logger.warn({ err: err.description || err.message }, 'Bot buyruqlar menyusini o\'rnatib bo\'lmadi');
  }
}

/**
 * Botni ishga tushiradi.
 *  - polling: long polling (bitta instansiya!). Ikkinchi instansiya 409 Conflict beradi.
 *  - webhook: Telegram'ga webhook URL o'rnatiladi; update'lar Express orqali keladi (bir nechta instansiya mumkin).
 */
async function startBot(bot) {
  await bot.init(); // getMe — token noto'g'ri bo'lsa shu yerda xato beradi
  await setupCommands(bot);
  logger.info(`Bot ishga tushdi: @${bot.botInfo.username} (rejim: ${config.bot.mode})`);

  if (config.bot.mode === 'webhook') {
    const url = `${config.bot.webhookUrl}${config.bot.webhookPath}`;
    await bot.api.setWebhook(url, {
      secret_token: config.bot.webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
    logger.info({ url }, 'Telegram webhook o\'rnatildi');
    // Telegram eski allowed_updates (faqat message) ni eslab qolgan bo'lsa, til tugmalari (callback_query) kelmaydi — tekshiramiz
    try {
      const info = await bot.api.getWebhookInfo();
      const got = info.allowed_updates || [];
      const missing = ALLOWED_UPDATES.filter((u) => got.length && !got.includes(u));
      if (info.url !== url || missing.length) {
        logger.warn({ url: info.url, allowed: got, missing }, 'Webhook sozlamasi kutilgandan farq qiladi — qayta o\'rnatilmoqda');
        await bot.api.setWebhook(url, { secret_token: config.bot.webhookSecret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false });
      }
      if (info.last_error_message) logger.warn({ lastError: info.last_error_message }, 'Telegram webhook oxirgi xatosi');
    } catch (err) {
      logger.warn({ err: err.description || err.message }, 'getWebhookInfo tekshiruvi bajarilmadi');
    }
    return;
  }

  // start() bot to'xtaguncha resolve bo'lmaydi, shuning uchun await qilinmaydi (start webhookni o'zi o'chiradi)
  bot
    .start({ drop_pending_updates: false, allowed_updates: ALLOWED_UPDATES })
    .catch((err) => {
      const conflict = err && err.error_code === 409;
      logger.fatal(
        { err },
        conflict
          ? 'Bot polling to\'xtadi: 409 Conflict — shu token bilan boshqa instansiya ishlayapti (polling faqat bitta instansiyada ishlaydi)'
          : 'Bot polling to\'xtadi',
      );
      process.exit(1);
    });
}

async function stopBot(bot) {
  // Webhook rejimida webhook O'CHIRILMAYDI (rolling deploy paytida update'lar yo'qolmasligi uchun)
  if (config.bot.mode === 'polling') await bot.stop();
  logger.info('Bot to\'xtatildi');
}

/** Adminlarga xabar yuboradi (oy avtomatik yopilganda). Yetkazib bo'lmaganlar logga yoziladi. */
async function notifyAdmins(bot, html) {
  for (const id of config.adminIds) {
    try {
      await bot.api.sendMessage(Number(id), html, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ adminId: id, err: err.description || err.message }, 'Adminga xabar yuborib bo\'lmadi');
    }
  }
}

module.exports = { createBot, createWebhookHandler, startBot, stopBot, notifyAdmins, ALLOWED_UPDATES };