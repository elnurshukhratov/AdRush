'use strict';

const { asyncHandler } = require('../../utils/apiError');
const { getAdminRole } = require('../../services/admin/adminService');
const subscriptionService = require('../../services/subscription/subscriptionService');
const { toClientChannel } = require('../middlewares/requireSubscription');

const noStore = (res) => res.set('Cache-Control', 'private, no-store');

/**
 * GET /api/subscription/status
 * Foydalanuvchi faqat initData orqali aniqlanadi. Admin uchun majburiy obuna yo'q.
 * Javob: { success, required, subscribed, channel }
 */
const status = asyncHandler(async (req, res) => {
  noStore(res);
  if (await getAdminRole(req.auth.user.telegramId)) {
    return res.json({ success: true, required: false, subscribed: true, channel: null });
  }
  const st = await subscriptionService.getStatus(req.auth.user.telegramId);
  return res.json({ success: true, required: st.required, subscribed: st.subscribed, channel: toClientChannel(st.channel) });
});

/**
 * POST /api/subscription/check — obunani Telegram orqali tekshiradi va birinchi marta bo'lsa +Rush beradi.
 * Javob: { success, required, subscribed, rewarded, amount, channel }
 */
const check = asyncHandler(async (req, res) => {
  noStore(res);
  if (await getAdminRole(req.auth.user.telegramId)) {
    return res.json({ success: true, required: false, subscribed: true, rewarded: false, amount: 0, channel: null });
  }
  const r = await subscriptionService.checkAndReward(req.auth.user);
  return res.json({
    success: true,
    required: r.required,
    subscribed: r.subscribed,
    rewarded: r.rewarded,
    amount: r.amount,
    channel: toClientChannel(r.channel),
  });
});

module.exports = { status, check };