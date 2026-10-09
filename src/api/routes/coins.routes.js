'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/coinsController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.get('/history', userLimiter(30, 'coins-history'), ctrl.history);
router.post('/transfer', userLimiter(5, 'coins-transfer'), ctrl.transfer);

module.exports = router;