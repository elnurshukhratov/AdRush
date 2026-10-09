'use strict';

const { z } = require('zod');
const { asyncHandler, ApiError } = require('../../utils/apiError');
const { getActive, getActiveById, toPublic } = require('../../services/competition/competitionService');
const { getUserStats } = require('../../services/leaderboard/leaderboardService');
const { getAdminRole } = require('../../services/admin/adminService');
const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { getBalance } = require('../../services/coins/coinService');
const { getActiveBetSummary } = require('../../services/competition/betService');
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
 * validAds — competition balli (tikilgan Rush Coin yig'indisi, nomi tarixiy); rushCoins — balans (DB'dan).
 */
const myStats = asyncHandler(async (req, res) => {
  const userId = req.auth.user.id;
  const { competitionId } = z.object({ competitionId: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
  // Bir vaqtda bir nechta faol chempionat: statistika so'ralgan chempionat bo'yicha (bo'lmasa birinchisi)
  const competition = competitionId ? await getActiveById(competitionId) : await getActive();
  const [s, rushCoins, adsWatched, referrals, bets] = await Promise.all([
    competition ? getUserStats(userId, competition.id) : { validAds: 0, rank: null, nextRank: null, adsToNextRank: null },
    getBalance(userId),
    prisma.adReward.count({ where: { userId } }),
    prisma.user.count({ where: { referredByUserId: userId } }),
    getActiveBetSummary(userId, competition ? competition.id : null),
  ]);

  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    rushCoins,
    adsWatched, // jami valid reklamalar (Rush Coin bergan)
    adReward: config.rush.adReward,
    referrals,
    activeBets: bets.activeBets,
    activeStaked: bets.activeStaked,
    maxActiveBets: bets.maxActiveBets,
    validAds: s.validAds,
    rank: s.rank,
    competition: competition ? toPublic(competition) : null,
    nextRank: s.nextRank,
    adsToNextRank: s.adsToNextRank,
  });
});

module.exports = { me, setMyLanguage, myStats };