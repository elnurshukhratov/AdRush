'use strict';

const express = require('express');
const { monetagCallbackLimiter } = require('../middlewares/rateLimit');
const { monetagPostback } = require('../controllers/monetagCallbackController');

const router = express.Router();

router.get('/postback', monetagCallbackLimiter, monetagPostback);

module.exports = router;