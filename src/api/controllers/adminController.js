'use strict';

const { z } = require('zod');
const { asyncHandler } = require('../../utils/apiError');
const adminService = require('../../services/admin/adminService');
const { record } = require('../../services/audit/auditService');
const subscription = require('../../services/subscription/subscriptionService');

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

// ---------- Majburiy kanalga obuna ----------
/** GET /api/admin/subscription — joriy faol kanal yoki null. */
const getSubscription = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json({ success: true, channel: await subscription.getActiveChannel() });
});

/** PUT /api/admin/subscription { channel, inviteUrl? } — kanalni Telegram orqali tekshiradi va faol qiladi (xatolar ApiError). */
const setSubscription = asyncHandler(async (req, res) => {
  const { channel: ref, inviteUrl } = subscriptionBody.parse(req.body);
  const channel = await subscription.setChannel(ref, inviteUrl);
  await record('ADMIN_SUBSCRIPTION_SET', {
    actorTelegramId: actor(req),
    entityType: 'channel',
    entityId: channel.id,
    details: { chatId: channel.chatId, username: channel.username, title: channel.title },
  });
  res.json({ success: true, channel });
});

/** DELETE /api/admin/subscription — majburiy obunani o'chiradi. */
const removeSubscription = asyncHandler(async (req, res) => {
  const previous = await subscription.getActiveChannel();
  await subscription.removeChannel();
  await record('ADMIN_SUBSCRIPTION_REMOVED', {
    actorTelegramId: actor(req),
    entityType: 'channel',
    entityId: previous ? previous.id : null,
    details: previous ? { chatId: previous.chatId, username: previous.username, title: previous.title } : { hadChannel: false },
  });
  res.json({ success: true });
});

module.exports = {
  getSubscription,
  setSubscription,
  removeSubscription,
  listAudit,
  searchUsers,
  blockUser,
  unblockUser,
  overview,
};