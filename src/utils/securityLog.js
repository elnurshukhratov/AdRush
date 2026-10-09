'use strict';

const logger = require('./logger');
const { recordSafe } = require('../services/audit/auditService');

// DB ni to'ldirib yubormaslik uchun: har bir tur bo'yicha daqiqada ko'pi bilan MAX_PER_MIN ta yozuv saqlanadi
// (qolganlari faqat logga ketadi).
const MAX_PER_MIN = 30;
const windows = new Map(); // type -> { start, count }

function allowPersist(type) {
  const now = Date.now();
  const w = windows.get(type);
  if (!w || now - w.start >= 60_000) {
    windows.set(type, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= MAX_PER_MIN;
}

/**
 * Shubhali activity: logga yoziladi va audit jadvaliga saqlanadi (action = SUSPICIOUS:<type>).
 * type: BAD_INITDATA, CLAIM_TOO_FAST, FOREIGN_SESSION, BAD_CALLBACK_TOKEN, ADMIN_ACCESS_DENIED ...
 * details.telegramId bo'lsa actorTelegramId sifatida saqlanadi.
 */
function logSuspicious(type, details = {}) {
  logger.warn({ event: 'suspicious_activity', type, ...details }, `Shubhali activity: ${type}`);

  if (!allowPersist(type)) return;
  const tid = details.telegramId;
  recordSafe(`SUSPICIOUS:${type}`, {
    actorTelegramId: typeof tid === 'string' && /^\d{1,15}$/.test(tid) ? tid : null,
    entityType: 'security',
    details,
  });
}

module.exports = { logSuspicious };
