'use strict';

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Ixtiyoriy Redis (REDIS_URL bo'lsa). Hozir faqat API rate limit uchun umumiy store sifatida ishlatiladi:
 * bir nechta app instansiyasi ishlaganda limitlar umumiy bo'lishi uchun.
 * Redis ishlamay qolsa API YIQILMAYDI: rate limit instansiya ichidagi xotiraga qaytmaydi, balki
 * limiter xatoni o'tkazib yuboradi (fail-open) — qolgan himoyalar (initData, session, cooldown, unique) ishlayveradi.
 */
let client = null;
let lastErrorLogAt = 0;

function getRedis() {
  if (!config.redisUrl) return null;
  if (client) return client;

  const IORedis = require('ioredis');
  client = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false, // ulanish yo'q paytda buyruqlar navbatda to'planib qolmasin
    retryStrategy: (times) => Math.min(times * 200, 5000),
    connectTimeout: 5000,
  });

  client.on('ready', () => logger.info('Redis ulandi'));
  client.on('error', (err) => {
    // Qayta ulanish urinishlarida log to'lib ketmasligi uchun 30 soniyada bir marta
    const now = Date.now();
    if (now - lastErrorLogAt > 30_000) {
      lastErrorLogAt = now;
      logger.warn({ err: err.message }, 'Redis xatosi');
    }
  });
  return client;
}

/** 'disabled' | 'ok' | 'down' */
async function redisStatus() {
  const r = getRedis();
  if (!r) return 'disabled';
  try {
    const pong = await Promise.race([
      r.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
    return pong === 'PONG' ? 'ok' : 'down';
  } catch (_e) {
    return 'down';
  }
}

async function disconnectRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch (_e) {
    client.disconnect();
  }
  client = null;
  logger.info('Redis uzildi');
}

module.exports = { getRedis, redisStatus, disconnectRedis };
