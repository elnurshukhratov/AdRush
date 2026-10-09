'use strict';

const { asyncHandler } = require('../../utils/apiError');
const { getMyReferrals } = require('../../services/referrals/referralService');

/**
 * GET /api/referrals/me — referral havolam, taklif qilganlar soni va referral orqali olingan olmos.
 * Referral mukofoti faqat botda (yangi user /start ref_<id>) beriladi; bu endpoint faqat o'qiydi.
 */
const me = asyncHandler(async (req, res) => {
  const data = await getMyReferrals(req.auth.user);
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...data });
});

module.exports = { me };