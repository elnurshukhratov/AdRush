'use strict';

/**
 * Reklama provayderlari sozlamalari.
 *
 * Saqlanadi (AdSetting jadvali, admin paneldan o'zgaradi) — FAQAT OMMAVIY identifikatorlar:
 *   adsgram.taskBlockId   — Vazifalardagi AdsGram kartasi uchun block ID
 *   adsgram.quickBlockId  — tepada doim turadigan +1 olmos tugmasi uchun ALOHIDA AdsGram block ID
 *   monetag.zoneId        — Monetag asosiy (main SDK) zone ID
 *   monetag.sdkUrl        — Monetag dashboarddan olingan SDK skript manzili (https)
 *   onclicka.spotId       — OnClickA SPOT-ID
 *   onclicka.sdkUrl       — OnClickA TMA video SDK manzili (standart: rasmiy hujjatdagi)
 *
 * MAXFIY tokenlar (ADSGRAM_REWARD_TOKEN, MONETAG_POSTBACK_TOKEN, ONCLICKA_CALLBACK_TOKEN) faqat .env da — bu
 * servis ularni hech qachon DB ga yozmaydi va klientga/adminga qaytarmaydi (faqat "o'rnatilgan/yo'q" belgisi).
 *
 * Qator yo'q = .env dagi standart; qator bor (bo'sh ham) = aynan shu qiymat (bo'sh = o'chirilgan).
 */

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const { ApiError } = require('../../utils/apiError');
const { record } = require('../audit/auditService');

const KEYS = Object.freeze({
  adsgramTaskBlockId: 'adsgram.taskBlockId',
  adsgramQuickBlockId: 'adsgram.quickBlockId',
  monetagZoneId: 'monetag.zoneId',
  monetagSdkUrl: 'monetag.sdkUrl',
  onclickaSpotId: 'onclicka.spotId',
  onclickaSdkUrl: 'onclicka.sdkUrl',
});
const FIELD_BY_KEY = Object.freeze(Object.fromEntries(Object.entries(KEYS).map(([f, k]) => [k, f])));

const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NUMERIC_ID_RE = /^\d{1,12}$/;

function validSdkUrl(raw) {
  if (raw.length > 300) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
}

// Har bir maydon uchun tekshiruv. Bo'sh qiymat har doim ruxsat (= o'chirish / standartga qaytarish emas, aniq bo'sh).
const VALIDATORS = Object.freeze({
  adsgramTaskBlockId: (v) => BLOCK_ID_RE.test(v),
  adsgramQuickBlockId: (v) => BLOCK_ID_RE.test(v),
  monetagZoneId: (v) => NUMERIC_ID_RE.test(v),
  monetagSdkUrl: validSdkUrl,
  onclickaSpotId: (v) => NUMERIC_ID_RE.test(v),
  onclickaSdkUrl: validSdkUrl,
});

// ---------- Kesh (bir nechta instansiyada ham xavfsiz: qisqa TTL, o'zgarganda o'zimizda tozalanadi) ----------
const CACHE_TTL_MS = 10_000;
let cache = null; // { at, rows: Map<key, value> }

async function loadRows() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows;
  const list = await prisma.adSetting.findMany();
  const rows = new Map(list.map((r) => [r.key, r.value]));
  cache = { at: now, rows };
  return rows;
}

function clearCache() {
  cache = null;
}

// ---------- Standart (fallback) qiymatlar: .env ----------
function envTaskBlockId() {
  const first = (config.adsgram.blockIds[0] || String(config.adsgram.blockId || '').split(',')[0] || '').trim();
  return BLOCK_ID_RE.test(first) ? first : '';
}

function envQuickBlockId() {
  const v = String(config.adsgram.quickBlockId || '').trim();
  return BLOCK_ID_RE.test(v) ? v : '';
}

