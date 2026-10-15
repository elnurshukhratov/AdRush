'use strict';

const express = require('express');
const { telegramAuth } = require('../middlewares/telegramAuth');
const { requireSubscription } = require('../middlewares/requireSubscription');
const { userLimiter } = require('../middlewares/rateLimit');
const ctrl = require('../controllers/chessController');

const router = express.Router();

router.use(telegramAuth, requireSubscription);
router.post('/bot/start', userLimiter(10, 'chess-start'), ctrl.startBot);
router.get('/games/current', userLimiter(60, 'chess-current'), ctrl.current); // :id dan oldin turishi shart
router.get('/games/:id/wait', userLimiter(120, 'chess-wait'), ctrl.wait); // long-poll (≤20 s): raqib / bot yurishi darrov keladi
router.get('/games/:id', userLimiter(180, 'chess-game'), ctrl.getGame);
router.post('/games/:id/move', userLimiter(60, 'chess-move'), ctrl.move);
router.post('/games/:id/resign', userLimiter(10, 'chess-resign'), ctrl.resign);
router.post('/online/queue', userLimiter(10, 'chess-queue-join'), ctrl.joinQueue);
router.get('/online/queue', userLimiter(120, 'chess-queue-status'), ctrl.queueStatus); // klient ≈1.2 s da so'raydi
router.delete('/online/queue', userLimiter(20, 'chess-queue-leave'), ctrl.leaveQueue);
router.get('/stats', userLimiter(30, 'chess-stats'), ctrl.stats);

module.exports = router;