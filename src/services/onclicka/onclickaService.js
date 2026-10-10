'use strict';

/**
 * OnClickA (Telegram Mini App rewarded video) integratsiya qatlami.
 *
 * RASMIY HUJJATDAN (onclicka.com/help/publishers/video-how-to-integrate-the-code) TASDIQLANGANLAR:
 *  - Klient: <script src="https://js.onclckvd.com/in-stream-ad-admanager/tma.js"> yuklanadi,
 *    window.initCdTma({ id: <SPOT-ID> }) Promise qaytaradi -> show funksiyasi; show() Promise ko'rsatish muvaffaqiyatini bildiradi.
 *    SPOT-ID ni OnClickA account manager beradi.
 *  - Server tasdig'i ("How to confirm ad views"): siz handler URL beresiz; ko'rsatish muvaffaqiyatli qayd etilganda
 *    OnClickA backend shu URL ga GET yuboradi, URL ga ?USERID=<Telegram user id> qo'shiladi.
 *
 * HUJJATDA YO'Q (o'zimizdan to'qimadik — alohida belgilangan):
 *  - Imzo/HMAC, reward ID, nonce, timestamp, sessiya/ymid YO'Q: tasdiq faqat Telegram user ID ni olib keladi.
 *    Shuning uchun u AdsGram Reward URL kabi "zaif bog'lanish" (userid + vaqt oynasi) bilan sessiyaga ulanadi (rewardService).
 *  - Parametr nomi registri (USERID/userid) va javob formati hujjatda aniq emas — ikkala yozuvni qabul qilamiz, 200 qaytaramiz.
 *  - OnClickA "URL + ?USERID=" qo'shgani uchun maxfiy tokenni query ga qo'ya olmaymiz — uni URL YO'LIGA qo'yamiz:
 *    /api/onclicka/reward/<ONCLICKA_CALLBACK_TOKEN>. Bu OnClickA xususiyati EMAS — bizning himoya qatlamimiz.
 */

const { ApiError } = require('../../utils/apiError');
const { logSuspicious } = require('../../utils/securityLog');
const config = require('../../config');
const { safeEqual } = require('../adsgram/adsgramService');

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/** Token URL yo'lida (asosiy) yoki query da (zaxira) kelishi mumkin. */
function verifyCallbackSource(req) {
  const provided = typeof req.params.token === 'string' ? req.params.token : req.query.token;
  const expected = config.onclicka.callbackToken;
  if (typeof provided !== 'string' || !expected || !safeEqual(provided, expected)) {
    logSuspicious('BAD_CALLBACK_TOKEN', { provider: 'onclicka', ip: normalizeIp(req.ip) });
    throw new ApiError(403, 'FORBIDDEN', 'Ruxsat yo\'q');
  }
}

/** ?USERID=<telegramId> (registrdan qat'i nazar) -> BigInt. */
function parseCallbackUserId(req) {
  let raw;
  for (const [k, v] of Object.entries(req.query)) {
    if (k.toLowerCase() === 'userid' && typeof v === 'string') raw = v;
  }
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) throw new ApiError(400, 'INVALID_REQUEST', 'USERID noto\'g\'ri');
  return BigInt(raw);
}

module.exports = { verifyCallbackSource, parseCallbackUserId };