'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const { asyncHandler } = require('../../utils/apiError');
const { verifyCallbackSource, parseRewardCallback, parseRewardPlacement } = require('../../services/adsgram/adsgramService');
const { registerAdsgramConfirmation } = require('../../services/rewards/rewardService');

/**
 * GET /api/adsgram/reward?userid=<telegramId>&placement=task|quick&token=<bizning token>
 * AdsGram Reward URL (server-to-server). Faqat server_confirmed rejimida ishlaydi.
 *
 * placement — BIZNING statik parametrimiz (AdsGram uni yuborishini hujjat kafolatlamaydi, lekin URL ga yozilgan statik
 * parametr sifatida saqlanadi deb hisoblaymiz — token ham xuddi shunday ishlaydi). Vazifalar bloki Reward URL ida placement=task,
 * tepadagi +1 bloki Reward URL ida placement=quick bo'lishi kerak. Berilmasa 'task'.
 *
 * Javob har doim bir xil 200 { success: true } (mos sessiya bor-yo'qligini tashqariga oshkor qilmaymiz).
 * TODO(ADSGRAM-UNVERIFIED): AdsGram qanday status/body kutishi va xatoda retry qilishi hujjatda yo'q.
 */
const adsgramReward = asyncHandler(async (req, res) => {
  verifyCallbackSource(req);
  const telegramId = parseRewardCallback(req);
  const placement = parseRewardPlacement(req);

  if (config.adsgram.verifyMode !== 'server_confirmed') {
    return res.json({ success: true });
  }

  const outcome = await registerAdsgramConfirmation(telegramId, placement);
  logger.info(
    { provider: 'adsgram', placement, telegramId: telegramId.toString(), matched: outcome.matched, counted: outcome.counted, reason: outcome.reason },
    'AdsGram Reward URL tasdig\'i qayta ishlandi',
  );
  return res.json({ success: true });
});

module.exports = { adsgramReward };