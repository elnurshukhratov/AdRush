'use strict';

const { z } = require('zod');
const config = require('../../config');
const { asyncHandler } = require('../../utils/apiError');
const { createTtlCache } = require('../../utils/ttlCache');
const { listActive, toPublic, countParticipants } = require('../../services/competition/competitionService');
const { getUserStats } = require('../../services/leaderboard/leaderboardService');
const { getActivePrizes, toPublicPrize } = require('../../services/competition/prizeService');
const { publicHistory } = require('../../services/competition/winnerService');
const { getClientConfig } = require('../../services/adsgram/adsgramService');
const { placeBet, listMyBets, getActiveBetSummary } = require('../../services/competition/betService');
const { getBalance } = require('../../services/coins/coinService');

const BET_REASON_STATUS = Object.freeze({
  NO_ACTIVE_COMPETITION: 409,
  COMPETITION_CLOSED: 409,
  MAX_ACTIVE_BETS: 409,
  INSUFFICIENT_FUNDS: 402,
  DUPLICATE_REQUEST: 409,
});

// Faqat `amount` (va ixtiyoriy requestId) qabul qilinadi: userId/telegramId/balance bodyda KERAK EMAS va ishlatilmaydi
const betSchema = z
  .object({
    amount: z.number().int().min(config.rush.minBet).max(config.rush.maxBet),
    competitionId: z.number().int().positive(), // qaysi chempionatga tikilayotgani (bir vaqtda bir nechta faol)
    requestId: z.string().uuid().optional(),
  })
  .strict();

const metaCache = createTtlCache({ ttlMs: config.leaderboard.cacheTtlMs });
const historyCache = createTtlCache({ ttlMs: config.leaderboard.cacheTtlMs });

/** Admin competition/sovrin o'zgartirganda chaqiriladi: public javoblar eski holatda qolmasin. */
function invalidatePublicCache() {
  metaCache.clear();
  historyCache.clear();
}

/**
 * GET /api/competition/current — Mine App uchun: BARCHA faol chempionatlar (bir vaqtda bir nechta bo'lishi mumkin).
 * Har biri: nomi, sovrinlari (DB dan), 1-o'rin sovrini (firstPrize), ishtirokchilar, qolgan vaqt va foydalanuvchining
 * o'z natijasi (my). Pastdagi `competition`/`prizes`/`participants` — eski mijozlar uchun birinchi chempionat nusxasi.
 */
const current = asyncHandler(async (req, res) => {
  const base = await metaCache.wrap('champs', async () => {
    const list = await listActive();
    return Promise.all(
      list.map(async (c) => {
        const [prizes, participants] = await Promise.all([getActivePrizes(c.id), countParticipants(c.id)]);
        const pub = prizes.map(toPublicPrize);
        return { competition: c, prizes: pub, firstPrize: pub.find((p) => p.place === 1) || null, participants };
      }),
    );
  });

  // Foydalanuvchining o'z natijasi har bir chempionat bo'yicha (keshlanmaydi — har kim uchun boshqa)
  const mine = await Promise.all(base.map((b) => getUserStats(req.auth.user.id, b.competition.id)));

  const now = Date.now();
  const championships = base.map((b, i) => ({
    ...toPublic(b.competition),
    prizes: b.prizes,
    firstPrize: b.firstPrize,
    participants: b.participants,
    secondsLeft: Math.max(0, Math.floor((b.competition.endAt.getTime() - now) / 1000)),
    secondsToStart: Math.max(0, Math.floor((b.competition.startAt.getTime() - now) / 1000)),
    my: { validAds: mine[i].validAds, rank: mine[i].rank },
  }));
  const first = championships[0] || null;

  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    championships,
    competition: first ? toPublic(base[0].competition) : null,
    prizes: first ? first.prizes : [],
    participants: first ? first.participants : 0,
    secondsLeft: first ? first.secondsLeft : 0,
    secondsToStart: first ? first.secondsToStart : 0,
    serverTime: new Date(now).toISOString(),
    adsgram: { blockId: getClientConfig().blockId, quickBlockId: getClientConfig().quickBlockId },
    ads: { minDurationMs: config.ads.minDurationMs, cooldownMs: config.ads.cooldownMs },
    rush: {
      adReward: config.rush.adReward,
      referralReward: config.rush.referralReward,
      lossRefundPercent: config.rush.lossRefundPercent,
      maxActiveBets: config.rush.maxActiveBets,
      minBet: config.rush.minBet,
      maxBet: config.rush.maxBet,
    },
  });
});

/**
 * POST /api/competition/bet  body: { amount, competitionId, requestId? }
 * Rush Coin ni faqat foydalanuvchining O'ZI tikadi (avtomatik tikish yo'q). Balans/limit DB'dan tekshiriladi.
 */
const bet = asyncHandler(async (req, res) => {
  const { amount, competitionId, requestId } = betSchema.parse(req.body);
  const result = await placeBet(req.auth.user, amount, requestId || null, competitionId);
  res.set('Cache-Control', 'private, no-store');
  if (result.success) return res.json(result);
  return res.status(BET_REASON_STATUS[result.reason] || 400).json(result);
});

/** GET /api/competition/bets — o'z betlarim (oxirgi 20 ta) + faol betlar xulosasi + balans. */
const myBets = asyncHandler(async (req, res) => {
  const userId = req.auth.user.id;
  const { competitionId } = z.object({ competitionId: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
  const [bets, summary, rushCoins] = await Promise.all([listMyBets(userId, 20), getActiveBetSummary(userId, competitionId ?? null), getBalance(userId)]);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, rushCoins, ...summary, bets });
});

const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }).strict();

/** GET /api/competition/history — tugagan competitionlar va g'oliblari (public maydonlar). */
const history = asyncHandler(async (req, res) => {
  const { limit } = historyQuery.parse(req.query);
  const competitions = await historyCache.wrap(`h:${limit}`, () => publicHistory(limit));
  res.set('Cache-Control', 'private, no-cache');
  res.json({ success: true, competitions });
});

module.exports = { current, history, bet, myBets, invalidatePublicCache };