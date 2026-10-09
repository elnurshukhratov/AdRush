'use strict';

/**
 * Botdan foydalanuvchiga boradigan barcha matnlar — 3 tilda (uz | en | ru).
 * Adminlarga boradigan xabarlar (notifications.js) bu yerda EMAS: ular o'zbekcha qoladi.
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
      '🏆 <b>AdRush</b>',
      '',
      'Har oy yangi chempionatlar.',
      '',
      'Rush Coin to\'plang va o\'zingiz',
      'xohlagan chempionatlarda qatnashing.',
      '',
      '🏆 Faol chempionatlar',
      '🥇 Reyting va sovrinlar',
      '🪙 Rush Coin tizimi',
      '👥 Do\'stlarni taklif qilish',
      '',
      'Boshlash uchun pastdagi tugmani bosing 👇',
    ].join('\n'),
    open_app: '🚀 ILOVANI OCHISH',
    referral_new: '🎁 <b>Yangi referal!</b>\n{who} havolangiz orqali qo\'shildi.\n💰 +{reward} Rush Coin',
    user_fallback: 'Foydalanuvchi',
    blocked: '⛔ Sizning akkauntingiz cheklangan. Savol bo\'lsa administratorga murojaat qiling.',
  },
  en: {
    pick_language: '🌐 Tilni tanlang / Choose language / Выберите язык',
    welcome: [
      '🏆 <b>AdRush</b>',
      '',
      'New championships every month.',
      '',
      'Collect Rush Coin and enter',
      'the championships you choose.',
      '',
      '🏆 Active championships',
      '🥇 Leaderboards and prizes',
      '🪙 Rush Coin system',
      '👥 Invite your friends',
      '',
      'Tap the button below to get started 👇',
    ].join('\n'),
    open_app: '🚀 OPEN APP',
    referral_new: '🎁 <b>New referral!</b>\n{who} joined via your link.\n💰 +{reward} Rush Coin',
    user_fallback: 'User',
    blocked: '⛔ Your account has been restricted. If you have any questions, please contact the administrator.',
  },
  ru: {
    pick_language: '🌐 Tilni tanlang / Choose language / Выберите язык',
    welcome: [
      '🏆 <b>AdRush</b>',
      '',
      'Каждый месяц новые чемпионаты.',
      '',
      'Собирайте Rush Coin и участвуйте',
      'в выбранных вами чемпионатах.',
      '',
      '🏆 Активные чемпионаты',
      '🥇 Рейтинг и призы',
      '🪙 Система Rush Coin',
      '👥 Приглашайте друзей',
      '',
      'Нажмите кнопку ниже, чтобы начать 👇',
    ].join('\n'),
    open_app: '🚀 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
    referral_new: '🎁 <b>Новый реферал!</b>\n{who} пришёл по вашей ссылке.\n💰 +{reward} Rush Coin',
    user_fallback: 'Пользователь',
    blocked: '⛔ Ваш аккаунт ограничен. Если есть вопросы, обратитесь к администратору.',
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