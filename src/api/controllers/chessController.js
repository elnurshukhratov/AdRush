'use strict';

const { z } = require('zod');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const chessGame = require('../../services/chess/chessGameService');
const chessMatch = require('../../services/chess/chessMatchService');

const SQUARE = z.string().regex(/^[a-h][1-8]$/);

const startSchema = z
  .object({
    level: z.number().int().min(1).max(3),
    color: z.enum(['white', 'black', 'random']).default('random'),
  })
  .strict();

const moveSchema = z
  .object({
    from: SQUARE,
    to: SQUARE,
    promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
    expectedMoveCount: z.number().int().min(0).max(2000),
  })
  .strict();

const emptySchema = z.object({}).strict();
const idSchema = z.string().uuid();

const FAIL = Object.freeze({
  GAME_NOT_FOUND: [404, 'O\'yin topilmadi'],
  ALREADY_ACTIVE: [409, 'Sizda tugallanmagan o\'yin bor'],
  GAME_FINISHED: [409, 'O\'yin allaqachon tugagan'],
  MOVE_CONFLICT: [409, 'O\'yin holati o\'zgargan, qayta yuklang'],
  NOT_YOUR_TURN: [409, 'Hozir sizning navbatingiz emas'],
  NOT_SUPPORTED: [409, 'Bu amal bu o\'yin turida mavjud emas'],
  ILLEGAL_MOVE: [422, 'Bunday yurish mumkin emas'],
  PROMOTION_REQUIRED: [422, 'Piyoda uchun figura tanlang'],
  BAD_PROMOTION: [400, 'Figura tanlovi noto\'g\'ri'],
  BAD_MOVE: [400, 'Yurish noto\'g\'ri'],
});

/** Servis natijasini javobga aylantiradi: success:false bo'lsa ApiError (reason jadvaldan). */
function send(res, result) {
  res.set('Cache-Control', 'private, no-store');
  if (!result.success) {
    const [status, message] = FAIL[result.reason] || [400, 'Amal bajarilmadi'];
    const { success: _s, reason, ...extra } = result;
    throw new ApiError(status, reason, message, extra);
  }
  return res.json(result);
}

/** POST /api/chess/bot/start { level: 1..3, color?: 'white'|'black'|'random' } */
const startBot = asyncHandler(async (req, res) => {
  const body = startSchema.parse(req.body);
  send(res, await chessGame.startBotGame(req.auth.user, body));
});

/** GET /api/chess/games/current — faol o'yin yoki { game: null } */
const current = asyncHandler(async (req, res) => {
  send(res, await chessGame.getCurrent(req.auth.user));
});

/** GET /api/chess/games/:id */
const getGame = asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  send(res, await chessGame.getGame(req.auth.user, id));
});

const waitSchema = z
  .object({
    since: z.coerce.number().int().min(0).max(2000),
    st: z.enum(['ACTIVE', 'FINISHED']).default('ACTIVE'),
    ms: z.coerce.number().int().min(1000).max(20000).default(20000),
  })
  .strict();

/** GET /api/chess/games/:id/wait?since=<moveCount>&st=<status>&ms=<kutish> — long-poll: o'zgarish bo'lishi bilan qaytadi */
const wait = asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const q = waitSchema.parse(req.query);
  req.setTimeout(30_000);
  send(res, await chessGame.waitGame(req.auth.user, id, q.since, q.st, q.ms));
});

/** POST /api/chess/games/:id/move { from, to, promotion?, expectedMoveCount } */
const move = asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const body = moveSchema.parse(req.body);
  send(res, await chessGame.makeMove(req.auth.user, id, body));
});

/** POST /api/chess/games/:id/resign */
const resign = asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  emptySchema.parse(req.body || {});
  send(res, await chessGame.resign(req.auth.user, id));
});

/** GET /api/chess/stats — { wins, losses, draws, diamonds } */
const stats = asyncHandler(async (req, res) => {
  send(res, await chessGame.getStats(req.auth.user));
});

/** POST /api/chess/online/queue — navbatga qo'shilish; { status: 'searching' | 'matched', gameId? } */
const joinQueue = asyncHandler(async (req, res) => {
  emptySchema.parse(req.body || {});
  send(res, await chessMatch.joinQueue(req.auth.user));
});

/** GET /api/chess/online/queue — holat (polling); status: 'searching' | 'matched' (+gameId) | 'idle' (navbatda emas) */
const queueStatus = asyncHandler(async (req, res) => {
  send(res, await chessMatch.getQueueStatus(req.auth.user));
});

/** DELETE /api/chess/online/queue — bekor qilish */
const leaveQueue = asyncHandler(async (req, res) => {
  send(res, await chessMatch.leaveQueue(req.auth.user));
});

module.exports = { startBot, current, getGame, wait, move, resign, stats, joinQueue, queueStatus, leaveQueue };