'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/subscriptionController');

const router = express.Router();

// requireSubscription BU YERDA YO'Q: obuna bo'lmagan foydalanuvchi aynan shu endpointlar orqali obunani tasdiqlaydi
router.use(telegramAuth);
router.get('/status', userLimiter(60, 'subscription-status'), ctrl.status);
// /check Telegram'ga so'rov yuboradi — qattiqroq limit
router.post('/check', userLimiter(10, 'subscription-check'), ctrl.check);

module.exports = router;