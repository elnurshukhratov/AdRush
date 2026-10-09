'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/usersController');

const router = express.Router();

router.use(telegramAuth);
router.get('/me', userLimiter(60, 'me'), ctrl.me);
router.post('/me/language', userLimiter(30, 'me-language'), ctrl.setMyLanguage);
// /me va /me/language OCHIQ (obuna ekrani tilni va rolni bilishi kerak); statistika majburiy obunadan keyin
router.get('/me/stats', requireSubscription, userLimiter(60, 'me-stats'), ctrl.myStats);

module.exports = router;