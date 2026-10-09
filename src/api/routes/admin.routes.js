'use strict';

const express = require('express');
const config = require('../../config');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireAdmin } = require('../middlewares/requireAdmin');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/adminController');

const router = express.Router();

// Tartib: 1) initData (401)  2) admin roli serverda (403)  3) user bo'yicha limit
router.use(telegramAuth, requireAdmin, userLimiter(120, 'admin'));

router.get('/overview', ctrl.overview);

router.get('/competitions', ctrl.listCompetitions);
router.post('/competitions', ctrl.createCompetition);
router.get('/competitions/:id', ctrl.getCompetition);
router.patch('/competitions/:id', ctrl.patchCompetition);
router.delete('/competitions/:id', ctrl.deleteCompetition);
router.post('/competitions/:id/activate', ctrl.activateCompetition);
router.post('/competitions/:id/end', ctrl.endCompetition);
router.post('/competitions/:id/archive', ctrl.archiveCompetition);

router.get('/competitions/:id/prizes', ctrl.listPrizes);
router.post('/competitions/:id/prizes', ctrl.createPrize);
router.patch('/prizes/:id', ctrl.patchPrize);
router.delete('/prizes/:id', ctrl.deletePrize);

// Xom rasm: global express.json faqat application/json ni o'qiydi, shuning uchun bu yerda alohida raw parser
router.post(
  '/uploads/prize-image',
  userLimiter(30, 'admin-upload'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: config.uploads.maxBytes }),
  ctrl.uploadPrizeImage,
);

router.get('/competitions/:id/winners', ctrl.listWinners);
router.patch('/winners/:id', ctrl.patchWinner);
router.post(
  '/winners/:id/proof',
  userLimiter(30, 'admin-upload'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: config.uploads.maxBytes }),
  ctrl.uploadWinnerProof,
);

// Xavfsizlik: audit feed va foydalanuvchini bloklash (yozish amallari uchun qattiqroq limit)
router.get('/audit', ctrl.listAudit);
router.get('/users', ctrl.searchUsers);
router.post('/users/:telegramId/block', userLimiter(30, 'admin-block'), ctrl.blockUser);
router.post('/users/:telegramId/unblock', userLimiter(30, 'admin-block'), ctrl.unblockUser);

// Majburiy kanalga obuna (yozuv amallariga qattiqroq limit — Telegram'ga so'rov ketadi)
router.get('/subscription', ctrl.getSubscription);
router.put('/subscription', userLimiter(30, 'admin-subscription'), ctrl.setSubscription);
router.delete('/subscription', userLimiter(30, 'admin-subscription'), ctrl.removeSubscription);

module.exports = router;