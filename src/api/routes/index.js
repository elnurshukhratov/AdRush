'use strict';

const express = require('express');
const { ipLimiter } = require('../middlewares/rateLimit');
const adsRoutes = require('./ads.routes');
const adsgramRoutes = require('./adsgram.routes');
const monetagRoutes = require('./monetag.routes');
const onclickaRoutes = require('./onclicka.routes');
const usersRoutes = require('./users.routes');
const adminRoutes = require('./admin.routes');
const coinsRoutes = require('./coins.routes');
const referralsRoutes = require('./referrals.routes');
const subscriptionRoutes = require('./subscription.routes');
const shopRoutes = require('./shop.routes');
const walletRoutes = require('./wallet.routes');

const router = express.Router();

router.use(ipLimiter);
router.use('/ads', adsRoutes);
router.use('/adsgram', adsgramRoutes);
router.use('/monetag', monetagRoutes);
router.use('/onclicka', onclickaRoutes);
router.use('/users', usersRoutes);
router.use('/admin', adminRoutes);
router.use('/coins', coinsRoutes);
router.use('/referrals', referralsRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/shop', shopRoutes);
router.use('/wallet', walletRoutes);

module.exports = router;