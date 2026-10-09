'use strict';

const path = require('path');
const { InputFile, InlineKeyboard } = require('grammy');
const config = require('../../config');
const logger = require('../../utils/logger');
const { syncFromTelegram, findByTelegramId, setLanguageIfUnset } = require('../../services/users/userService');
const { applyReferral } = require('../../services/referrals/referralService');
const { escapeHtml } = require('../../utils/format');
const { t, normalizeLang, LANG_BUTTONS, SUPPORTED_LANGS } = require('../i18n');

const WELCOME_IMAGE = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'adrush.png');

let cachedFileId = null; // Telegram file_id — rasm keyingi safar qayta yuklanmaydi

/**
 * Mine App havolasi: ?lang=<til> URL obyekti orqali qo'shiladi (MINE_APP_URL da query/hash bo'lsa ham buzilmaydi).
 * Natija doim https:// bo'lib qoladi (Telegram Web App talabi); aks holda asl havola qaytariladi.
 * Eslatma: ?lang faqat birinchi chizish uchun — ilova ochilgach serverdagi til ustun turadi.
 */
function buildAppUrl(lang, base = config.mineAppUrl) {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return base;
    url.searchParams.set('lang', normalizeLang(lang));
    return url.toString();
  } catch {
    return base;
  }
}

function openAppKeyboard(lang) {
  return new InlineKeyboard().webApp(t(lang, 'open_app'), buildAppUrl(lang));
}

function languageKeyboard() {
  const kb = new InlineKeyboard();
  for (const code of SUPPORTED_LANGS) kb.text(LANG_BUTTONS[code], `lang:${code}`);
  return kb;
}

/** Xush kelibsiz xabari (rasm + "Ilovani ochish" tugmasi) — berilgan tilda. */
async function sendWelcome(ctx, lang) {
  const text = t(lang, 'welcome');
  const chatId = ctx.from.id; // bot faqat shaxsiy chatda ishlaydi
  const extra = { caption: text, parse_mode: 'HTML', reply_markup: openAppKeyboard(lang) };
  try {
    const sent = await ctx.api.sendPhoto(chatId, cachedFileId || new InputFile(WELCOME_IMAGE), extra);
    if (!cachedFileId && sent && sent.photo && sent.photo.length) cachedFileId = sent.photo[sent.photo.length - 1].file_id;
  } catch (err) {
    // Rasm yuborilmasa ham foydalanuvchi tugmasiz qolmasin
    logger.warn({ err: err.description || err.message }, '/start: rasm yuborilmadi, matn yuborilmoqda');
    cachedFileId = null;
    await ctx.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: openAppKeyboard(lang) });
  }
}

/**
 * /start ref_<telegramId>: faqat YANGI user (shu update'da yaratilgan) uchun taklif qiluvchiga Rush Coin beradi.
 * Referral til tanlashni KUTMAYDI (darhol hisoblanadi). Xabar taklif qiluvchining tilida ketadi.
 * Referral xatosi /start ni to'xtatmasligi kerak: faqat logga yoziladi.
 */
async function handleReferral(ctx) {
  const m = /^ref_(\d{1,15})$/.exec(String(ctx.match || '').trim());
  if (!m || !ctx.isNewUser) return;
  try {
    const res = await applyReferral(ctx.dbUser, m[1]);
    if (!res.success) {
      logger.info({ reason: res.reason, telegramId: ctx.from.id }, 'Referral qabul qilinmadi');
      return;
    }

    let refLang = null;
    try {
      const referrer = await findByTelegramId(res.referrerTelegramId);
      refLang = referrer ? referrer.language : null; // bo'sh bo'lsa t() uz ga tushadi
    } catch (err) {
      logger.warn({ err: err.message }, 'Taklif qiluvchi tilini aniqlab bo\'lmadi (uz ishlatiladi)');
    }

    const who = ctx.from.username
      ? `@${escapeHtml(ctx.from.username)}`
      : escapeHtml(ctx.from.first_name || t(refLang, 'user_fallback'));
    await ctx.api
      .sendMessage(Number(res.referrerTelegramId), t(refLang, 'referral_new', { who, reward: res.reward }), { parse_mode: 'HTML' })
      .catch((err) => logger.warn({ err: err.description || err.message }, 'Referral xabarini yuborib bo\'lmadi'));
  } catch (err) {
    logger.error({ err }, 'Referral qayta ishlashda xato');
  }
}

module.exports = (bot) => {
  bot.command('start', async (ctx) => {
    // /start har safar ishlaydi: user yaratilmaydi, mavjud bo'lsa yangilanadi (til o'zgarmaydi)
    ctx.dbUser = await syncFromTelegram(ctx.from, { force: true });
    await handleReferral(ctx); // avvalgidek darhol — til tanlashni kutmaydi

    const lang = ctx.dbUser.language;
    if (!lang) {
      // Til hali tanlanmagan: 3 tilli xabar + 3 tugma (xush kelibsiz xabari keyin, tanlovdan so'ng)
      await ctx.reply(t(null, 'pick_language'), { reply_markup: languageKeyboard() });
      return;
    }
    await sendWelcome(ctx, lang);
  });

  // Til tanlash tugmalari
  bot.callbackQuery(/^lang:(uz|en|ru)$/, async (ctx) => {
    const lang = ctx.match[1];
    await ctx.answerCallbackQuery().catch(() => {}); // tugmadagi "soat" belgisi darhol yo'qolsin

    let user = ctx.dbUser;
    let changed = false;
    try {
      ({ user, changed } = await setLanguageIfUnset(ctx.dbUser.id, lang));
    } catch (err) {
      // DB xatosida ham foydalanuvchi "hech nima bo'lmadi" holatida qolmasin: tanlangan tilda xabar yuboramiz
      logger.error({ err: err.message, telegramId: ctx.from.id }, 'Tilni saqlab bo\'lmadi');
    }
    const deleted = await ctx.deleteMessage().then(() => true).catch(() => false); // takroriy bosishda xabar allaqachon o'chirilgan

    // Takroriy bosish (xabar allaqachon o'chirilgan, til yozilgan): ikkinchi marta yubormaymiz.
    // Lekin xabar hali turgan bo'lsa (til boshqa joydan yozilgan) — tugma "osilib" qolmasin, mavjud tilda xush kelibsiz yuboramiz.
    if (!changed && !deleted) return;
    const finalLang = changed ? lang : (user && user.language) || lang;
    ctx.dbUser = user || ctx.dbUser;
    await sendWelcome(ctx, finalLang);
  });

  // Boshqa/noto'g'ri callback_data (masalan lang:de): bazaga yozilmaydi, faqat "osilib" qolmasligi uchun javob beriladi
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
  });
};

module.exports.buildAppUrl = buildAppUrl;