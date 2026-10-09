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
const MEMBER_CACHE_MAX = 5000;

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

/** Faol majburiy kanal (yo'q bo'lsa null). */
function getActiveChannel() {
  return channelCache.wrap('active', async () => {
    const row = await prisma.requiredChannel.findFirst({ where: { isActive: true }, orderBy: { id: 'desc' } });
    return toPublic(row);
  });
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
 * Foydalanuvchi uchun holat.
 *  required   — kanal sozlangan va tekshiruv kerak
 *  subscribed — ilovaga kirishga ruxsat (kanal yo'q yoki a'zo yoki Telegram ishlamayotgan bo'lsa true)
 *  verified   — a'zolik Telegram orqali haqiqatan tasdiqlandi (mukofot faqat shunda beriladi)
 * Telegram ishlamay qolsa (UNKNOWN) ilova ochiq qoladi (fail-open), lekin mukofot berilmaydi.
 */
async function getStatus(telegramId) {
  const channel = await getActiveChannel();
  if (!channel) return { required: false, subscribed: true, verified: false, channel: null };
  const m = await checkMembership(channel, telegramId);
  return {
    required: true,
    subscribed: m !== 'NOT_MEMBER',
    verified: m === 'MEMBER',
    channel,
  };
}

/**
 * Obunani tekshiradi va (birinchi marta bo'lsa) +subscribeReward beradi.
 * Qaytadi: { required, subscribed, rewarded, amount, channel }
 * Mukofot bir kanal uchun bir userga bir marta: idempotencyKey = SUBSCRIBE_REWARD:<kanalId>:<userId>.
 */
async function checkAndReward(user) {
  const st = await getStatus(user.telegramId);
  const out = { required: st.required, subscribed: st.subscribed, rewarded: false, amount: 0, channel: st.channel };
  if (!st.required || !st.verified) return out;

  const amount = config.rush.subscribeReward;
  try {
    await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);
      const credit = await applyCoins(tx, {
        userId: user.id,
        amount,
        type: COIN_TX.SUBSCRIBE_REWARD,
        idempotencyKey: `SUBSCRIBE_REWARD:${st.channel.id}:${user.id}`,
        refType: 'channel',
        refId: st.channel.id,
      });
      if (!credit.ok) throw new Error('SUBSCRIBE_CREDIT_FAILED');
    }, TX_OPTS);
    out.rewarded = true;
    out.amount = amount;
  } catch (err) {
    // P2002 (idempotencyKey) — mukofot avval berilgan: xato emas
    if (!(err && err.code === 'P2002')) throw err;
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

/** Admin paneldan kanalni qo'yadi (eskisi o'chiriladi — bir vaqtda bitta faol). */
async function setChannel(rawRef, rawInviteUrl) {
  const data = await resolveChannel(rawRef, rawInviteUrl);
  const row = await prisma.$transaction(async (tx) => {
    await tx.requiredChannel.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.requiredChannel.create({ data: { ...data, isActive: true } });
  });
  invalidate();
  return toPublic(row);
}

/** Majburiy obunani o'chiradi. */
async function removeChannel() {
  await prisma.requiredChannel.updateMany({ where: { isActive: true }, data: { isActive: false } });
  invalidate();
}

module.exports = {
  getActiveChannel,
  getStatus,
  checkAndReward,
  setChannel,
  removeChannel,
  invalidate,
};