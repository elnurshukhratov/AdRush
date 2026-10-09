'use strict';

const { z } = require('zod');
const config = require('../../config');
const { asyncHandler } = require('../../utils/apiError');
const { createTtlCache } = require('../../utils/ttlCache');
const { getActive, getActiveById, toPublic } = require('../../services/competition/competitionService');
const { getTop, getUserStats } = require('../../services/leaderboard/leaderboardService');

const cfg = config.leaderboard;
const topCache = createTtlCache({ ttlMs: cfg.cacheTtlMs });

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(cfg.maxLimit).default(cfg.defaultLimit),
    competitionId: z.coerce.number().int().positive().optional(), // bo'lmasa — eng yaqin tugaydigan faol chempionat
  })
  .strict();

/**
 * GET /api/leaderboard/current?limit=10&competitionId=<id>
 * TOP ro'yxati hamma uchun bir xil (keshlanadi); `me` va `isMe` esa faqat so'rovchining o'ziga tegishli.
 * Faqat public maydonlar: rank, username, firstName, validAds (+ ixtiyoriy telegramId).
 */
const current = asyncHandler(async (req, res) => {
  const { limit, competitionId } = querySchema.parse(req.query);
  const competition = competitionId ? await getActiveById(competitionId) : await getActive();

  if (!competition) {
    res.set('Cache-Control', 'private, no-cache');
    return res.json({ success: true, competition: null, leaderboard: [], me: { validAds: 0, rank: null }, refreshAfterSec: cfg.refreshIntervalSec });
  }

  const [top, mine] = await Promise.all([
    topCache.wrap(`${competition.id}:${limit}`, () => getTop(competition.id, limit)),
    getUserStats(req.auth.user.id, competition.id),
  ]);

  const myTelegramId = req.auth.telegramId.toString();

  // ETag (Express avtomatik) o'zgarmagan javobga 304 beradi — polling arzon bo'ladi
  res.set('Cache-Control', 'private, no-cache');
  return res.json({
    success: true,
    competition: toPublic(competition),
    leaderboard: top.map((r) => ({
      rank: r.rank,
      ...(cfg.exposeTelegramId ? { telegramId: r.telegramId } : {}),
      username: r.username,
      firstName: r.firstName,
      validAds: r.validAds,
      isMe: r.telegramId === myTelegramId,
    })),
    me: { validAds: mine.validAds, rank: mine.rank },
    refreshAfterSec: cfg.refreshIntervalSec,
  });
});

/** Foydalanuvchi bloklanganda/ochilganda TOP ro'yxati darhol yangilansin. */
function invalidateLeaderboardCache() {
  topCache.clear();
}

module.exports = { current, invalidateLeaderboardCache };