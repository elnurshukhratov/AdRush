'use strict';

const express = require('express');
const { callbackLimiter } = require('../middlewares/rateLimit');
const { adsgramReward } = require('../controllers/adsgramCallbackController');

const router = express.Router();

router.get('/reward', callbackLimiter, adsgramReward);

module.exports = router;
