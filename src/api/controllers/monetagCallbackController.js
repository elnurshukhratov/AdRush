'use strict';

const logger = require('../../utils/logger');
const { asyncHandler } = require('../../utils/apiError');
const { verifyPostbackSource, parsePostback } = require('../../services/monetag/monetagService');
const { registerMonetagPostback } = require('../../services/rewards/rewardService');

/**
 * GET /api/monetag/postback?ymid=..&zone_id=..&event_type=..&reward_event_type=..&telegram_id=..&token=<bizning token>
 * Monetag reward postback (server-to-server). Mukofot FAQAT shu yerda, hamma tekshiruvdan o'tgach beriladi.
 *
 * Token noto'g'ri -> 403; format noto'g'ri -> 400; qolgan hamma holat (dublikat, click, non_valued, noma'lum ymid...) -> 200,
 * chunki Monetag 200 bo'lmasa qayta urinadi va bu holatlar qayta urinish bilan to'g'rilanmaydi.
 */
const monetagPostback = asyncHandler(async (req, res) => {
  verifyPostbackSource(req);
  const postback = parsePostback(req);

  const outcome = await registerMonetagPostback(postback);
  logger.info(
    { provider: 'monetag', ymid: postback.ymid, event: postback.eventType, valued: postback.rewardEventType, handled: outcome.handled, counted: outcome.counted, reason: outcome.reason },
    'Monetag postback qayta ishlandi',
  );
  return res.json({ success: true });
});

module.exports = { monetagPostback };