'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Muhim environment o'zgaruvchisi yo'q: ${name} (.env faylni tekshiring)`);
  }
  return v.trim();
}

function parseIds(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

function parseList(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(name, def, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} noto'g'ri: butun son bo'lishi va >= ${min} bo'lishi kerak (hozir: "${raw}")`);
  }
  return n;
}

const nodeEnv = process.env.NODE_ENV || 'development';

const VERIFY_MODES = ['server_confirmed', 'client_session'];
const verifyMode = (process.env.ADSGRAM_VERIFY_MODE || 'server_confirmed').trim();
if (!VERIFY_MODES.includes(verifyMode)) {
  throw new Error(`ADSGRAM_VERIFY_MODE noto'g'ri: "${verifyMode}". Ruxsat etilgan: ${VERIFY_MODES.join(' | ')}`);
}

// TEST/DEVELOPMENT: AdsGram test reklamasi server tasdig'i (Reward URL) yubormaydi. true bo'lsa reklama
// muvaffaqiyatli tugagach (sessiya orqali) reward darhol hisoblanadi. PRODUCTION'DA YOQIB BO'LMAYDI.
const rewardTestMode = (process.env.ADS_REWARD_TEST_MODE || 'false').trim().toLowerCase() === 'true';
if (rewardTestMode && nodeEnv === 'production') {
  throw new Error('ADS_REWARD_TEST_MODE=true NODE_ENV=production da ishlamaydi. Production uchun ADS_REWARD_TEST_MODE=false qiling.');
}

const rewardToken = (process.env.ADSGRAM_REWARD_TOKEN || '').trim();
if (rewardToken && !/^[A-Za-z0-9_-]{24,}$/.test(rewardToken)) {
  throw new Error('ADSGRAM_REWARD_TOKEN faqat A-Z a-z 0-9 _ - belgilaridan iborat va kamida 24 belgi bo\'lishi kerak');
}
if (verifyMode === 'server_confirmed' && !rewardToken && !rewardTestMode) {
  throw new Error(
    'ADSGRAM_VERIFY_MODE=server_confirmed uchun ADSGRAM_REWARD_TOKEN majburiy (openssl rand -hex 32). ' +
      'Faqat vaqtincha client_session rejimiga o\'tish mumkin (zaifroq).',
  );
}

const BOT_MODES = ['polling', 'webhook'];
const botMode = (process.env.BOT_MODE || 'polling').trim();
if (!BOT_MODES.includes(botMode)) {
  throw new Error(`BOT_MODE noto'g'ri: "${botMode}". Ruxsat etilgan: ${BOT_MODES.join(' | ')}`);
}
const webhookUrl = (process.env.WEBHOOK_URL || '').trim().replace(/\/+$/, '');
const webhookSecret = (process.env.WEBHOOK_SECRET || '').trim();
if (botMode === 'webhook') {
  if (!/^https:\/\/[^\s]+$/i.test(webhookUrl)) {
    throw new Error('BOT_MODE=webhook uchun WEBHOOK_URL majburiy va https:// bilan boshlanishi kerak (masalan https://bot.example.com)');
  }
  // Telegram secret_token: 1-256 belgi, faqat A-Z a-z 0-9 _ -
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) {
    throw new Error('BOT_MODE=webhook uchun WEBHOOK_SECRET majburiy: 16-256 belgi, faqat A-Z a-z 0-9 _ - (openssl rand -hex 32)');
  }
}

// Bot faqat "Ilovani ochish" tugmasini ko'rsatadi — Telegram Web App URL faqat https bo'lishi mumkin
const mineAppUrl = required('MINE_APP_URL');
if (!/^https:\/\/[^\s]+$/i.test(mineAppUrl)) {
  throw new Error('MINE_APP_URL https:// bilan boshlanishi kerak (masalan https://adrush.example.com/mine/)');
}

const path = require('path');

if (int('TRANSFER_MIN', 1, { min: 1 }) > int('TRANSFER_MAX', 1_000_000, { min: 1 })) {
  throw new Error('TRANSFER_MIN TRANSFER_MAX dan katta bo\'lishi mumkin emas');
}

const config = Object.freeze({
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: int('TRUST_PROXY', 0),

  botToken: required('BOT_TOKEN'),
  adminIds: parseIds(process.env.ADMIN_IDS), // string[]
  mineAppUrl: mineAppUrl,
  initDataMaxAgeSec: int('TELEGRAM_INITDATA_MAX_AGE_SEC', 86400, { min: 60 }),

  databaseUrl: required('DATABASE_URL'),
  redisUrl: (process.env.REDIS_URL || '').trim(),

  adsgram: Object.freeze({
    blockId: (process.env.ADSGRAM_BLOCK_ID || '').trim(),
    // Har bir reklama kartasi uchun alohida AdsGram blockId (vergul bilan). Bo'sh yoki kam bo'lsa — aylanib takrorlanadi / asosiy blockId ishlatiladi.
    blockIds: Object.freeze(parseList(process.env.ADSGRAM_BLOCK_IDS)),
    verifyMode, // 'server_confirmed' | 'client_session'
    rewardToken, // bizning o'z tokenimiz (AdsGram imzo bermaydi)
    callbackIpAllowlist: Object.freeze(parseList(process.env.ADSGRAM_CALLBACK_IP_ALLOWLIST)),
  }),

  bot: Object.freeze({
    mode: botMode, // 'polling' | 'webhook'
    webhookUrl,
    webhookSecret,
    webhookPath: '/telegram/webhook',
    throttleMax: int('BOT_THROTTLE_MAX', 15, { min: 1 }), // oyna ichidagi maksimal update
    throttleWindowMs: int('BOT_THROTTLE_WINDOW_SEC', 10, { min: 1 }) * 1000,
  }),

  http: Object.freeze({
    // Sekin/osilib qolgan ulanishlardan himoya (Slowloris va h.k.)
    requestTimeoutMs: int('HTTP_REQUEST_TIMEOUT_SEC', 30, { min: 5 }) * 1000,
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_SEC', 15, { min: 3 }) * 1000,
  }),

  // Admin yuklaydigan rasmlar. Docker'da bu papka volume bo'lishi kerak.
  uploads: Object.freeze({
    dir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads')),
    maxBytes: int('UPLOAD_MAX_BYTES', 2 * 1024 * 1024, { min: 10_240 }),
  }),

  // Olmos (reklama va referaldan olinadi) va uning Rush Coin ga kursi. Hamma qiymat serverda — klientdan miqdor/kurs qabul qilinmaydi.
  diamond: Object.freeze({
    perAd: int('DIAMOND_PER_AD', 1, { min: 1 }), // 1 ta valid reklama = +N olmos
    referralReward: int('REFERRAL_DIAMOND_REWARD', 5, { min: 1 }), // yangi taklif qilingan user uchun taklif qiluvchiga (olmos)
    // Almashtirish kursi: DIAMOND_CONVERT_DIAMONDS olmos = DIAMOND_CONVERT_RUSH Rush Coin (standart: 12 💎 = 4 🪙).
    // Almashtirish eng kichik butun qadamlarda bo'ladi (12:4 -> har 3 olmos = 1 Rush Coin), shuning uchun Rush doim butun son.
    convert: (() => {
      const d = int('DIAMOND_CONVERT_DIAMONDS', 12, { min: 1 });
      const r = int('DIAMOND_CONVERT_RUSH', 4, { min: 1 });
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const g = gcd(d, r);
      return Object.freeze({ diamonds: d, rush: r, stepDiamonds: d / g, stepRush: r / g });
    })(),
  }),

  // Rush Coin (ichki valyuta).
  rush: Object.freeze({
    referralDailyCap: int('RUSH_REFERRAL_DAILY_CAP', 100), // bitta user kuniga (UTC) ko'pi bilan nechta referral oladi. 0 = cheklovsiz
    subscribeReward: int('RUSH_SUBSCRIBE_REWARD', 50, { min: 1 }), // majburiy kanalga birinchi marta obuna bo'lganda beriladigan Rush Coin
    // Foydalanuvchilar orasida Rush Coin o'tkazmasi (komissiya yo'q)
    transferMin: int('TRANSFER_MIN', 1, { min: 1 }),
    transferMax: int('TRANSFER_MAX', 1_000_000, { min: 1 }),
    transferDailyLimit: int('TRANSFER_DAILY_LIMIT', 10_000), // bitta user kuniga (UTC) ko'pi bilan shuncha Rush yuboradi. 0 = cheksiz
    botUsername: (process.env.BOT_USERNAME || '').trim().replace(/^@/, ''), // bo'sh bo'lsa getMe orqali aniqlanadi
  }),

  ads: Object.freeze({
    rewardTestMode, // faqat development/test (production'da config xato beradi)
    sessionTtlMs: int('AD_SESSION_TTL_SEC', 600, { min: 30 }) * 1000,
    minDurationMs: int('AD_MIN_DURATION_MS', 8000),
    cooldownMs: int('AD_COOLDOWN_MS', 5000), // bitta karta uchun: olmos berilgach shuncha vaqtdan keyin shu kartadan qayta ko'rish mumkin
    slots: Math.min(int('AD_SLOTS', 5, { min: 1 }), 10), // Vazifalardagi reklama kartalari soni (1..10)
    dailyCap: int('AD_DAILY_CAP', 0), // 0 = cheklovsiz
  }),
});

module.exports = config;