'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { record } = require('../audit/auditService');

const CLOSE_TX_OPTS = Object.freeze({ maxWait: 10_000, timeout: 60_000 });

/**
 * Competition tikishlarini hal qiladi (closeCompetition tranzaksiyasi ichida, competition qatori FOR UPDATE qulfida).
 *  - Sovrin olgan (Winner) userlarning ACTIVE betlari -> WON (sovrin beriladi, coin qaytarilmaydi)
 *  - Qolgan hamma ACTIVE bet -> LOST, refundAmount = amount * pct / 100 (butun songa pastga yaxlitlanadi)
 *  - Refund ledger'ga LOSS_REFUND:<betId> kaliti bilan yoziladi (UNIQUE + ON CONFLICT DO NOTHING) va balansga qo'shiladi:
 *    competition faqat bir marta ACTIVE -> ENDED bo'lgani va betlar ACTIVE dan faqat bir marta chiqqani uchun refund ikki marta berilmaydi.
 * To'plamli (set-based) SQL: ko'p betda ham bitta tranzaksiya ichida tez ishlaydi.
 */
async function resolveBets(tx, competitionId, now) {
  const pct = config.rush.lossRefundPercent;

  const won = await tx.$executeRaw`
    UPDATE "CompetitionBet" b
    SET "status" = 'WON'::"BetStatus", "resolvedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    FROM "Winner" w
    WHERE b."competitionId" = ${competitionId} AND b."status" = 'ACTIVE'::"BetStatus"
      AND w."competitionId" = b."competitionId" AND w."userId" = b."userId"`;

  const lost = await tx.$executeRaw`
    UPDATE "CompetitionBet"
    SET "status" = 'LOST'::"BetStatus",
        "refundAmount" = (("amount"::bigint * ${pct}::int) / 100)::int,
        "resolvedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE "competitionId" = ${competitionId} AND "status" = 'ACTIVE'::"BetStatus"`;

  const rows = await tx.$queryRaw`
    WITH ins AS (
      INSERT INTO "CoinTransaction" ("userId", "amount", "type", "idempotencyKey", "refType", "refId", "competitionId", "createdAt")
      SELECT b."userId", b."refundAmount", 'LOSS_REFUND'::"CoinTxType", 'LOSS_REFUND:' || b."id"::text, 'bet', b."id"::text, b."competitionId", (${now}::timestamptz AT TIME ZONE 'UTC')
      FROM "CompetitionBet" b
      WHERE b."competitionId" = ${competitionId} AND b."status" = 'LOST'::"BetStatus" AND b."refundAmount" > 0
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING "userId", "amount"
    ), per_user AS (
      SELECT "userId", SUM("amount")::bigint AS total FROM ins GROUP BY "userId"
    ), upd AS (
      UPDATE "User" u SET "rushCoins" = u."rushCoins" + per_user.total, "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
      FROM per_user WHERE u."id" = per_user."userId"
      RETURNING u."id"
    )
    SELECT (SELECT COUNT(*) FROM upd)::int AS "users", COALESCE((SELECT SUM(total) FROM per_user), 0)::bigint AS "total"`;

  const r = rows[0] || {};
  return {
    percent: pct,
    wonBets: Number(won),
    lostBets: Number(lost),
    refundedUsers: Number(r.users || 0),
    refundedTotal: Number(r.total || 0),
  };
}

/**
 * Competition ni tugatadi (ACTIVE -> ENDED), idempotent. Hammasi BITTA tranzaksiyada:
 *  1. Competition qatori FOR UPDATE — reward tranzaksiyalari (FOR SHARE) tugaguncha kutiladi,
 *     tugagandan keyin esa yangi reward o'tmaydi (rewardCore.isCompetitionOpen status=ACTIVE talab qiladi)
 *  2. status = ENDED, lockedAt (qo'lda erta tugatilsa endAt ham hozirgi vaqtga tushiriladi)
 *  3. Yakuniy rank hamma ishtirokchiga MonthlyStat.rank ga yoziladi (bloklanmaganlar, validAds > 0)
 *  4. Faol (ACTIVE) sovrinlar place bo'yicha shu o'rindagi ishtirokchiga Winner sifatida biriktiriladi
 *     (sovrin nomi snapshot sifatida Winner.prize ga yoziladi)
 *  5. Tikishlar (CompetitionBet) hal qilinadi (resolveBets): sovrin olganlarniki WON, qolganlariniki LOST va
 *     tikilgan summaning LOSS_REFUND_PERCENT (30%) i Rush Coin sifatida qaytariladi — hammasi shu tranzaksiyada
 *  6. Audit log (shu tranzaksiya ichida)
 * Keyingi competition AVTOMATIK ochilmaydi — admin o'zi yaratadi.
 * Qayta chaqirilsa { ok:false, reason:'NOT_ACTIVE' } qaytadi va hech narsa o'zgarmaydi.
 * Eski ma'lumotlar (AdReward/MonthlyStat/Winner) hech qachon o'chirilmaydi.
 */
