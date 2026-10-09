'use strict';

/**
 * Prisma xatolarini turiga qarab ajratadi. `instanceof` ishlatilmaydi (client generate qilinmagan
 * muhitda ham xavfsiz bo'lishi uchun) — err.name / err.code bo'yicha tekshiriladi.
 */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function isDbUnavailable(err) {
  if (!err) return false;
  if (err.name === 'PrismaClientInitializationError') return true;
  if (err.name === 'PrismaClientRustPanicError') return true;
  return err.name === 'PrismaClientKnownRequestError' && UNAVAILABLE_CODES.has(err.code);
}

function isUniqueViolation(err) {
  return !!err && err.name === 'PrismaClientKnownRequestError' && err.code === 'P2002';
}

function isNotFound(err) {
  return !!err && err.name === 'PrismaClientKnownRequestError' && err.code === 'P2025';
}

module.exports = { isDbUnavailable, isUniqueViolation, isNotFound };
