'use strict';

const { asyncHandler, ApiError } = require('../../utils/apiError');
const { getAdminRole } = require('../../services/admin/adminService');
const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { getBalances } = require('../../services/coins/coinService');
const { setLanguage } = require('../../services/users/userService');
const { isLang } = require('../../bot/i18n');

/**
 * GET /api/users/me — kim ekanligim va rolim (frontend Admin bo'limini shu asosida ko'rsatadi).
 * Bu faqat UI uchun: haqiqiy ruxsat har bir /api/admin/* so'rovida serverda qayta tekshiriladi.
 */
const me = asyncHandler(async (req, res) => {
  const u = req.auth.user;
  const role = await getAdminRole(u.telegramId);
  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    user: { telegramId: u.telegramId.toString(), username: u.username, firstName: u.firstName },
    language: isLang(u.language) ? u.language : null, // uz | en | ru | null (hali tanlamagan)
    isAdmin: Boolean(role),
    role,
  });
});

/**
 * POST /api/users/me/language  { language: 'uz' | 'en' | 'ru' }
 * Foydalanuvchi FAQAT initData orqali aniqlanadi (body/URL dagi id ishlatilmaydi). Noto'g'ri qiymat — 400 BAD_LANGUAGE.
 * Til o'zgargach bot ham yangi tilda yozadi (bot har safar bazadagi User.language ni o'qiydi).
 */
const setMyLanguage = asyncHandler(async (req, res) => {
  const lang = req.body && req.body.language;
  if (!isLang(lang)) throw new ApiError(400, 'BAD_LANGUAGE', 'Til noto\'g\'ri');
  const user = await setLanguage(req.auth.user.id, lang);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, language: user.language });
});

/**
 * GET /api/users/me/stats
 * Foydalanuvchi faqat initData orqali aniqlanadi (URL/body dagi id ishlatilmaydi).
 * Balanslar (diamonds, rushCoins) va kurslar DB/configdan keladi.
 */
const myStats = asyncHandler(async (req, res) => {
  const userId = req.auth.user.id;
  const [balances, adsWatched, referrals] = await Promise.all([
    getBalances(userId),
    prisma.adReward.count({ where: { userId } }),
    prisma.user.count({ where: { referredByUserId: userId } }),
  ]);

  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    diamonds: balances.diamonds,
    rushCoins: balances.rushCoins,
    adsWatched, // jami valid reklamalar (olmos bergan)
    diamondPerAd: config.diamond.perAd,
    adSlots: config.ads.slots, // Vazifalardagi reklama kartalari soni
    convertRate: config.diamond.convert, // { diamonds, rush, stepDiamonds, stepRush }
    referralDiamondReward: config.diamond.referralReward,
    referrals,
  });
});

module.exports = { me, setMyLanguage, myStats };