/** Joriy (DB yoki .env standart) qiymatlar. Bo'sh satr = sozlanmagan. */
async function getValues() {
  const rows = await loadRows();
  const pick = (field, fallback) => (rows.has(KEYS[field]) ? rows.get(KEYS[field]) : fallback);
  return {
    adsgramTaskBlockId: pick('adsgramTaskBlockId', envTaskBlockId()),
    adsgramQuickBlockId: pick('adsgramQuickBlockId', envQuickBlockId()),
    monetagZoneId: pick('monetagZoneId', ''),
    monetagSdkUrl: pick('monetagSdkUrl', ''),
    onclickaSpotId: pick('onclickaSpotId', ''),
    onclickaSdkUrl: pick('onclickaSdkUrl', config.onclicka.defaultSdkUrl),
  };
}

const testMode = () => config.ads.rewardTestMode; // faqat development (production'da config xato beradi)

/**
 * Har bir reklama joyining holati. enabled=false bo'lsa sessiya ochilmaydi va karta "mavjud emas" ko'rinadi.
 * Provayderlar bir-biriga hech qachon almashtirilmaydi: biri sozlanmagan bo'lsa boshqasining ID si ishlatilmaydi.
 */
function computeState(v) {
  const adsgramTask = v.adsgramTaskBlockId
    ? { enabled: true }
    : { enabled: false, reason: 'NOT_CONFIGURED' };

  let adsgramQuick;
  if (!v.adsgramQuickBlockId) adsgramQuick = { enabled: false, reason: 'NOT_CONFIGURED' };
  else if (v.adsgramQuickBlockId === v.adsgramTaskBlockId) adsgramQuick = { enabled: false, reason: 'SAME_BLOCK_ID' };
  else adsgramQuick = { enabled: true };

  let monetag;
  if (!v.monetagZoneId || !v.monetagSdkUrl) monetag = { enabled: false, reason: 'NOT_CONFIGURED' };
  else if (!config.monetag.postbackToken && !testMode()) monetag = { enabled: false, reason: 'CALLBACK_TOKEN_MISSING' };
  else monetag = { enabled: true };

  let onclicka;
  if (!v.onclickaSpotId || !v.onclickaSdkUrl) onclicka = { enabled: false, reason: 'NOT_CONFIGURED' };
  else if (!config.onclicka.callbackToken && !testMode()) onclicka = { enabled: false, reason: 'CALLBACK_TOKEN_MISSING' };
  else onclicka = { enabled: true };

  return { adsgramTask, adsgramQuick, monetag, onclicka };
}

/** Sessiya ochish / postback tekshiruvi uchun ichki ko'rinish (qiymatlar + holat). */
async function getSettings() {
  const values = await getValues();
  return { values, state: computeState(values) };
}

/** Berilgan (provider, placement) uchun holat. Noto'g'ri kombinatsiya (masalan monetag + quick) — enabled=false. */
function stateFor(settings, provider, placement) {
  const { state } = settings;
  if (placement === 'quick') return provider === 'adsgram' ? state.adsgramQuick : { enabled: false, reason: 'INVALID_PLACEMENT' };
  if (provider === 'adsgram') return state.adsgramTask;
  if (provider === 'monetag') return state.monetag;
  if (provider === 'onclicka') return state.onclicka;
  return { enabled: false, reason: 'UNKNOWN_PROVIDER' };
}

/**
 * Mini App uchun OMMAVIY sozlamalar (GET /api/ads/config). Faqat ID lar — tokenlar yo'q.
 * Sozlanmagan provayderning ID si umuman qaytarilmaydi.
 */
async function getPublicConfig() {
  const { values: v, state: s } = await getSettings();
  return {
    providers: {
      adsgram: { enabled: s.adsgramTask.enabled, reason: s.adsgramTask.reason || null, blockId: s.adsgramTask.enabled ? v.adsgramTaskBlockId : null },
      monetag: {
        enabled: s.monetag.enabled,
        reason: s.monetag.reason || null,
        zoneId: s.monetag.enabled ? v.monetagZoneId : null,
        sdkUrl: s.monetag.enabled ? v.monetagSdkUrl : null,
      },
      onclicka: {
        enabled: s.onclicka.enabled,
        reason: s.onclicka.reason || null,
        spotId: s.onclicka.enabled ? v.onclickaSpotId : null,
        sdkUrl: s.onclicka.enabled ? v.onclickaSdkUrl : null,
      },
    },
    quick: { enabled: s.adsgramQuick.enabled, reason: s.adsgramQuick.reason || null, blockId: s.adsgramQuick.enabled ? v.adsgramQuickBlockId : null },
  };
}

