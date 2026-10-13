'use strict';

const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ApiError } = require('../../utils/apiError');
const { lockUser } = require('../../utils/dbLock');
const { createTtlCache } = require('../../utils/ttlCache');
const { applyCoins, COIN_TX } = require('../coins/coinService');

const TX_OPTS = Object.freeze({ maxWait: 5000, timeout: 10000 });
const CHANNEL_TTL_MS = 30 * 1000; // faol kanal keshi (admin o'zgartirsa invalidate() bilan tozalanadi)
const MEMBER_TTL_MS = 60 * 1000; // faqat "obuna bo'lgan" natija keshlanadi, "bo'lmagan" hech qachon
const MEMBER_CACHE_MAX = 20000;
const MAX_CHANNELS = 50; // bir vaqtda faol majburiy kanallar soni chegarasi
const CHECK_BATCH = 10; // Telegram'ga bir vaqtda ketadigan getChatMember so'rovlari soni

const channelCache = createTtlCache({ ttlMs: CHANNEL_TTL_MS, maxEntries: 5 });
const memberCache = new Map(); // `${channelId}:${telegramId}` -> expires (ms)

/** Telegram Bot API chaqiruvi. { ok, result, description } qaytaradi, hech qachon throw qilmaydi. */
async function tg(method, params) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    return { ok: Boolean(data && data.ok), result: data && data.result, description: data && data.description };
  } catch (err) {
    return { ok: false, result: null, description: err.message };
  }
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chatId.toString(),
    username: row.username,
    title: row.title,
    inviteUrl: row.inviteUrl,
  };
}

/** Faol majburiy kanallar ro'yxati (eskisi birinchi). Bo'sh bo'lsa — majburiy obuna o'chiq. */
function getActiveChannels() {
  return channelCache.wrap('active', async () => {
    const rows = await prisma.requiredChannel.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, take: MAX_CHANNELS });
    return rows.map(toPublic);
  });
}

/** Eski kod bilan moslik: birinchi faol kanal (yo'q bo'lsa null). */
async function getActiveChannel() {
  const list = await getActiveChannels();
  return list.length ? list[0] : null;
}

/** Admin kanalni o'zgartirganda chaqiriladi. */
function invalidate() {
  channelCache.clear();
  memberCache.clear();
}

/**
 * Foydalanuvchi kanal a'zosimi?
 * Qaytadi: 'MEMBER' | 'NOT_MEMBER' | 'UNKNOWN' (Telegram javob bermadi / bot kanalda admin emas).
 */
async function checkMembership(channel, telegramId) {
  const key = `${channel.id}:${telegramId}`;
  const cached = memberCache.get(key);
  if (cached && cached > Date.now()) return 'MEMBER';

  const r = await tg('getChatMember', { chat_id: channel.chatId, user_id: Number(telegramId) });
  if (!r.ok) {
    logger.warn({ channelId: channel.id, err: r.description }, 'getChatMember xato (bot kanalda admin ekanini tekshiring)');
    return 'UNKNOWN';
  }
  const st = r.result && r.result.status;
  const member = st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && r.result.is_member === true);
  if (!member) return 'NOT_MEMBER';

  if (memberCache.size >= MEMBER_CACHE_MAX) memberCache.delete(memberCache.keys().next().value);
  memberCache.set(key, Date.now() + MEMBER_TTL_MS);
  return 'MEMBER';
}

/**
 * Foydalanuvchi uchun holat (barcha faol kanallar bo'yicha).
 *  required   — kamida bitta kanal sozlangan va tekshiruv kerak
 *  subscribed — ilovaga kirishga ruxsat (kanal yo'q yoki HAMMA kanalga a'zo; Telegram ishlamasa ham true)
 *  verified   — HAMMA kanalga a'zolik Telegram orqali haqiqatan tasdiqlandi (mukofot faqat shunda beriladi)
 *  channels   — barcha faol kanallar; har birida member: true | false | null (null = tekshirilmadi / noma'lum)
 *  channel    — birinchi a'zo bo'linmagan kanal (eski klientlar uchun)
 * opts.full=false (middleware): birinchi a'zo bo'lmagan kanal topilgach to'xtaydi — Telegram'ga ortiqcha so'rov ketmaydi.
 * opts.full=true (status/check): barcha kanallar tekshiriladi, foydalanuvchiga qaysi biri qolgani ko'rsatiladi.
 * Telegram ishlamay qolsa (UNKNOWN) ilova ochiq qoladi (fail-open), lekin mukofot berilmaydi.
 */
async function getStatus(telegramId, opts) {
  const full = Boolean(opts && opts.full);
  const list = await getActiveChannels();
  if (!list.length) return { required: false, subscribed: true, verified: false, channel: null, channels: [] };

  const results = new Map(); // channel.id -> 'MEMBER' | 'NOT_MEMBER' | 'UNKNOWN'
  for (let i = 0; i < list.length; i += CHECK_BATCH) {
    const batch = list.slice(i, i + CHECK_BATCH);
    const states = await Promise.all(batch.map((ch) => checkMembership(ch, telegramId)));
    batch.forEach((ch, j) => results.set(ch.id, states[j]));
    if (!full && states.includes('NOT_MEMBER')) break;
  }

  const channels = list.map((ch) => {
    const r = results.get(ch.id);
    return { ...ch, member: r === 'MEMBER' ? true : r === 'NOT_MEMBER' ? false : null };
  });
  const missing = channels.filter((c) => c.member === false);
  return {
    required: true,
    subscribed: missing.length === 0,
    verified: channels.every((c) => c.member === true),
    channel: missing.length ? missing[0] : null,
    channels,
  };
}

