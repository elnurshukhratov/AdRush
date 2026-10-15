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
      '♟ <b>AdRush Shahmat</b>',
      '',
      'Shahmat o\'ynang — bot bilan yoki boshqa o\'yinchilar bilan onlayn.',
      '',
      '🤖 Bot bilan: Oson, O\'rta yoki Qiyin daraja',
      '🌐 Onlayn: haqiqiy raqib bilan soat bo\'yicha o\'yin',
      '',
      '🏆 Yutsangiz +3 💎',
      '😔 Yutqazsangiz −1 💎',
      '🤝 Durang — 0',
      '',
      'Olmosni Rush Coin ga almashtirib, Do\'kondan xarid qilishingiz mumkin.',
      '',
      'Boshlash uchun pastdagi tugmani bosing 👇',
    ].join('\n'),
    open_app: '♟ O\'YNASH',
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
      '♟ <b>AdRush Chess</b>',
      '',
      'Play chess — against the bot or online against other players.',
      '',
      '🤖 Vs bot: Easy, Medium or Hard',
      '🌐 Online: timed games against real opponents',
      '',
      '🏆 Win: +3 💎',
      '😔 Lose: −1 💎',
      '🤝 Draw: 0',
      '',
      'Exchange diamonds for Rush Coin and shop in the store.',
      '',
      'Tap the button below to get started 👇',
    ].join('\n'),
    open_app: '♟ PLAY',
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
      '♟ <b>AdRush Шахматы</b>',
      '',
      'Играйте в шахматы — с ботом или онлайн с другими игроками.',
      '',
      '🤖 С ботом: лёгкий, средний или сложный уровень',
      '🌐 Онлайн: партия с часами против реального соперника',
      '',
      '🏆 Победа: +3 💎',
      '😔 Поражение: −1 💎',
      '🤝 Ничья: 0',
      '',
      'Обменивайте алмазы на Rush Coin и покупайте в магазине.',
      '',
      'Нажмите кнопку ниже, чтобы начать 👇',
    ].join('\n'),
    open_app: '♟ ИГРАТЬ',
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