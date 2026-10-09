'use strict';

const { prisma } = require('../../db/prisma');
const { SUPPORTED_LANGS, isLang } = require('../../bot/i18n');

/**
 * Telegram foydalanuvchisini DBga sinxronlaydi.
 * Mavjud bo'lsa qayta yaratmaydi — faqat yangilaydi (upsert).
 * force=true bo'lsa (masalan /start) o'zgarish bo'lmasa ham update qiladi.
 * DIQQAT: `language` maydoniga tegmaydi (username/ism yangilanganda til o'chib ketmasin).
 */
async function syncFromTelegram(from, { force = false } = {}) {
  const telegramId = BigInt(from.id);
  const username = from.username || null;
  const firstName = from.first_name || null;

  if (!force) {
    const existing = await prisma.user.findUnique({ where: { telegramId } });
    if (existing && existing.username === username && existing.firstName === firstName) {
      return existing;
    }
  }

  return prisma.user.upsert({
    where: { telegramId },
    update: { username, firstName },
    create: { telegramId, username, firstName },
  });
}

/**
 * Userni DBda ta'minlaydi va yangi yaratilgan-yaratilmaganini aytadi: { user, created }.
 * Bot userSync middleware'i shu orqali "yangi user" belgisini oladi (referral faqat yangi user uchun).
 * Parallel update'larda unique to'qnashuvi bo'lsa mavjud userni qaytaradi (created=false).
 */
async function ensureUser(from) {
  const telegramId = BigInt(from.id);
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) return { user: await syncFromTelegram(from), created: false };

  try {
    const user = await prisma.user.create({
      data: { telegramId, username: from.username || null, firstName: from.first_name || null },
    });
    return { user, created: true };
  } catch (err) {
    if (err && err.code === 'P2002') return { user: await syncFromTelegram(from), created: false };
    throw err;
  }
}

async function findByTelegramId(telegramId) {
  return prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
}

function badLanguage(lang) {
  const err = new Error(`BAD_LANGUAGE: ${String(lang)}. Ruxsat etilgan: ${SUPPORTED_LANGS.join(' | ')}`);
  err.code = 'BAD_LANGUAGE';
  return err;
}

/**
 * Userning tilini yozadi (uz|en|ru). Noto'g'ri qiymatda DB ga murojaat qilmasdan BAD_LANGUAGE xatosi tashlanadi.
 * Qaytadi: yangilangan user.
 */
async function setLanguage(userId, lang) {
  if (!isLang(lang)) throw badLanguage(lang);
  return prisma.user.update({ where: { id: userId }, data: { language: lang } });
}

/**
 * Tilni FAQAT hali tanlanmagan bo'lsa (language = NULL) yozadi — bot'dagi til tanlash tugmalari uchun.
 * Bir tugma ikki marta bosilsa yoki eski tugma bosilsa, mavjud til o'zgarmaydi.
 * Qaytadi: { user, changed } — changed=true bo'lsa aynan shu chaqiruv tilni yozdi.
 */
async function setLanguageIfUnset(userId, lang) {
  if (!isLang(lang)) throw badLanguage(lang);
  const res = await prisma.user.updateMany({ where: { id: userId, language: null }, data: { language: lang } });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return { user, changed: res.count === 1 };
}

module.exports = { syncFromTelegram, ensureUser, findByTelegramId, setLanguage, setLanguageIfUnset };