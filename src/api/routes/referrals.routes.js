'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/referralsController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.get('/me', userLimiter(20, 'referrals-me'), ctrl.me);

module.exports = router;