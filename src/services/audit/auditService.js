'use strict';

const { prisma } = require('../../db/prisma');
const logger = require('../../utils/logger');

function toJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Audit yozuvi. `client` sifatida tranzaksiya (tx) berilsa, yozuv o'sha tranzaksiya bilan atomik saqlanadi.
 * Faqat qo'shiladi — o'zgartirilmaydi va o'chirilmaydi.
 */
async function record(action, { actorTelegramId = null, entityType = null, entityId = null, details } = {}, client = prisma) {
  return client.auditLog.create({
    data: {
      action,
      actorTelegramId: actorTelegramId == null ? null : BigInt(actorTelegramId),
      entityType,
      entityId: entityId == null ? null : String(entityId),
      details: toJson(details),
    },
  });
}

/** Asosiy oqimni buzmasligi kerak bo'lgan joylar uchun (xato faqat logga yoziladi). */
async function recordSafe(action, payload) {
  try {
    await record(action, payload);
  } catch (err) {
    logger.error({ err, action }, 'Audit yozuvini saqlab bo\'lmadi');
  }
}

module.exports = { record, recordSafe };
