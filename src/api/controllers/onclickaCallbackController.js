'use strict';

const logger = require('../../utils/logger');
const { asyncHandler } = require('../../utils/apiError');
const { verifyCallbackSource, parseCallbackUserId } = require('../../services/onclicka/onclickaService');
const { registerOnclickaConfirmation } = require('../../services/rewards/rewardService');

/**
 * GET /api/onclicka/reward/<token>?USERID=<telegramId>
 * OnClickA ko'rish tasdig'i (server-to-server). Faqat Telegram user ID keladi (imzo/reward ID yo'q) — shuning uchun
 * tasdiq faqat SHU userning CLAIMED OnClickA sessiyasiga, vaqt oynasi ichida va ko'pi bilan bir marta bog'lanadi.
 * Javob har doim bir xil 200 { success: true } (mos sessiya bor-yo'qligini oshkor qilmaymiz).
 * TODO(ONCLICKA-UNVERIFIED): OnClickA qanday status/body kutishi va retry qilishi hujjatda yo'q.
 */
const onclickaReward = asyncHandler(async (req, res) => {
  verifyCallbackSource(req);
  const telegramId = parseCallbackUserId(req);

  const outcome = await registerOnclickaConfirmation(telegramId);
  logger.info(
    { provider: 'onclicka', telegramId: telegramId.toString(), matched: outcome.matched, counted: outcome.counted, reason: outcome.reason },
    'OnClickA tasdig\'i qayta ishlandi',
  );
  return res.json({ success: true });
});

module.exports = { onclickaReward };