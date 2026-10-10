'use strict';

/**
 * AdsGram integratsiya qatlami.
 *
 * RASMIY HUJJATDAN (docs.adsgram.ai) TASDIQLANGANLAR:
 *  - Klient: window.Adsgram.init({ blockId }) -> AdController.show() ad oxirigacha ko'rilsa resolve bo'ladi
 *    (result: { done, description, state, error }). Reward/event ID yoki imzo QAYTARILMAYDI.
 *  - Server tasdig'i ("Reward URL", ixtiyoriy): klient reward olgach AdsGram sizning URL ga GET yuboradi.
 *    Shartlar: GET, HTTPS (443), URL ichida [userId] bo'lishi kerak — u foydalanuvchining Telegram ID si
 *    bilan almashtiriladi. Misol: https://test.adsgram.ai/reward?userid=[userId]
 *  - debug:true rejimida Reward URL ga so'rov YUBORILMAYDI va statistika hisoblanmaydi.
 *
 * HUJJATDA YO'Q (o'zimizdan to'qimadik — quyida alohida belgilangan):
 *  - Reward URL so'rovida imzo/HMAC, reward ID, nonce yoki timestamp haqida hech narsa yozilmagan.
 *  - AdsGram qaysi javobni (status/body) kutishi, xato bo'lganda retry qilish-qilmasligi.
 *  - AdsGram so'rov yuboradigan IP diapazonlari.
 *  Shu sababli Reward URL ga O'ZIMIZ maxfiy `token` query parametrini qo'yamiz (AdsGram kabinetida URL ga
 *  yoziladi). Bu AdsGram xususiyati EMAS — bizning himoya qatlamimiz.
 */

const crypto = require('crypto');
const config = require('../../config');
const { ApiError } = require('../../utils/apiError');
const { logSuspicious } = require('../../utils/securityLog');

function safeEqual(a, b) {
  // Uzunlik farqi orqali oqib ketmasligi uchun avval hash qilamiz
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/**
 * Reward URL so'rovi AdsGramdan kelganini tekshirish nuqtasi.
 * TODO(ADSGRAM-UNVERIFIED): AdsGram imzo yoki rasmiy IP ro'yxatini e'lon qilsa, shu funksiyada almashtiriladi.
 * Hozir: (1) bizning maxfiy token (majburiy), (2) ixtiyoriy IP allowlist.
 */
function verifyCallbackSource(req) {
  const token = req.query.token;
  if (typeof token !== 'string' || !config.adsgram.rewardToken || !safeEqual(token, config.adsgram.rewardToken)) {
    logSuspicious('BAD_CALLBACK_TOKEN', { ip: normalizeIp(req.ip) });
    throw new ApiError(403, 'FORBIDDEN', 'Ruxsat yo\'q');
  }

  const allow = config.adsgram.callbackIpAllowlist;
  if (allow.length > 0 && !allow.includes(normalizeIp(req.ip))) {
    logSuspicious('CALLBACK_IP_NOT_ALLOWED', { ip: normalizeIp(req.ip) });
    throw new ApiError(403, 'FORBIDDEN', 'Ruxsat yo\'q');
  }
}

/** Reward URL query dan Telegram ID ni oladi: ?userid=<telegramId> (hujjatdagi [userId] o'rniga). */
function parseRewardCallback(req) {
  const raw = req.query.userid;
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'userid noto\'g\'ri');
  }
  return BigInt(raw);
}

/** Mine App ga kerakli AdsGram sozlamalari (blockId ommaviy ma'lumot). */
function getClientConfig() {
  return {
    blockId: config.adsgram.blockId || null,
    blockIds: config.adsgram.blockIds,
    verifyMode: config.adsgram.verifyMode,
  };
}

module.exports = { verifyCallbackSource, parseRewardCallback, getClientConfig };