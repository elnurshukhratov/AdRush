'use strict';

const { z } = require('zod');
const { asyncHandler, ApiError } = require('../../utils/apiError');
const adminService = require('../../services/admin/adminService');
const competitions = require('../../services/competition/competitionAdminService');
const prizes = require('../../services/competition/prizeService');
const winners = require('../../services/competition/winnerService');
const { savePrizeImage, saveProofImage, isValidImageUrl } = require('../../services/uploads/imageService');
const { record } = require('../../services/audit/auditService');
const subscription = require('../../services/subscription/subscriptionService');
const { invalidatePublicCache } = require('./competitionController');
const { invalidateLeaderboardCache } = require('./leaderboardController');

const id = z.coerce.number().int().positive().max(2_000_000_000);
const idParams = z.object({ id }).strict();

const dateField = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const trimmed = (min, max) => z.string().trim().min(min).max(max);
const optionalText = (max) =>
  z.union([z.string().trim().max(max), z.null()]).transform((v) => (v === '' ? null : v));

const competitionCreate = z
  .object({ title: trimmed(3, 120), description: optionalText(1000).optional(), startAt: dateField, endAt: dateField })
  .strict();

const competitionPatch = z
  .object({ title: trimmed(3, 120), description: optionalText(1000), startAt: dateField, endAt: dateField })
  .partial()
  .strict();

const imageUrl = z.union([z.string().refine(isValidImageUrl, 'Noto\'g\'ri rasm manzili'), z.null()]);

const prizeBase = {
  place: z.number().int().min(1).max(100),
  title: trimmed(1, 120),
  description: optionalText(500),
  imageUrl,
  value: optionalText(60),
  quantity: z.number().int().min(1).max(1000),
  status: z.enum(['ACTIVE', 'INACTIVE']),
};
const prizeCreate = z.object(prizeBase).partial({ description: true, imageUrl: true, value: true, quantity: true, status: true }).strict();
const prizePatch = z.object(prizeBase).partial().strict();

const winnerPatch = z
  .object({ status: z.enum(['PENDING', 'CONTACTED', 'DELIVERED', 'CANCELLED']), note: optionalText(500) })
  .partial()
  .strict()
  .refine((v) => v.status !== undefined || v.note !== undefined, 'Hech narsa o\'zgartirilmadi');

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

// ---------- Competitions ----------
const listCompetitions = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json({ success: true, competitions: await competitions.list() });
});

const getCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  noStore(res);
  const [competition, prizeList, winnerList] = await Promise.all([competitions.get(cid), prizes.listForAdmin(cid), winners.listForAdmin(cid)]);
  res.json({ success: true, competition, prizes: prizeList, winners: winnerList });
});

const createCompetition = asyncHandler(async (req, res) => {
  const data = competitionCreate.parse(req.body);
  const competition = await competitions.create(data, actor(req));
  res.status(201).json({ success: true, competition });
});

const patchCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  const data = competitionPatch.parse(req.body);
  const competition = await competitions.update(cid, data, actor(req));
  invalidatePublicCache();
  res.json({ success: true, competition });
});

const activateCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  const competition = await competitions.activate(cid, actor(req));
  invalidatePublicCache();
  res.json({ success: true, competition });
});

const endCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  const result = await competitions.end(cid, actor(req));
  invalidatePublicCache();
  res.json({ success: true, participants: result.participants, winners: result.winners.length });
});

const archiveCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  const competition = await competitions.archive(cid, actor(req));
  res.json({ success: true, competition });
});

const deleteCompetition = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  await competitions.remove(cid, actor(req));
  res.json({ success: true });
});

// ---------- Prizes ----------
const listPrizes = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  noStore(res);
  res.json({ success: true, prizes: await prizes.listForAdmin(cid) });
});

const createPrize = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  const data = prizeCreate.parse(req.body);
  const prize = await prizes.create(cid, data, actor(req));
  invalidatePublicCache();
  res.status(201).json({ success: true, prize });
});

const patchPrize = asyncHandler(async (req, res) => {
  const { id: pid } = idParams.parse(req.params);
  const data = prizePatch.parse(req.body);
  if (Object.keys(data).length === 0) throw new ApiError(400, 'INVALID_REQUEST', 'O\'zgartirish yo\'q');
  const prize = await prizes.update(pid, data, actor(req));
  invalidatePublicCache();
  res.json({ success: true, prize });
});

const deletePrize = asyncHandler(async (req, res) => {
  const { id: pid } = idParams.parse(req.params);
  await prizes.remove(pid, actor(req));
  invalidatePublicCache();
  res.json({ success: true });
});

/** PUT/POST /api/admin/uploads/prize-image — xom rasm baytlari (image/jpeg|png|webp). Tur magic bytes bo'yicha tekshiriladi. */
const uploadPrizeImage = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Faqat JPEG, PNG yoki WebP rasm yuboring');
  }
  const url = await savePrizeImage(req.body);
  if (!url) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Rasm formati noto\'g\'ri (JPEG, PNG yoki WebP)');
  await record('PRIZE_IMAGE_UPLOADED', { actorTelegramId: actor(req), entityType: 'upload', entityId: url, details: { bytes: req.body.length } });
  res.status(201).json({ success: true, url });
});

// ---------- Winners ----------
const listWinners = asyncHandler(async (req, res) => {
  const { id: cid } = idParams.parse(req.params);
  noStore(res);
  res.json({ success: true, winners: await winners.listForAdmin(cid) });
});

/** POST /api/admin/winners/:id/proof — xom rasm (image/jpeg|png|webp); yangi yuklash eskisini almashtiradi. Faqat admin. */
const uploadWinnerProof = asyncHandler(async (req, res) => {
  const { id: wid } = idParams.parse(req.params);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Faqat JPEG, PNG yoki WebP rasm yuboring');
  }
  const url = await saveProofImage(req.body);
  if (!url) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Rasm formati noto\'g\'ri (JPEG, PNG yoki WebP)');
  const result = await winners.setProof(wid, url, actor(req));
  invalidatePublicCache();
  res.status(201).json({ success: true, proofImage: result.proofImage });
});

const patchWinner = asyncHandler(async (req, res) => {
  const { id: wid } = idParams.parse(req.params);
  const data = winnerPatch.parse(req.body);
  await winners.update(wid, data, actor(req));
  res.json({ success: true });
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
    invalidateLeaderboardCache();
    invalidatePublicCache();
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
  listCompetitions,
  getCompetition,
  createCompetition,
  patchCompetition,
  activateCompetition,
  endCompetition,
  archiveCompetition,
  deleteCompetition,
  listPrizes,
  createPrize,
  patchPrize,
  deletePrize,
  uploadPrizeImage,
  listWinners,
  patchWinner,
  uploadWinnerProof,
};