async function closeCompetition(competitionId, { actorTelegramId = null, auto = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "id", "title", "year", "month", "endAt", "status"::text AS "status"
      FROM "MonthlyCompetition"
      WHERE "id" = ${competitionId}
      FOR UPDATE`;
    const c = rows[0];
    if (!c) return { ok: false, reason: 'NOT_FOUND' };
    if (c.status !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE', competition: c };

    const now = new Date();
    await tx.monthlyCompetition.update({
      where: { id: c.id },
      data: { status: 'ENDED', lockedAt: now, endAt: c.endAt > now ? now : c.endAt },
    });

    // Final rank: validAds kamayish, tenglikda avval yetgan (updatedAt), keyin id.
    // Raw SQL: Prisma @updatedAt ni teginmaydi, shuning uchun tie-break vaqti buzilmaydi.
    await tx.$executeRaw`
      WITH ranked AS (
        SELECT s."id", ROW_NUMBER() OVER (ORDER BY s."validAds" DESC, s."updatedAt" ASC, s."id" ASC) AS rn
        FROM "MonthlyStat" s
        JOIN "User" u ON u."id" = s."userId"
        WHERE s."competitionId" = ${c.id} AND s."validAds" > 0 AND u."isBlocked" = false
      )
      UPDATE "MonthlyStat" m
      SET "rank" = ranked.rn::int
      FROM ranked
      WHERE m."id" = ranked.id`;

    const prizes = await tx.prize.findMany({ where: { competitionId: c.id, status: 'ACTIVE' }, orderBy: { place: 'asc' } });
    const maxPlace = prizes.length ? Math.max(...prizes.map((p) => p.place)) : 0;

    const top = maxPlace
      ? await tx.monthlyStat.findMany({
          where: { competitionId: c.id, rank: { gte: 1, lte: maxPlace } },
          orderBy: { rank: 'asc' },
          select: { rank: true, validAds: true, user: { select: { id: true, telegramId: true, username: true, firstName: true } } },
        })
      : [];
    const byRank = new Map(top.map((t) => [t.rank, t]));

    // Sovrin place = reytingdagi o'rin. O'sha o'rinda ishtirokchi bo'lmasa sovrin g'olibsiz qoladi.
    const matched = prizes.filter((p) => byRank.has(p.place)).map((p) => ({ prize: p, stat: byRank.get(p.place) }));

    if (matched.length > 0) {
      await tx.winner.createMany({
        data: matched.map(({ prize, stat }) => ({
          competitionId: c.id,
          userId: stat.user.id,
          place: prize.place,
          prizeId: prize.id,
          prize: prize.title,
        })),
      });
    }

    // Tikishlar: g'oliblar aniqlangandan KEYIN (WON/LOST shunga bog'liq), audit'dan OLDIN
    const bets = await resolveBets(tx, c.id, now);

    const participants = await tx.monthlyStat.count({ where: { competitionId: c.id, rank: { not: null } } });

    const winners = matched.map(({ prize, stat }) => ({
      place: prize.place,
      userId: stat.user.id,
      telegramId: stat.user.telegramId.toString(),
      username: stat.user.username,
      firstName: stat.user.firstName,
      validAds: stat.validAds,
      prize: prize.title,
    }));

    await record(
      'COMPETITION_CLOSED',
      {
        actorTelegramId,
        entityType: 'competition',
        entityId: c.id,
        details: {
          auto,
          title: c.title,
          participants,
          prizeCount: prizes.length,
          bets,
          winners: winners.map((w) => ({ place: w.place, userId: w.userId, validAds: w.validAds, prize: w.prize })),
        },
      },
      tx,
    );

    return {
      ok: true,
      competition: { id: c.id, title: c.title, year: c.year, month: c.month },
      winners,
      participants,
      bets,
    };
  }, CLOSE_TX_OPTS);
}

module.exports = { closeCompetition };
