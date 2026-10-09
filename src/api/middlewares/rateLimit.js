'use strict';

const { rateLimit } = require('express-rate-limit');
const { getRedis } = require('../../db/redis');

function handler(_req, res) {
  res.status(429).json({ success: false, reason: 'RATE_LIMITED', message: 'Juda ko\'p so\'rov. Birozdan so\'ng urinib ko\'ring.' });
}

/**
 * REDIS_URL sozlangan bo'lsa limitlar Redis'da (instansiyalar orasida umumiy), aks holda xotirada.
 * Har bir limiter o'z prefiksiga ega bo'lishi shart, aks holda hisoblagichlar aralashib ketadi.
 */
function makeStore(prefix) {
  const redis = getRedis();
  if (!redis) return undefined;
  const { RedisStore } = require('rate-limit-redis');
  return new RedisStore({
    prefix: `kolizey:rl:${prefix}:`,
    sendCommand: (...args) => redis.call(...args),
  });
}

function base(prefix) {
  return {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    store: makeStore(prefix),
    // Redis ishlamasa limiter so'rovni o'tkazib yuboradi (fail-open), 500 qaytarmaydi
    passOnStoreError: true,
    validate: { trustProxy: false }, // trust proxy ni TRUST_PROXY orqali o'zimiz boshqaramiz
  };
}

// IP bo'yicha umumiy limit (autentifikatsiyadan oldin)
const ipLimiter = rateLimit({ ...base('ip'), windowMs: 60_000, limit: 120 });

// Foydalanuvchi bo'yicha limit (telegramAuth dan KEYIN ishlatiladi). `name` — har bir endpoint uchun alohida hisoblagich.
const userLimiter = (limit, name = 'user') =>
  rateLimit({
    ...base(`u:${name}`),
    windowMs: 60_000,
    limit,
    keyGenerator: (req) => `u:${req.auth.telegramId}`,
  });

// AdsGram callback uchun alohida (AdsGram bitta IP dan ko'p so'rov yuborishi mumkin)
const callbackLimiter = rateLimit({ ...base('adsgram'), windowMs: 60_000, limit: 600 });

module.exports = { ipLimiter, userLimiter, callbackLimiter };
