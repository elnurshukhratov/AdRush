'use strict';

const { z } = require('zod');
const { asyncHandler, ApiError } = require('../../utils/apiError');
const adminService = require('../../services/admin/adminService');
const { record } = require('../../services/audit/auditService');
const subscription = require('../../services/subscription/subscriptionService');
const adSettings = require('../../services/ads/adSettingsService');

const trimmed = (min, max) => z.string().trim().min(min).max(max);

const auditQuery = z
  .object({
    kind: z.enum(adminService.AUDIT_KINDS).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.string().regex(/^\d{1,18}$/).optional(),
  })
  .strict();
const userSearchQuery = z.object({ q: z.string().trim().max(64).default('') }).strict();
const telegramIdParams = z.object({ telegramId: z.string().regex(/^\d{1,15}$/) }).strict();
// channel: @username, t.me/name yoki -100... id; inviteUrl: faqat maxfiy kanal uchun (servis tekshiradi)
const subscriptionBody = z
  .object({ channel: trimmed(1, 200), inviteUrl: z.string().trim().max(500).optional() })
  .strict();

// Reklama sozlamalari: faqat OMMAVIY identifikatorlar (maxfiy tokenlar .env da). Bo'sh satr = o'chirish. Format servisda tekshiriladi.
const adSettingsBody = z
  .object({
    adsgramTaskBlockId: z.string().trim().max(40).optional(),
    adsgramQuickBlockId: z.string().trim().max(40).optional(),
    monetagZoneId: z.string().trim().max(20).optional(),
    monetagSdkUrl: z.string().trim().max(300).optional(),
    onclickaSpotId: z.string().trim().max(20).optional(),
    onclickaSdkUrl: z.string().trim().max(300).optional(),
  })
  .strict();

const actor = (req) => req.auth.telegramId;
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

// ---------- Dashboard ----------
const overview = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json({ success: true, ...(await adminService.getOverview()) });
});

// ---------- Xavfsizlik: audit va foydalanuvchilar ----------
const listAudit = asyncHandler(async (req, res) => {
  const q = auditQuery.parse(req.query);
  noStore(res);
  res.json({ success: true, ...(await adminService.listAudit(q)) });
});

const searchUsers = asyncHandler(async (req, res) => {
  const { q } = userSearchQuery.parse(req.query);
  noStore(res);
  res.json({ success: true, users: await adminService.searchUsers({ q }) });
});

const setUserBlocked = (blocked) =>
  asyncHandler(async (req, res) => {
    const { telegramId } = telegramIdParams.parse(req.params);
    const user = await adminService.setBlocked(telegramId, blocked, actor(req));
    res.json({ success: true, user });
  });
const blockUser = setUserBlocked(true);
const unblockUser = setUserBlocked(false);

// ---------- Majburiy kanalga obuna (ko'pi bilan 50 ta kanal) ----------
const channelIdParams = z.object({ id: z.coerce.number().int().positive() }).strict();

/** GET /api/admin/subscription — barcha faol kanallar { channels, max }. `channel` — birinchisi (eski klientlar uchun). */
const getSubscription = asyncHandler(async (_req, res) => {
  noStore(res);
  const channels = await subscription.getActiveChannels();
  res.json({ success: true, channels, max: subscription.MAX_CHANNELS, channel: channels[0] || null });
});

/** POST/PUT /api/admin/subscription { channel, inviteUrl? } — kanalni Telegram orqali tekshiradi va RO'YXATGA QO'SHADI (xatolar ApiError). */
const setSubscription = asyncHandler(async (req, res) => {
  const { channel: ref, inviteUrl } = subscriptionBody.parse(req.body);
  const channel = await subscription.addChannel(ref, inviteUrl);
  await record('ADMIN_SUBSCRIPTION_SET', {
    actorTelegramId: actor(req),
    entityType: 'channel',
    entityId: channel.id,
    details: { chatId: channel.chatId, username: channel.username, title: channel.title },
  });
  const channels = await subscription.getActiveChannels();
  res.json({ success: true, channel, channels, max: subscription.MAX_CHANNELS });
});

/** DELETE /api/admin/subscription/:id — bitta kanalni o'chiradi. */
const removeSubscriptionById = asyncHandler(async (req, res) => {
  const { id } = channelIdParams.parse(req.params);
  const removed = await subscription.removeChannelById(id);
  if (!removed) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Kanal topilmadi');
  await record('ADMIN_SUBSCRIPTION_REMOVED', {
    actorTelegramId: actor(req),
    entityType: 'channel',
    entityId: removed.id,
    details: { chatId: removed.chatId, username: removed.username, title: removed.title },
  });
  res.json({ success: true, channels: await subscription.getActiveChannels() });
});

/** DELETE /api/admin/subscription — BARCHA kanallarni o'chiradi (majburiy obuna o'chadi). */
const removeSubscription = asyncHandler(async (req, res) => {
  const previous = await subscription.getActiveChannels();
  await subscription.removeChannel();
  await record('ADMIN_SUBSCRIPTION_REMOVED', {
    actorTelegramId: actor(req),
    entityType: 'channel',
    entityId: null,
    details: previous.length ? { removedAll: true, count: previous.length, chatIds: previous.map((c) => c.chatId) } : { hadChannel: false },
  });
  res.json({ success: true, channels: [] });
});

// ---------- Reklama provayderlari sozlamalari ----------
/** GET /api/admin/ads/settings — joriy qiymatlar, provayder holatlari, tokenlar o'rnatilganmi (qiymatsiz), URL shablonlari. */
const getAdSettings = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json({ success: true, ...(await adSettings.getAdminView()) });
});

/** PUT /api/admin/ads/settings { adsgramTaskBlockId?, adsgramQuickBlockId?, monetagZoneId?, monetagSdkUrl?, onclickaSpotId?, onclickaSdkUrl? } */
const setAdSettings = asyncHandler(async (req, res) => {
  const patch = adSettingsBody.parse(req.body);
  res.json({ success: true, ...(await adSettings.updateSettings(patch, actor(req))) });
});

module.exports = {
  getAdSettings,
  setAdSettings,
  getSubscription,
  setSubscription,
  removeSubscriptionById,
  removeSubscription,
  listAudit,
  searchUsers,
  blockUser,
  unblockUser,
  overview,
};