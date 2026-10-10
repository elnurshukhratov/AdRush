'use strict';

const express = require('express');
const { onclickaCallbackLimiter } = require('../middlewares/rateLimit');
const { onclickaReward } = require('../controllers/onclickaCallbackController');

const router = express.Router();

// Token URL yo'lida: OnClickA ?USERID= ni URL oxiriga o'zi qo'shadi. (Query dagi ?token= ham qabul qilinadi — zaxira.)
router.get('/reward/:token', onclickaCallbackLimiter, onclickaReward);
router.get('/reward', onclickaCallbackLimiter, onclickaReward);

module.exports = router;