function callbackBase() {
  try {
    return new URL(config.mineAppUrl).origin;
  } catch {
    return '';
  }
}

/** Admin paneli uchun: joriy qiymatlar, holatlar, tokenlar o'rnatilganmi (qiymatsiz) va provayderga kiritiladigan URL shablonlari. */
async function getAdminView() {
  const { values, state } = await getSettings();
  const rows = await loadRows();
  const base = callbackBase();
  return {
    values,
    overridden: Object.fromEntries(Object.entries(KEYS).map(([field, key]) => [field, rows.has(key)])),
    state,
    tokens: {
      adsgram: Boolean(config.adsgram.rewardToken),
      monetag: Boolean(config.monetag.postbackToken),
      onclicka: Boolean(config.onclicka.callbackToken),
    },
    // Tokenlar bu yerda YO'Q: <TOKEN> o'rniga .env dagi qiymat qo'yiladi
    callbackTemplates: {
      adsgramTask: `${base}/api/adsgram/reward?userid=[userId]&placement=task&token=<ADSGRAM_REWARD_TOKEN>`,
      adsgramQuick: `${base}/api/adsgram/reward?userid=[userId]&placement=quick&token=<ADSGRAM_REWARD_TOKEN>`,
      monetag:
        `${base}/api/monetag/postback?ymid={ymid}&zone_id={zone_id}&event_type={event_type}` +
        `&reward_event_type={reward_event_type}&telegram_id={telegram_id}&token=<MONETAG_POSTBACK_TOKEN>`,
      onclicka: `${base}/api/onclicka/reward/<ONCLICKA_CALLBACK_TOKEN>`,
    },
  };
}

/**
 * Qisman yangilash: faqat berilgan maydonlar o'zgaradi. Bo'sh satr = shu sozlamani o'chirish (provayder "mavjud emas").
 * Tekshiruvlar: format; AdsGram vazifa va quick block ID lari bir xil bo'lishi mumkin emas.
 */
async function updateSettings(patch, actorTelegramId) {
  const entries = Object.entries(patch || {}).filter(([field, v]) => FIELD_BY_KEY[KEYS[field]] && typeof v === 'string');
  if (entries.length === 0) throw new ApiError(400, 'INVALID_REQUEST', 'O\'zgartirish uchun maydon berilmagan');

  const normalized = {};
  for (const [field, raw] of entries) {
    const value = raw.trim();
    if (value && !VALIDATORS[field](value)) throw new ApiError(400, 'INVALID_SETTING', `${field} formati noto'g'ri`, { field });
    normalized[field] = value;
  }

  const before = await getValues();
  const after = { ...before, ...normalized };
  if (after.adsgramTaskBlockId && after.adsgramTaskBlockId === after.adsgramQuickBlockId) {
    throw new ApiError(409, 'SAME_BLOCK_ID', 'Vazifalar va tepadagi +1 reklama uchun AdsGram block ID lari alohida bo\'lishi shart');
  }

  await prisma.$transaction(async (tx) => {
    for (const [field, value] of Object.entries(normalized)) {
      await tx.adSetting.upsert({
        where: { key: KEYS[field] },
        create: { key: KEYS[field], value, updatedBy: BigInt(actorTelegramId) },
        update: { value, updatedBy: BigInt(actorTelegramId) },
      });
    }
    await record(
      'ADMIN_AD_SETTINGS_UPDATED',
      {
        actorTelegramId,
        entityType: 'ad_settings',
        details: {
          // Faqat ommaviy ID lar — maxfiy qiymat yo'q
          changed: Object.fromEntries(Object.entries(normalized).map(([f, v]) => [f, { from: before[f], to: v }])),
        },
      },
      tx,
    );
  });
  clearCache();
  return getAdminView();
}

module.exports = {
  KEYS,
  getSettings,
  stateFor,
  getPublicConfig,
  getAdminView,
  updateSettings,
  clearCache,
};