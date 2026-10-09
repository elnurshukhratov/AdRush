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
router.post('/convert', userLimiter(10, 'coins-convert'), ctrl.convert);

module.exports = router;