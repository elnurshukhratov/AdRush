'use strict';

/**
 * Botdan foydalanuvchiga boradigan barcha matnlar — 3 tilda (uz | en | ru).
 * Adminlarga boradigan xabarlar bu yerda EMAS: ular o'zbekcha qoladi.
 * HTML parse_mode ishlatiladigan matnlarda o'zgaruvchilarni chaqiruvchi escapeHtml qiladi.
 */

const SUPPORTED_LANGS = Object.freeze(['uz', 'en', 'ru']);
const DEFAULT_LANG = 'uz';

const LANG_BUTTONS = Object.freeze({
  uz: '🇺🇿 O\'zbekcha',
  en: '🇬🇧 English',
  ru: '🇷🇺 Русский',
});

const STRINGS = {
  uz: {
    pick_language: '🌐 Tilni tanlang / Choose language / Выберите язык',
    welcome: [
      '💎 <b>AdRush</b>',
      '',
      'Vazifalarni bajaring, olmos yig\'ing',
      'va uni Rush Coin ga almashtiring.',
      '',
      '💎 Reklama ko\'rib olmos oling',
      '🪙 Olmosni Rush Coin ga almashtiring',
      '🛍 Do\'kondan Rush Coin evaziga xarid qiling',
      '👥 Do\'stlarni taklif qilib 💎 oling',
      '',
      'Boshlash uchun pastdagi tugmani bosing 👇',
    ].join('\n'),
    open_app: '🚀 ILOVANI OCHISH',
    referral_new: '🎁 <b>Yangi referal!</b>\n{who} havolangiz orqali qo\'shildi.\n💎 +{reward} olmos',
    user_fallback: 'Foydalanuvchi',
    blocked: '⛔ Sizning akkauntingiz cheklangan. Savol bo\'lsa administratorga murojaat qiling.',
    shop_order_delivered: '✅ <b>Buyurtma yetkazildi</b>\n\n🛍 {title}\n🆔 Buyurtma: #{id}',
    shop_order_cancelled: '❌ <b>Buyurtma bekor qilindi</b>\n\n🛍 {title}\n🆔 Buyurtma: #{id}\n🪙 {price} Rush Coin balansingizga qaytarildi.',
    wallet_topup_ok: '✅ <b>Hamyon to\'ldirildi</b>\n\n💰 +{amount} so\'m\n💳 Balans: {balance} so\'m',
  },
  en: {
    pick_language: '🌐 Tilni tanlang / Choose language / Выберите язык',
    welcome: [
      '💎 <b>AdRush</b>',
      '',
      'Complete tasks, collect diamonds',
      'and exchange them for Rush Coin.',
      '',
      '💎 Watch ads to earn diamonds',
      '🪙 Exchange diamonds for Rush Coin',
      '🛍 Buy items in the shop with Rush Coin',
      '👥 Invite friends and earn 💎',
      '',
      'Tap the button below to get started 👇',
    ].join('\n'),
    open_app: '🚀 OPEN APP',
    referral_new: '🎁 <b>New referral!</b>\n{who} joined via your link.\n💎 +{reward} diamonds',
    user_fallback: 'User',
    blocked: '⛔ Your account has been restricted. If you have any questions, please contact the administrator.',
    shop_order_delivered: '✅ <b>Order delivered</b>\n\n🛍 {title}\n🆔 Order: #{id}',
    shop_order_cancelled: '❌ <b>Order cancelled</b>\n\n🛍 {title}\n🆔 Order: #{id}\n🪙 {price} Rush Coin has been returned to your balance.',
    wallet_topup_ok: '✅ <b>Wallet topped up</b>\n\n💰 +{amount} UZS\n💳 Balance: {balance} UZS',
  },
  ru: {
    pick_language: '🌐 Tilni tanlang / Choose language / Выберите язык',
    welcome: [
      '💎 <b>AdRush</b>',
      '',
      'Выполняйте задания, собирайте алмазы',
      'и обменивайте их на Rush Coin.',
      '',
      '💎 Смотрите рекламу и получайте алмазы',
      '🪙 Обменивайте алмазы на Rush Coin',
      '🛍 Покупайте в магазине за Rush Coin',
      '👥 Приглашайте друзей и получайте 💎',
      '',
      'Нажмите кнопку ниже, чтобы начать 👇',
    ].join('\n'),
    open_app: '🚀 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
    referral_new: '🎁 <b>Новый реферал!</b>\n{who} пришёл по вашей ссылке.\n💎 +{reward} алмазов',
    user_fallback: 'Пользователь',
    blocked: '⛔ Ваш аккаунт ограничен. Если есть вопросы, обратитесь к администратору.',
    shop_order_delivered: '✅ <b>Заказ доставлен</b>\n\n🛍 {title}\n🆔 Заказ: #{id}',
    shop_order_cancelled: '❌ <b>Заказ отменён</b>\n\n🛍 {title}\n🆔 Заказ: #{id}\n🪙 {price} Rush Coin возвращено на ваш баланс.',
    wallet_topup_ok: '✅ <b>Кошелёк пополнен</b>\n\n💰 +{amount} сум\n💳 Баланс: {balance} сум',
  },
};

function isLang(lang) {
  return typeof lang === 'string' && SUPPORTED_LANGS.includes(lang);
}

/** Noma'lum/null/noto'g'ri til -> 'uz'. */
function normalizeLang(lang) {
  return isLang(lang) ? lang : DEFAULT_LANG;
}

/**
 * t(lang, key, vars): matn + {o'zgaruvchi} almashtirish.
 * Til noma'lum/null bo'lsa 'uz'; kalit tanlangan tilda topilmasa 'uz', u ham bo'lmasa kalitning o'zi.
 */
function t(lang, key, vars) {
  const l = normalizeLang(lang);
  let text = (STRINGS[l] && STRINGS[l][key]) ?? STRINGS[DEFAULT_LANG][key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
  }
  return text;
}

module.exports = { SUPPORTED_LANGS, DEFAULT_LANG, LANG_BUTTONS, STRINGS, isLang, normalizeLang, t };