/**
 * Obunani tekshiradi va (birinchi marta bo'lsa) HAR BIR yangi kanal uchun +subscribeReward beradi.
 * Qaytadi: { required, subscribed, rewarded, amount, channel, channels }
 * Mukofot bir kanal uchun bir userga bir marta: idempotencyKey = SUBSCRIBE_REWARD:<kanalId>:<userId>.
 * Hamma kanalga a'zo bo'lmaguncha mukofot berilmaydi.
 */
async function checkAndReward(user) {
  const st = await getStatus(user.telegramId, { full: true });
  const out = { required: st.required, subscribed: st.subscribed, rewarded: false, amount: 0, channel: st.channel, channels: st.channels };
  if (!st.required || !st.verified) return out;

  const per = config.rush.subscribeReward;
  for (const ch of st.channels) {
    try {
      await prisma.$transaction(async (tx) => {
        await lockUser(tx, user.telegramId);
        const credit = await applyCoins(tx, {
          userId: user.id,
          amount: per,
          type: COIN_TX.SUBSCRIBE_REWARD,
          idempotencyKey: `SUBSCRIBE_REWARD:${ch.id}:${user.id}`,
          refType: 'channel',
          refId: ch.id,
        });
        if (!credit.ok) throw new Error('SUBSCRIBE_CREDIT_FAILED');
      }, TX_OPTS);
      out.rewarded = true;
      out.amount += per;
    } catch (err) {
      // P2002 (idempotencyKey) — bu kanal uchun mukofot avval berilgan: xato emas
      if (!(err && err.code === 'P2002')) throw err;
    }
  }
  return out;
}

// ---------- Admin ----------

/** "@name", "t.me/name", "https://t.me/name" yoki -100... son id ni chat_id ga aylantiradi. */
function parseChatRef(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (/^-?\d{5,20}$/.test(s)) return s;
  const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(s);
  return m ? `@${m[1]}` : null;
}

/** Admin kiritgan kanalni Telegram orqali tekshiradi: mavjudmi, bot admin-mi. Natija DB ga yoziladigan ma'lumot. */
async function resolveChannel(rawRef, rawInviteUrl) {
  const ref = parseChatRef(rawRef);
  if (!ref) throw new ApiError(400, 'BAD_CHANNEL', 'Kanal manzili noto\'g\'ri (@username yoki -100... id)');

  const chat = await tg('getChat', { chat_id: ref });
  if (!chat.ok) throw new ApiError(400, 'CHANNEL_NOT_FOUND', 'Kanal topilmadi. Bot kanalga admin qilib qo\'shilganini tekshiring');
  if (chat.result.type !== 'channel' && chat.result.type !== 'supergroup') {
    throw new ApiError(400, 'BAD_CHANNEL_TYPE', 'Bu kanal yoki guruh emas');
  }

  const me = await tg('getMe');
  if (!me.ok) throw new ApiError(502, 'TELEGRAM_UNAVAILABLE', 'Telegram bilan bog\'lanib bo\'lmadi');
  const mem = await tg('getChatMember', { chat_id: chat.result.id, user_id: me.result.id });
  if (!mem.ok || (mem.result.status !== 'administrator' && mem.result.status !== 'creator')) {
    throw new ApiError(400, 'BOT_NOT_ADMIN', 'Bot kanalda admin emas. Avval botni kanalga admin qiling');
  }

  const username = chat.result.username || null;
  const invite = String(rawInviteUrl || '').trim() || chat.result.invite_link || '';
  const inviteUrl = username ? `https://t.me/${username}` : invite;
  if (!/^https:\/\/t\.me\/.+/.test(inviteUrl)) {
    throw new ApiError(400, 'INVITE_REQUIRED', 'Maxfiy kanal uchun https://t.me/... taklif havolasi kerak');
  }

  return { chatId: BigInt(chat.result.id), username, title: String(chat.result.title || username || 'Kanal').slice(0, 200), inviteUrl };
}

/** Admin paneldan yangi majburiy kanal qo'shadi (eskilari saqlanadi; ko'pi bilan MAX_CHANNELS ta). */
async function addChannel(rawRef, rawInviteUrl) {
  const data = await resolveChannel(rawRef, rawInviteUrl);
  const row = await prisma.$transaction(async (tx) => {
    const active = await tx.requiredChannel.findMany({ where: { isActive: true }, select: { id: true, chatId: true } });
    if (active.some((c) => c.chatId === data.chatId)) {
      throw new ApiError(409, 'CHANNEL_EXISTS', 'Bu kanal allaqachon qo\'shilgan');
    }
    if (active.length >= MAX_CHANNELS) {
      throw new ApiError(400, 'CHANNEL_LIMIT', `Ko'pi bilan ${MAX_CHANNELS} ta kanal qo'shish mumkin`);
    }
    return tx.requiredChannel.create({ data: { ...data, isActive: true } });
  });
  invalidate();
  return toPublic(row);
}

/** Eski nom (moslik uchun). */
const setChannel = addChannel;

/** Bitta majburiy kanalni o'chiradi. Topilmasa null. */
async function removeChannelById(id) {
  const row = await prisma.requiredChannel.findFirst({ where: { id, isActive: true } });
  if (!row) return null;
  await prisma.requiredChannel.update({ where: { id }, data: { isActive: false } });
  invalidate();
  return toPublic(row);
}

/** Barcha majburiy kanallarni o'chiradi (majburiy obuna o'chadi). */
async function removeChannel() {
  await prisma.requiredChannel.updateMany({ where: { isActive: true }, data: { isActive: false } });
  invalidate();
}

module.exports = {
  MAX_CHANNELS,
  getActiveChannels,
  getActiveChannel,
  getStatus,
  checkAndReward,
  addChannel,
  setChannel,
  removeChannelById,
  removeChannel,
  invalidate,
};