'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { lockUser } = require('../../utils/dbLock');
const { applyCoins, COIN_TX } = require('../coins/coinService');
const { getActiveById } = require('./competitionService');
const { fail, isCompetitionOpen, TX_OPTS } = require('../rewards/rewardCore');

/** Tranzaksiyani rollback qilib, aniq natija qaytarish uchun. */
class TxAbort extends Error {
  constructor(result) {
    super(result.reason);
    this.result = result;
  }
}

function toPublicBet(b) {
  return {
    id: b.id.toString(),
    competitionId: b.competitionId,
    amount: b.amount,
    status: b.status,
    refundAmount: b.refundAmount,
    createdAt: b.createdAt.toISOString(),
    resolvedAt: b.resolvedAt ? b.resolvedAt.toISOString() : null,
  };
}

/**
 * POST /api/competition/bet — foydalanuvchi o'z xohishi bilan TANLAGAN faol chempionatga Rush Coin tikadi.
 * `amount` va `requestId` faqat klientdan; balans va limitlar HAR DOIM DB'dan tekshiriladi.
 * Bitta tranzaksiya (+ user bo'yicha advisory lock):
 *   competition ochiqmi (FOR SHARE) -> faol betlar limiti -> bet yaratish -> balansdan yechish (ledger) -> competition balli (+amount)
 * Biror qadam yiqilsa hammasi rollback. requestId berilsa, bir xil so'rov ikki marta bet yaratmaydi (DUPLICATE_REQUEST).
 */
async function placeBet(user, amount, requestId = null, competitionId) {
  const competition = Number.isInteger(competitionId) ? await getActiveById(competitionId) : null;
  if (!competition) return fail('NO_ACTIVE_COMPETITION');

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);
      const now = new Date();

      if (!(await isCompetitionOpen(tx, competition.id, now))) throw new TxAbort(fail('COMPETITION_CLOSED'));

      // Faol tikishlar limiti HAR BIR chempionat uchun alohida (bir nechta chempionat bir vaqtda ochiq)
      const active = await tx.competitionBet.count({ where: { userId: user.id, competitionId: competition.id, status: 'ACTIVE' } });
      if (active >= config.rush.maxActiveBets) {
        throw new TxAbort(fail('MAX_ACTIVE_BETS', { maxActiveBets: config.rush.maxActiveBets }));
      }

      const bet = await tx.competitionBet.create({
        data: { userId: user.id, competitionId: competition.id, amount },
      });

      const debit = await applyCoins(tx, {
        userId: user.id,
        amount: -amount,
        type: COIN_TX.COMPETITION_BET,
        idempotencyKey: `COMPETITION_BET:${requestId || bet.id}`,
        refType: 'bet',
        refId: bet.id,
        competitionId: competition.id,
      });
      if (!debit.ok) throw new TxAbort(fail('INSUFFICIENT_FUNDS', { rushCoins: await currentBalance(tx, user.id) }));

      // Competition balli = tikilgan coin yig'indisi (atomik increment)
      const stat = await tx.monthlyStat.upsert({
        where: { userId_competitionId: { userId: user.id, competitionId: competition.id } },
        create: { userId: user.id, competitionId: competition.id, validAds: amount },
        update: { validAds: { increment: amount } },
        select: { validAds: true },
      });

      return {
        success: true,
        bet: toPublicBet(bet),
        rushCoins: debit.balance,
        staked: stat.validAds,
        competitionId: competition.id,
        activeBets: active + 1,
        maxActiveBets: config.rush.maxActiveBets,
      };
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    if (err && err.code === 'P2002' && String(err.meta && err.meta.target).includes('idempotencyKey')) {
      return fail('DUPLICATE_REQUEST');
    }
    throw err;
  }
}

async function currentBalance(tx, userId) {
  const row = await tx.user.findUnique({ where: { id: userId }, select: { rushCoins: true } });
  return row ? row.rushCoins : 0;
}

/** Foydalanuvchining oxirgi betlari (yangisi birinchi). */
async function listMyBets(userId, limit = 20) {
  const rows = await prisma.competitionBet.findMany({
    where: { userId },
    orderBy: { id: 'desc' },
    take: limit,
  });
  return rows.map(toPublicBet);
}

/** Foydalanuvchining faol betlari soni va jami tikilgan miqdori. */
async function getActiveBetSummary(userId, competitionId = null) {
  const agg = await prisma.competitionBet.aggregate({
    where: { userId, status: 'ACTIVE', ...(Number.isInteger(competitionId) ? { competitionId } : {}) },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return { activeBets: agg._count._all, activeStaked: agg._sum.amount || 0, maxActiveBets: config.rush.maxActiveBets };
}

module.exports = { placeBet, listMyBets, getActiveBetSummary, toPublicBet };