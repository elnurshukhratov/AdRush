'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireAdmin } = require('../middlewares/requireAdmin');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/adminController');
const shop = require('../controllers/shopAdminController');

// Rasm yuklash: xom bayt (image/*). Haqiqiy format imageService da magic bytes bo'yicha tekshiriladi
const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' });

const router = express.Router();

// Tartib: 1) initData (401)  2) admin roli serverda (403)  3) user bo'yicha limit
router.use(telegramAuth, requireAdmin, userLimiter(120, 'admin'));

router.get('/overview', ctrl.overview);

// Xavfsizlik: audit feed va foydalanuvchini bloklash (yozish amallari uchun qattiqroq limit)
router.get('/audit', ctrl.listAudit);
router.get('/users', ctrl.searchUsers);
router.post('/users/:telegramId/block', userLimiter(30, 'admin-block'), ctrl.blockUser);
router.post('/users/:telegramId/unblock', userLimiter(30, 'admin-block'), ctrl.unblockUser);

// Majburiy kanalga obuna (yozuv amallariga qattiqroq limit — Telegram'ga so'rov ketadi)
router.get('/subscription', ctrl.getSubscription);
router.put('/subscription', userLimiter(30, 'admin-subscription'), ctrl.setSubscription);
router.delete('/subscription', userLimiter(30, 'admin-subscription'), ctrl.removeSubscription);

// Do'kon: mahsulotlar
router.get('/shop/products', shop.listProducts);
router.post('/shop/products', userLimiter(30, 'admin-shop-write'), shop.createProduct);
router.patch('/shop/products/:id', userLimiter(60, 'admin-shop-write'), shop.updateProduct);
router.delete('/shop/products/:id', userLimiter(30, 'admin-shop-write'), shop.deleteProduct);
router.post('/uploads/shop-image', userLimiter(20, 'admin-shop-upload'), imageBody, shop.uploadShopImage);

// Do'kon: buyurtmalar
router.get('/shop/orders', shop.listOrders);
router.patch('/shop/orders/:id', userLimiter(60, 'admin-shop-order'), shop.updateOrder);
router.post('/shop/orders/:id/proof', userLimiter(20, 'admin-shop-upload'), imageBody, shop.uploadOrderProof);

module.exports = router;