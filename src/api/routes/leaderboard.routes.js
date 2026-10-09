'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/leaderboardController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.get('/current', userLimiter(60, 'leaderboard'), ctrl.current);

module.exports = router;