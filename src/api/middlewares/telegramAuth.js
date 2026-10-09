'use strict';

const crypto = require('crypto');
const config = require('../../config');
const { ApiError } = require('../../utils/apiError');
const { logSuspicious } = require('../../utils/securityLog');
const { syncFromTelegram } = require('../../services/users/userService');

// Telegram hujjati: secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
const SECRET_KEY = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
const MAX_FUTURE_SKEW_SEC = 60;

/**
 * Mini App initData ni tekshiradi (HMAC-SHA256). Muvaffaqiyatli bo'lsa { user, authDate } qaytaradi.
 * Xato bo'lsa { error } qaytaradi (sababi faqat logga yoziladi, klientga umumiy xabar ketadi).
 */
function validateInitData(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return { error: 'MALFORMED' };

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { error: 'NO_HASH' };
  params.delete('hash'); // HMAC usulida faqat `hash` chiqarib tashlanadi

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const expected = crypto.createHmac('sha256', SECRET_KEY).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'BAD_HASH' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { error: 'NO_AUTH_DATE' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (authDate > nowSec + MAX_FUTURE_SKEW_SEC) return { error: 'AUTH_DATE_IN_FUTURE' };
  if (nowSec - authDate > config.initDataMaxAgeSec) return { error: 'EXPIRED' };

  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch (_e) {
    return { error: 'BAD_USER_JSON' };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) return { error: 'BAD_USER' };

  return { user, authDate };
}

/**
 * Authorization: tma <initDataRaw>
 * Frontenddan kelgan userId/telegramId ga HECH QACHON ishonilmaydi — identifikatsiya faqat shu yerdan.
 * Natija: req.auth = { telegramId: bigint, user: <DB user> }
 */
async function telegramAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const m = /^tma\s+(.+)$/i.exec(header);
    if (!m) throw new ApiError(401, 'UNAUTHORIZED', 'Telegram orqali kiring');

    const result = validateInitData(m[1]);
    if (result.error) {
      logSuspicious('BAD_INITDATA', { reason: result.error, ip: req.ip });
      throw new ApiError(401, 'UNAUTHORIZED', 'Telegram orqali qayta kiring');
    }

    const dbUser = await syncFromTelegram(result.user);
    if (dbUser.isBlocked) throw new ApiError(403, 'USER_BLOCKED', 'Akkauntingiz cheklangan');

    req.auth = { telegramId: dbUser.telegramId, user: dbUser };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { telegramAuth, validateInitData };
