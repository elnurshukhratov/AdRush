'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../utils/apiError');
const { verifyCallbackSource, parseRewardCallback } = require('../../services/adsgram/adsgramService');
const { registerAdsgramConfirmation } = require('../../services/rewards/rewardService');

/**
 * GET /api/adsgram/reward?userid=<telegramId>&token=<bizning token>
 * AdsGram Reward URL (server-to-server). Faqat server_confirmed rejimida ishlaydi.
 *
 * Javob har doim bir xil 200 { success: true } (mos sessiya bor-yo'qligini tashqariga oshkor qilmaymiz).
 * TODO(ADSGRAM-UNVERIFIED): AdsGram qanday status/body kutishi va xatoda retry qilishi hujjatda yo'q.
 * Agar AdsGram support boshqa format talab qilsa, faqat shu javobni o'zgartiring.
 */
const adsgramReward = asyncHandler(async (req, res) => {
  verifyCallbackSource(req);
  const telegramId = parseRewardCallback(req);

  if (config.adsgram.verifyMode !== 'server_confirmed') {
    return res.json({ success: true });
  }

  const outcome = await registerAdsgramConfirmation(telegramId);
  logger.info(
    { telegramId: telegramId.toString(), matched: outcome.matched, counted: outcome.counted, reason: outcome.reason },
    'AdsGram Reward URL tasdig\'i qayta ishlandi',
  );
  return res.json({ success: true });
});

module.exports = { adsgramReward };
