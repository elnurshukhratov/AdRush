'use strict';

/**
 * Standart API xatosi: { success: false, reason, message } formatida qaytadi.
 * `extra` (ixtiyoriy) — javobga qo'shiladigan qo'shimcha maydonlar (masalan { channel }).
 * extra success/reason/message/requestId ni o'zgartira olmaydi.
 */
class ApiError extends Error {
  constructor(status, reason, message, extra) {
    super(message || reason);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.extra = extra && typeof extra === 'object' ? extra : null;
  }
}

/** Async controllerlardagi xatolarni Express error handlerga uzatadi. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, asyncHandler };