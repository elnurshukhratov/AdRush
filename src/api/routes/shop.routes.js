'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/shopController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.get('/products', userLimiter(60, 'shop-products'), ctrl.products);
router.post('/buy', userLimiter(10, 'shop-buy'), ctrl.buy);
router.get('/orders', userLimiter(30, 'shop-orders'), ctrl.orders);

module.exports = router;