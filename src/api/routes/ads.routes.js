'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/adsController');

const router = express.Router();

// Avval identifikatsiya, keyin majburiy obuna, keyin user bo'yicha limit
router.use(telegramAuth, requireSubscription);
router.get('/config', userLimiter(30, 'ads-config'), ctrl.adsConfig);
router.post('/session', userLimiter(12, 'ads-session'), ctrl.startSession);
router.post('/reward', userLimiter(12, 'ads-reward'), ctrl.reward);
router.get('/session/:id', userLimiter(60, 'ads-status'), ctrl.sessionStatus);

module.exports = router;