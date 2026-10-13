'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/walletController');

const router = express.Router();

// Avval identifikatsiya, keyin majburiy obuna, keyin user bo'yicha limit
router.use(telegramAuth, requireSubscription);
router.get('/config', userLimiter(30, 'wallet-config'), ctrl.walletConfig);
router.post('/topup', userLimiter(5, 'wallet-topup'), ctrl.topup);
router.get('/payments/:id', userLimiter(60, 'wallet-payment'), ctrl.paymentStatus);
router.post('/buy-coins', userLimiter(10, 'wallet-buy-coins'), ctrl.buyCoins);

module.exports = router;