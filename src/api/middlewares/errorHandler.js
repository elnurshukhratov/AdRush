'use strict';

const { ZodError } = require('zod');
const logger = require('../../utils/logger');
const { ApiError } = require('../../utils/apiError');
const { isDbUnavailable, isUniqueViolation } = require('../../utils/dbErrors');

/**
 * Standart API xato formati (barcha endpointlar uchun bir xil):
 *   { success: false, reason: "<KOD>", message: "<foydalanuvchiga xabar>", requestId: "<id>" }
 * ApiError.extra bo'lsa (masalan SUBSCRIPTION_REQUIRED da `channel`) shu maydonlar ham qo'shiladi.
 * Ichki xato tafsilotlari (stack, SQL) HECH QACHON klientga qaytmaydi — faqat logga.
 */
function body(req, reason, message, extra) {
  return { success: false, ...(extra || {}), reason, message, requestId: req.id };
}

function notFound(req, res) {
  res.status(404).json(body(req, 'NOT_FOUND', 'Topilmadi'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return undefined;

  if (err instanceof ApiError) {
    return res.status(err.status).json(body(req, err.reason, err.message, err.extra));
  }
  if (err instanceof ZodError) {
    return res.status(400).json(body(req, 'INVALID_REQUEST', 'So\'rov noto\'g\'ri'));
  }
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    const tooLarge = err.type === 'entity.too.large';
    return res
      .status(tooLarge ? 413 : 400)
      .json(body(req, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', 'So\'rov noto\'g\'ri'));
  }

  // Database xatolari
  if (isDbUnavailable(err)) {
    logger.error({ err, requestId: req.id }, 'Database mavjud emas');
    res.set('Retry-After', '5');
    return res.status(503).json(body(req, 'SERVICE_UNAVAILABLE', 'Xizmat vaqtincha mavjud emas. Birozdan so\'ng urinib ko\'ring.'));
  }
  if (isUniqueViolation(err)) {
    // Kutilmagan unique to'qnashuv (servislar buni o'zi boshqaradi) — 409, lekin loglanadi
    logger.warn({ err, requestId: req.id }, 'Kutilmagan unique constraint to\'qnashuvi');
    return res.status(409).json(body(req, 'CONFLICT', 'So\'rov to\'qnashuvi. Qayta urinib ko\'ring.'));
  }

  logger.error({ err, requestId: req.id }, 'Express xatosi');
  return res.status(500).json(body(req, 'INTERNAL_ERROR', 'Ichki xatolik. Keyinroq urinib ko\'ring.'));
}

module.exports = { notFound, errorHandler };