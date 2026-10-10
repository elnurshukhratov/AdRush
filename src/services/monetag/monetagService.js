'use strict';

/**
 * Monetag (Telegram Mini App SDK) integratsiya qatlami.
 *
 * RASMIY HUJJATDAN (docs.monetag.com) TASDIQLANGANLAR:
 *  - Klient: SDK skripti (<script data-zone="ZONE" data-sdk="show_ZONE">) global show_ZONE(options) funksiyasini yaratadi.
 *    show_ZONE({ type: 'end', ymid, requestVar }) — Rewarded Interstitial. ymid — bizning hodisa/sessiya identifikatorimiz;
 *    faqat harf, raqam, - _ . (Monetag uni postback URL ga kodlamasdan qo'yadi). Har bir ko'rsatish uchun noyob bo'lishi tavsiya etiladi.
 *  - Reward postback (server-to-server GET): makrolar {ymid} {zone_id} {sub_zone_id} {request_var} {telegram_id}
 *    {event_type} (impression|click) {reward_event_type} (valued|non_valued) {estimated_price}.
 *    Postback URL Monetag SSP da asosiy SDK zonasi sozlamalarida kiritiladi. Server 200 qaytarmasa Monetag qayta urinadi.
 *  - impression va click bir xil ymid bilan keladi; "bitta ymid = bitta mukofot".
 *
 * HUJJATDA YO'Q (shuning uchun o'zimiz qo'shgan himoya):
 *  - Postbackda imzo/HMAC yo'q. Bizning maxfiy `token` query parametrimizni postback URL ga o'zimiz yozamiz.
 *    Bu Monetag xususiyati EMAS — bizning himoya qatlamimiz.
 *
 * Klientdagi show_ZONE() natijasi (reward_event_type) mukofot uchun ISHLATILMAYDI — faqat server postback.
 */

const { ApiError } = require('../../utils/apiError');
const { logSuspicious } = require('../../utils/securityLog');
const config = require('../../config');
const { safeEqual } = require('../adsgram/adsgramService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/** Postback bizning maxfiy tokenimiz bilan kelganini tekshiradi (Monetag imzo bermaydi). */
function verifyPostbackSource(req) {
  const token = req.query.token;
  const expected = config.monetag.postbackToken;
  if (typeof token !== 'string' || !expected || !safeEqual(token, expected)) {
    logSuspicious('BAD_CALLBACK_TOKEN', { provider: 'monetag', ip: normalizeIp(req.ip) });
    throw new ApiError(403, 'FORBIDDEN', 'Ruxsat yo\'q');
  }
}

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Postback query ni qat'iy tekshiradi. telegram_id bo'sh bo'lishi mumkin (Monetag bo'sh satr yuboradi) — u holda null.
 * ymid faqat bizning sessiya UUID imiz bo'lishi mumkin.
 */
function parsePostback(req) {
  const ymid = str(req.query.ymid);
  const zoneId = str(req.query.zone_id);
  const eventType = str(req.query.event_type);
  const rewardEventType = str(req.query.reward_event_type);
  const tg = str(req.query.telegram_id);

  if (!UUID_RE.test(ymid)) throw new ApiError(400, 'INVALID_REQUEST', 'ymid noto\'g\'ri');
  if (!/^\d{1,12}$/.test(zoneId)) throw new ApiError(400, 'INVALID_REQUEST', 'zone_id noto\'g\'ri');
  if (eventType !== 'impression' && eventType !== 'click') throw new ApiError(400, 'INVALID_REQUEST', 'event_type noto\'g\'ri');
  if (rewardEventType !== 'valued' && rewardEventType !== 'non_valued') {
    throw new ApiError(400, 'INVALID_REQUEST', 'reward_event_type noto\'g\'ri');
  }
  if (tg !== '' && !/^\d{1,15}$/.test(tg)) throw new ApiError(400, 'INVALID_REQUEST', 'telegram_id noto\'g\'ri');

  return { ymid: ymid.toLowerCase(), zoneId, eventType, rewardEventType, telegramId: tg === '' ? null : BigInt(tg) };
}

module.exports = { verifyPostbackSource, parsePostback };