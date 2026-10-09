'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/competitionController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.get('/current', userLimiter(60, 'competition'), ctrl.current);
router.get('/history', userLimiter(30, 'competition-history'), ctrl.history);
router.get('/bets', userLimiter(30, 'competition-bets'), ctrl.myBets);
// Tikish: spamdan himoya (qo'shimcha ravishda server faol betlar limiti va balans tekshiruvi bor)
router.post('/bet', userLimiter(10, 'competition-bet'), ctrl.bet);

module.exports = router;