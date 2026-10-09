'use strict';

const { ApiError } = require('../../utils/apiError');
const { logSuspicious } = require('../../utils/securityLog');
const { getAdminRole } = require('../../services/admin/adminService');

/**
 * telegramAuth DAN KEYIN ishlatiladi. Rolni HAR SAFAR serverda tekshiradi (initData -> telegramId -> .env/Admin jadvali).
 * Admin bo'lmaganga 403 Forbidden; urinish audit jurnaliga SUSPICIOUS:ADMIN_ACCESS_DENIED sifatida yoziladi.
 * Natija: req.auth.adminRole = 'SUPER_ADMIN' | 'ADMIN'
 */
async function requireAdmin(req, _res, next) {
  try {
    const role = await getAdminRole(req.auth.telegramId);
    if (!role) {
      logSuspicious('ADMIN_ACCESS_DENIED', {
        telegramId: req.auth.telegramId.toString(),
        method: req.method,
        path: String(req.originalUrl || req.url).split('?')[0],
        ip: req.ip,
      });
      throw new ApiError(403, 'FORBIDDEN', 'Ruxsat yo\'q');
    }
    req.auth.adminRole = role;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
