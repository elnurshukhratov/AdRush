'use strict';

/**
 * Bir userning reward operatsiyalarini tranzaksiya darajasida ketma-ket qiladi
 * (pg_advisory_xact_lock). Tranzaksiya tugagach lock o'zi bo'shaydi.
 * Parallel ikki request +1 ni ikki marta yozib yubormasligining birinchi qatlami;
 * ikkinchi qatlam — AdReward.externalRewardId UNIQUE constraint.
 */
async function lockUser(tx, telegramId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(telegramId)})`;
}

module.exports = { lockUser };
