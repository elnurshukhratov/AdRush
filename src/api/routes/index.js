'use strict';

const express = require('express');
const { ipLimiter } = require('../middlewares/rateLimit');
const adsRoutes = require('./ads.routes');
const adsgramRoutes = require('./adsgram.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const usersRoutes = require('./users.routes');
const competitionRoutes = require('./competition.routes');
const adminRoutes = require('./admin.routes');
const coinsRoutes = require('./coins.routes');
const referralsRoutes = require('./referrals.routes');
const subscriptionRoutes = require('./subscription.routes');

const router = express.Router();

router.use(ipLimiter);
router.use('/ads', adsRoutes);
router.use('/adsgram', adsgramRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/users', usersRoutes);
router.use('/competition', competitionRoutes);
router.use('/admin', adminRoutes);
router.use('/coins', coinsRoutes);
router.use('/referrals', referralsRoutes);
router.use('/subscription', subscriptionRoutes);

module.exports = router;