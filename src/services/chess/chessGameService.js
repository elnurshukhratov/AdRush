'use strict';

const { randomInt } = require('crypto');
const { prisma } = require('../../db/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { lockUser } = require('../../utils/dbLock');
const { TX_OPTS, TxAbort, fail, getBalances } = require('../coins/coinService');
const { settleGame, lockPlayers } = require('./chessRewardService');
const { getEngine, normalizeGameType } = require('./gameEngines');
const bot = require('./chessBot');
const { displayName } = require('../../utils/format');

/**
 * Shahmat va shashka o'yin servisi (BOT va ONLINE rejimlar). Server — yagona haqiqat manbai: klient shahmatda faqat from/to/promotion, shashkada faqat path yuboradi.
 *  - Har bir yozish tranzaksiyada: o'yinchi advisory-qulfi (lockPlayers) -> o'yin qatori FOR UPDATE; o'yin tugasa settleGame SHU tranzaksiyada.
 *  - Yurish `expectedMoveCount` bilan idempotent: bir yurish ikki marta qo'llanmaydi (mos kelmasa MOVE_CONFLICT).
 *  - Bot hisob-kitobi (3 s gacha) tranzaksiyadan TASHQARIDA (worker'da); natija yozilishida holat qayta tekshiriladi.
 *  - Bot navbatida qotib qolgan o'yin (bot javobi yozilmay qolgan bo'lsa) o'yin so'ralganda / maintenance'da o'zi tiklanadi.
 *  - ONLINE: soatni server hisoblaydi (lastMoveAt farqi), klient vaqtiga ishonilmaydi. Vaqt tugasa TIMEOUT (vaqti tugagan tomon yutqazadi) —
 *    holat so'ralganda, yurish/taslimda va maintenance'da (expireIfFlagged) tekshiriladi; hammasi settleGame bilan bir tranzaksiyada.
 * Servis { success, ... } qaytaradi (coinService uslubida); xatoda { success:false, reason, ...extra } — controller ApiError'ga aylantiradi.
 */

const inflight = new Map(); // bir xil (o'yin, yurish raqami) uchun bot ikki marta hisoblamasin

/**
 * O'yin o'zgarishlari xabarchisi: yurish / tugash COMMIT bo'lgandan keyin notify(gameId) chaqiriladi va shu o'yinni
 * kutayotgan (long-poll) so'rovlar DARHOL uyg'onadi — raqib yurishi polling kutmasdan, ~100 ms ichida ko'rinadi.
 * Bir nechta instansiya bo'lsa — kutuvchi so'rov baribir har WAIT_DB_CHECK_MS da DB'ni tekshiradi (zaxira).
 */
const waiters = new Map(); // gameId -> Set<() => void>
function notify(gameId) {
  const set = waiters.get(gameId);
  if (!set) return;
  for (const fn of [...set]) fn();
}
function addWaiter(gameId, fn) {
  let set = waiters.get(gameId);
  if (!set) { set = new Set(); waiters.set(gameId, set); }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) waiters.delete(gameId);
  };
}
const WAIT_MAX_MS = 20_000; // bitta long-poll so'rovi ko'pi bilan shuncha kutadi (reverse proxy 60 s dan kam)
const WAIT_DB_CHECK_MS = 1_500;

const oppCache = new Map(); // userId -> { name, exp } (raqib ismi o'yin davomida o'zgarmaydi)

function lockRow(tx, id) {
  return tx.$queryRaw`SELECT "id" FROM "ChessGame" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

function movesOf(game) {
  return Array.isArray(game.moves) ? game.moves : [];
}

/** O'yin turiga mos dvigatel (eski o'yinlarda gameType yo'q bo'lsa — shahmat). */
function engineOf(game) {
  return getEngine(game.gameType);
}

/** Shashka o'yinimi (eski o'yinlarda gameType yo'q bo'lsa — shahmat). */
function isCheckersGame(game) {
  return normalizeGameType(game.gameType) === 'CHECKERS';
}

/** Foydalanuvchining rangi: 'w' | 'b' | null (ishtirokchi emas). */
function colorOf(game, userId) {
  if (game.whiteUserId === userId) return 'w';
  if (game.blackUserId === userId) return 'b';
  return null;
}

/** Bot o'yinida botning rangi (foydalanuvchining teskarisi). */
function botColorOf(game) {
  return game.whiteUserId != null ? 'b' : 'w';
}

function isBotTurn(game) {
  return game.mode === 'BOT' && game.status === 'ACTIVE' && engineOf(game).turnFromCount(game.moveCount) === botColorOf(game);
}

/** Onlayn o'yin ekanligi. */
function isOnline(game) {
  return game.mode === 'ONLINE';
}

/** Soatlarning hozirgi qiymati (ms): navbatdagi tomonning vaqtidan lastMoveAt dan beri o'tgan vaqt ayiriladi. Bot o'yinida soat yo'q (null). */
function clockOf(game, nowMs) {
  if (!isOnline(game)) return { whiteMs: null, blackMs: null };
  const w = game.whiteTimeMs ?? 0;
  const b = game.blackTimeMs ?? 0;
  if (game.status !== 'ACTIVE') return { whiteMs: w, blackMs: b };
  const elapsed = Math.max(0, nowMs - game.lastMoveAt.getTime());
  return engineOf(game).turnFromCount(game.moveCount) === 'w'
    ? { whiteMs: Math.max(0, w - elapsed), blackMs: b }
    : { whiteMs: w, blackMs: Math.max(0, b - elapsed) };
}

/** Faol onlayn o'yinda vaqti tugagan tomon: 'w' | 'b' | null. */
function flaggedColor(game, nowMs) {
  if (!isOnline(game) || game.status !== 'ACTIVE') return null;
  const c = clockOf(game, nowMs);
  const turn = engineOf(game).turnFromCount(game.moveCount);
  return (turn === 'w' ? c.whiteMs : c.blackMs) <= 0 ? turn : null;
}

/**
 * Tugagan o'yinda olmos o'zgarmagan sababi (limit faqat hisob-kitob paytida hisoblanadi, shuning uchun qayta aniqlanadi):
 * 'MIN_MOVES' | 'BOT_DAILY_LIMIT' | 'PAIR_LIMIT' | null.
 */
function limitOf(game, yourColor, yourDelta) {
  if (game.status !== 'FINISHED' || yourDelta == null) return null;
  const winner = game.result === 'WHITE' ? 'w' : game.result === 'BLACK' ? 'b' : null;
  if (!winner) return null;
  const min = config.chess.minUserMoves;
  const movesOfColor = (c) => (c === 'w' ? Math.ceil(game.moveCount / 2) : Math.floor(game.moveCount / 2));

  if (game.mode === 'BOT') {
    if (winner !== yourColor || yourDelta > 0) return null;
    return movesOfColor(yourColor) < min ? 'MIN_MOVES' : 'BOT_DAILY_LIMIT';
  }

  // ONLINE: g'olibning delta'sidan aniqlanadi (ikkala tomonga ham bir xil izoh)
  const winnerDelta = winner === 'w' ? game.whiteDelta : game.blackDelta;
  if (winnerDelta > 0) return null;
  if (movesOfColor('w') < min && movesOfColor('b') < min) return 'MIN_MOVES';
  if (movesOfColor(winner) < min) return yourColor === winner ? 'MIN_MOVES' : null; // yutqazgandan baribir ayiriladi
  return 'PAIR_LIMIT';
}

/** Onlayn raqib: faqat ism / username (escape qilingan), boshqa shaxsiy ma'lumot yo'q. */
async function opponentOf(game, userId) {
  const oppId = game.whiteUserId === userId ? game.blackUserId : game.whiteUserId;
  const hit = oppId == null ? null : oppCache.get(oppId);
  if (hit && hit.exp > Date.now()) return { type: 'USER', name: hit.name };
  const u = oppId == null ? null : await prisma.user.findUnique({ where: { id: oppId }, select: { username: true, firstName: true } });
  const cut = (v) => (v ? String(v).slice(0, 32) : v);
  const name = displayName({ username: cut(u && u.username), firstName: cut(u && u.firstName) });
  if (oppId != null) {
    if (oppCache.size > 500) oppCache.delete(oppCache.keys().next().value);
    oppCache.set(oppId, { name, exp: Date.now() + 10 * 60_000 });
  }
  return { type: 'USER', name };
}

/** O'yinning klientga ketadigan ko'rinishi. legalMoves faqat faol o'yinda va sening navbating bo'lsagina to'ldiriladi. */
async function toView(game, userId) {
  const moves = movesOf(game);
  const eng = engineOf(game);
  const checkers = isCheckersGame(game);
  const state = eng.getState(moves);
  const yourColor = colorOf(game, userId);
  const active = game.status === 'ACTIVE';
  const yourDelta = active ? null : yourColor === 'w' ? game.whiteDelta : game.blackDelta;
  const [balances, opponent] = await Promise.all([
    getBalances(userId),
    isOnline(game) ? opponentOf(game, userId) : Promise.resolve({ type: 'BOT', level: game.botLevel }),
  ]);
  const clock = clockOf(game, Date.now());

  return {
    id: game.id,
    gameType: normalizeGameType(game.gameType), // 'CHESS' | 'CHECKERS'
    mode: game.mode,
    status: game.status,
    fen: game.fen, // shashkada — pozitsiya matni
    moves,
    moveCount: game.moveCount,
    turn: state.turn, // 'w' | 'b'
    yourColor, // 'w' | 'b'
    inCheck: active && !!state.inCheck,
    lastMove: eng.lastMove(moves), // shahmatda { from, to }, shashkada { path }
    // shahmatda { from: [to...] }, shashkada to'liq yo'llar ro'yxati [['c3','e5'], ...]
    legalMoves: active && state.turn === yourColor ? state.legalMoves : checkers ? [] : {},
    whiteTimeMs: clock.whiteMs, // onlayn: serverning joriy hisobi; bot o'yinida null
    blackTimeMs: clock.blackMs,
    incrementMs: isOnline(game) ? game.incrementMs : 0,
    result: game.result, // 'WHITE' | 'BLACK' | 'DRAW' | null
    endReason: game.endReason,
    yourDelta,
    limit: limitOf(game, yourColor, yourDelta),
    ...(checkers ? { mustCapture: active && state.turn === yourColor && !!state.mustCapture } : {}),
    opponent, // { type:'BOT', level } | { type:'USER', name }
    diamonds: balances.diamonds,
  };
}

/** Yurishni yozadi (onlayn: yurgan tomonning soati yangilanadi + increment); o'yin tugasa FINISHED qiladi va settleGame ni shu tranzaksiyada chaqiradi. */
async function persistMove(tx, game, next, now = new Date()) {
  const over = next.state.over;
  const data = {
    moves: next.moves,
    fen: next.state.position,
    moveCount: game.moveCount + 1,
    lastMoveAt: now,
    ...(over ? { status: 'FINISHED', result: next.state.result, endReason: next.state.endReason } : {}),
  };
  if (isOnline(game)) {
    const c = clockOf(game, now.getTime());
    if (engineOf(game).turnFromCount(game.moveCount) === 'w') data.whiteTimeMs = c.whiteMs + game.incrementMs;
    else data.blackTimeMs = c.blackMs + game.incrementMs;
  }
  const updated = await tx.chessGame.update({ where: { id: game.id }, data });
  if (over) await settleGame(tx, updated);
  return updated;
}

/** Vaqti tugagan tomon yutqazadi (TIMEOUT). Qolgan material mat qilishga yetmasa — durang. settleGame shu tranzaksiyada. */
async function finishByTimeout(tx, game, loserColor) {
  const eng = engineOf(game);
  const draw = typeof eng.isInsufficientMaterial === 'function' ? eng.isInsufficientMaterial(movesOf(game)) : false;
  const updated = await tx.chessGame.update({
    where: { id: game.id },
    data: {
      status: 'FINISHED',
      result: draw ? 'DRAW' : loserColor === 'w' ? 'BLACK' : 'WHITE',
      endReason: draw ? 'DRAW_RULE' : 'TIMEOUT',
      ...(loserColor === 'w' ? { whiteTimeMs: 0 } : { blackTimeMs: 0 }),
    },
  });
  await settleGame(tx, updated);
}

/** Onlayn o'yinda vaqt tugagan bo'lsa (qulf ostida qayta tekshirib) o'yinni yakunlaydi. true — shu chaqiruvda tugatildi. */
async function expireIfFlagged(gameId) {
  try {
    return await prisma.$transaction(async (tx) => {
      const g0 = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (!g0 || !isOnline(g0) || g0.status !== 'ACTIVE') return false;
      await lockPlayers(tx, g0);
      await lockRow(tx, gameId);
      const game = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (!game || game.status !== 'ACTIVE') return false;
      const flag = flaggedColor(game, Date.now());
      if (!flag) return false;
      await finishByTimeout(tx, game, flag);
      return true;
    }, TX_OPTS).then((done) => { if (done) notify(gameId); return done; });
  } catch (err) {
    logger.error({ err, gameId }, 'Onlayn o\'yin vaqtini tugatishda xato');
    return false;
  }
}

/**
 * Botning javob yurishi. expectedCount — bot yurishi kerak bo'lgan paytdagi moveCount; boshqa bo'lsa (taslim, parallel so'rov) hech narsa qilinmaydi.
 * Bir xil (o'yin, moveCount) uchun parallel chaqiruvlar bitta hisob-kitobga birlashadi.
 */
function botReply(gameId, expectedCount) {
  const key = `${gameId}:${expectedCount}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const game = await prisma.chessGame.findUnique({ where: { id: gameId } });
    if (!game || game.moveCount !== expectedCount || !isBotTurn(game)) return;

    const type = normalizeGameType(game.gameType);
    let move = await bot.chooseMove(game.fen, game.botLevel || 2, type); // tranzaksiyadan tashqarida (3 s gacha)
    if (!move) return;
    const moves = movesOf(game);
    const eng = engineOf(game);

    try {
      await prisma.$transaction(async (tx) => {
        await lockPlayers(tx, game);
        await lockRow(tx, gameId);
        const fresh = await tx.chessGame.findUnique({ where: { id: gameId } });
        if (!fresh || fresh.moveCount !== expectedCount || !isBotTurn(fresh)) return; // bu orada o'zgargan (taslim va h.k.)

        let next = eng.applyMove(moves, move);
        if (!next.ok) {
          logger.warn({ gameId, move, reason: next.reason }, `${type === 'CHECKERS' ? 'Shashka' : 'Shahmat'} boti noqonuniy yurish qaytardi, zaxira ishlatildi`);
          move = eng.randomMove(fresh.fen);
          next = move ? eng.applyMove(moves, move) : next;
          if (!next.ok) return;
        }
        await persistMove(tx, fresh, next);
      }, TX_OPTS);
      notify(gameId); // commit'dan keyin: kutayotgan klient bot yurishini darrov oladi
    } catch (err) {
      logger.error({ err, gameId }, 'Bot yurishini yozishda xato');
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** So'raladigan o'yinni tiklaydi: onlayn — vaqti tugagan bo'lsa yakunlaydi; bot — botning navbatida qolgan bo'lsa javob yurishini beradi. Yangilangan o'yinni qaytaradi. */
async function healGame(game) {
  if (isOnline(game)) {
    if (!flaggedColor(game, Date.now())) return game;
    await expireIfFlagged(game.id);
    return (await prisma.chessGame.findUnique({ where: { id: game.id } })) || game;
  }
  return healBotTurn(game);
}

/** Faol bot o'yini botning navbatida qolgan bo'lsa, javob yurishini beradi va yangilangan o'yinni qaytaradi. */
async function healBotTurn(game) {
  if (!isBotTurn(game)) return game;
  await botReply(game.id, game.moveCount);
  return (await prisma.chessGame.findUnique({ where: { id: game.id } })) || game;
}

async function findActive(userId) {
  return prisma.chessGame.findFirst({
    where: { status: 'ACTIVE', OR: [{ whiteUserId: userId }, { blackUserId: userId }] },
    orderBy: { createdAt: 'desc' },
  });
}

/** Bot bilan o'yin boshlash. color: 'white' | 'black' | 'random'; gameType: 'CHESS' (standart) | 'CHECKERS'. Faol o'yin bo'lsa ALREADY_ACTIVE { gameId }. */
async function startBotGame(user, { level, color, gameType = 'CHESS' }) {
  const type = normalizeGameType(gameType);
  const startPosition = getEngine(type).START_POSITION; // noma'lum tur bo'lsa aniq xato tashlaydi
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.telegramId);

      const existing = await tx.chessGame.findFirst({
        where: { status: 'ACTIVE', OR: [{ whiteUserId: user.id }, { blackUserId: user.id }] },
        select: { id: true },
      });
      if (existing) throw new TxAbort(fail('ALREADY_ACTIVE', { gameId: existing.id }));

      await tx.chessQueue.deleteMany({ where: { userId: user.id } }); // bot tanlandi — onlayn navbatdan chiqadi

      const userColor = color === 'white' ? 'w' : color === 'black' ? 'b' : randomInt(2) === 0 ? 'w' : 'b';
      return tx.chessGame.create({
        data: {
          gameType: type,
          mode: 'BOT',
          whiteUserId: userColor === 'w' ? user.id : null,
          blackUserId: userColor === 'b' ? user.id : null,
          botLevel: level,
          fen: startPosition,
          moves: [],
          moveCount: 0,
        },
      });
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    throw err;
  }

  const game = created;
  // Foydalanuvchi qora bo'lsa bot birinchi yuradi: javobni KUTMAYMIZ (klient /wait orqali oladi) — o'yin ochilishi tezlashadi
  if (isBotTurn(game)) botReply(game.id, game.moveCount).catch(() => {});
  return { success: true, game: await toView(game, user.id) };
}

/** Joriy faol o'yin yoki null. */
async function getCurrent(user) {
  let game = await findActive(user.id);
  if (!game) return { success: true, game: null };
  game = await healGame(game); // onlayn o'yin vaqti tugagan bo'lsa FINISHED holatda qaytadi (natija bir marta ko'rsatiladi)
  return { success: true, game: await toView(game, user.id) };
}

/** O'yin holati (faqat ishtirokchi). */
async function getGame(user, gameId) {
  let game = await prisma.chessGame.findUnique({ where: { id: gameId } });
  if (!game || !colorOf(game, user.id)) return fail('GAME_NOT_FOUND');
  game = await healGame(game);
  return { success: true, game: await toView(game, user.id) };
}

/**
 * Yurish: shahmat { from, to, promotion?, expectedMoveCount } YOKI shashka { path, expectedMoveCount }.
 * Kirish shakli o'yin turiga mos bo'lmasa BAD_MOVE. Natijada bot javobi ham (bo'lsa) hisobga olingan holat qaytadi.
 */
async function makeMove(user, gameId, { from, to, promotion, path, expectedMoveCount }) {
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const g0 = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (!g0 || !colorOf(g0, user.id)) throw new TxAbort(fail('GAME_NOT_FOUND'));
      await lockPlayers(tx, g0);
      await lockRow(tx, gameId);

      const game = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (game.status !== 'ACTIVE') throw new TxAbort(fail('GAME_FINISHED'));
      if (game.moveCount !== expectedMoveCount) throw new TxAbort(fail('MOVE_CONFLICT'));

      const now = new Date();
      const flag = flaggedColor(game, now.getTime());
      if (flag) {
        // vaqt tugagan: yurish qabul qilinmaydi, o'yin TIMEOUT bilan tugaydi (commit bo'ladi)
        await finishByTimeout(tx, game, flag);
        return { over: true, moveCount: game.moveCount, mode: game.mode };
      }
      const eng = engineOf(game);
      // kirish shakli o'yin turiga mos bo'lsin: shashkada faqat path, shahmatda faqat from/to/promotion
      const checkers = isCheckersGame(game);
      const hasPath = path !== undefined;
      const hasSquares = from !== undefined || to !== undefined || promotion !== undefined;
      if (checkers ? !hasPath || hasSquares : hasPath || from === undefined || to === undefined) throw new TxAbort(fail('BAD_MOVE'));
      if (eng.turnFromCount(game.moveCount) !== colorOf(game, user.id)) throw new TxAbort(fail('NOT_YOUR_TURN'));

      const next = eng.applyMove(movesOf(game), checkers ? { path } : { from, to, promotion });
      if (!next.ok) throw new TxAbort(fail(next.reason));

      const updated = await persistMove(tx, game, next, now);
      return { over: next.state.over, moveCount: updated.moveCount, mode: game.mode };
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    throw err;
  }

  notify(gameId); // raqib (onlayn) shu zahoti yangilanishni oladi
  // Bot javobi fonda hisoblanadi — foydalanuvchining yurishi DARHOL tasdiqlanadi (sekin internetda ham bot hisobini kutib o'tirmaydi).
  // Natija klientga /wait (long-poll) orqali keladi; server qayta ishga tushsa ham getGame/maintenance tiklaydi.
  if (!outcome.over && outcome.mode === 'BOT') botReply(gameId, outcome.moveCount).catch(() => {});
  const game = await prisma.chessGame.findUnique({ where: { id: gameId } });
  return { success: true, game: await toView(game, user.id) };
}

/** Taslim bo'lish: raqib yutadi (RESIGN). Olmos settleGame bilan (bot: -CHESS_LOSS_DIAMONDS; onlayn: minimal yurish / juftlik limiti qoidalari bilan). */
async function resign(user, gameId) {
  try {
    await prisma.$transaction(async (tx) => {
      const g0 = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (!g0 || !colorOf(g0, user.id)) throw new TxAbort(fail('GAME_NOT_FOUND'));
      await lockPlayers(tx, g0);
      await lockRow(tx, gameId);

      const game = await tx.chessGame.findUnique({ where: { id: gameId } });
      if (game.status !== 'ACTIVE') throw new TxAbort(fail('GAME_FINISHED'));

      const flag = flaggedColor(game, Date.now());
      if (flag) {
        await finishByTimeout(tx, game, flag); // taslimdan oldin vaqt tugagan bo'lsa — TIMEOUT
        return;
      }

      const updated = await tx.chessGame.update({
        where: { id: gameId },
        data: {
          status: 'FINISHED',
          result: colorOf(game, user.id) === 'w' ? 'BLACK' : 'WHITE',
          endReason: 'RESIGN',
          lastMoveAt: new Date(),
        },
      });
      await settleGame(tx, updated);
    }, TX_OPTS);
  } catch (err) {
    if (err instanceof TxAbort) return err.result;
    throw err;
  }
  notify(gameId);
  const game = await prisma.chessGame.findUnique({ where: { id: gameId } });
  return { success: true, game: await toView(game, user.id) };
}

/**
 * Long-poll: klient bilgan moveCount (since) / status dan keyin o'yin o'zgarsa DARHOL, aks holda ko'pi bilan ~20 s dan keyin qaytadi.
 *  - O'zgarish bo'lsa: { success, changed:true, game } (to'liq ko'rinish); bo'lmasa { success, changed:false, moveCount, turn, whiteTimeMs, blackTimeMs } (kichik javob).
 *  - Botning navbatida qolgan bo'lsa bot yurishi shu yerda ishga tushiriladi (botReply parallel chaqiruvlarni birlashtiradi).
 *  - Onlayn o'yinda vaqt tugashi ham kutish paytida aniqlanadi (soat tugagan zahoti natija).
 * since — klientda ko'rsatilgan moveCount, st — klientdagi status ('ACTIVE' | 'FINISHED').
 */
async function waitGame(user, gameId, since, st = 'ACTIVE', maxMs = WAIT_MAX_MS) {
  const t0 = Date.now();
  const deadline = t0 + Math.min(maxMs, WAIT_MAX_MS);
  let game = await prisma.chessGame.findUnique({ where: { id: gameId } });
  if (!game || !colorOf(game, user.id)) return fail('GAME_NOT_FOUND');

  const changed = (g) => g.moveCount !== since || g.status !== st;
  if (!changed(game) && isBotTurn(game)) botReply(game.id, game.moveCount).catch(() => {}); // qotib qolgan bot yurishi

  let wake = null;
  let timer = null;
  const off = addWaiter(gameId, () => { if (wake) wake(); });
  try {
    for (;;) {
      if (changed(game)) break;
      if (isOnline(game) && flaggedColor(game, Date.now())) { // vaqt tugadi: shu zahoti yakunlanadi
        await expireIfFlagged(gameId);
        game = (await prisma.chessGame.findUnique({ where: { id: gameId } })) || game;
        if (changed(game)) break;
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      let ms = Math.min(left, WAIT_DB_CHECK_MS);
      if (isOnline(game) && game.status === 'ACTIVE') { // soat tugash vaqtini o'tkazib yubormaslik
        const c = clockOf(game, Date.now());
        const mine = engineOf(game).turnFromCount(game.moveCount) === 'w' ? c.whiteMs : c.blackMs;
        ms = Math.max(50, Math.min(ms, mine + 30));
      }
      await new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });
      clearTimeout(timer);
      wake = null;
      const fresh = await prisma.chessGame.findUnique({ where: { id: gameId } });
      if (!fresh) return fail('GAME_NOT_FOUND');
      game = fresh;
    }
  } finally {
    clearTimeout(timer);
    off();
  }

  if (changed(game)) return { success: true, changed: true, game: await toView(game, user.id) };
  const c = clockOf(game, Date.now());
  return { success: true, changed: false, moveCount: game.moveCount, turn: engineOf(game).turnFromCount(game.moveCount), whiteTimeMs: c.whiteMs, blackTimeMs: c.blackMs };
}

/**
 * G'alaba / mag'lubiyat / durang soni — SHU turdagi (gameType: 'CHESS' standart | 'CHECKERS') tugagan o'yinlardan hisoblanadi
 * (alohida hisoblagich maydonlari yo'q). Olmos balansi umumiy. Eski o'yinlar DB'da CHESS bo'lib qolgan.
 */
async function getStats(user, gameType = 'CHESS') {
  const uid = user.id;
  const finished = { status: 'FINISHED', gameType: normalizeGameType(gameType) };
  const [wins, losses, draws, balances] = await Promise.all([
    prisma.chessGame.count({
      where: { ...finished, OR: [{ whiteUserId: uid, result: 'WHITE' }, { blackUserId: uid, result: 'BLACK' }] },
    }),
    prisma.chessGame.count({
      where: { ...finished, OR: [{ whiteUserId: uid, result: 'BLACK' }, { blackUserId: uid, result: 'WHITE' }] },
    }),
    prisma.chessGame.count({
      where: { ...finished, result: 'DRAW', OR: [{ whiteUserId: uid }, { blackUserId: uid }] },
    }),
    getBalances(uid),
  ]);
  return { success: true, wins, losses, draws, diamonds: balances.diamonds };
}

/**
 * Maintenance: CHESS_BOT_IDLE_MINUTES dan ortiq harakatsiz bot o'yinlari foydalanuvchi YUTQAZGAN (ABANDON) sifatida tugatiladi (-1 💎).
 * Agar o'yin botning navbatida qotib qolgan bo'lsa (foydalanuvchi aybsiz) — yutqazdirilmaydi, botning yurishi beriladi.
 * Bir chaqiruvda ko'pi bilan 100 ta o'yin; qaytadi: tugatilganlar soni.
 */
async function finishIdleBotGames() {
  const cutoff = new Date(Date.now() - config.chess.botIdleMinutes * 60 * 1000);
  const rows = await prisma.chessGame.findMany({
    where: { mode: 'BOT', status: 'ACTIVE', lastMoveAt: { lt: cutoff } },
    orderBy: { lastMoveAt: 'asc' },
    take: 100,
  });

  let finished = 0;
  for (const row of rows) {
    try {
      if (isBotTurn(row)) {
        await botReply(row.id, row.moveCount);
        continue;
      }
      const done = await prisma.$transaction(async (tx) => {
        await lockPlayers(tx, row);
        await lockRow(tx, row.id);
        const game = await tx.chessGame.findUnique({ where: { id: row.id } });
        // bu orada foydalanuvchi yurgan / o'yin tugagan bo'lishi mumkin — qayta tekshiramiz
        if (!game || game.status !== 'ACTIVE' || game.lastMoveAt >= cutoff || isBotTurn(game)) return false;

        const updated = await tx.chessGame.update({
          where: { id: game.id },
          data: { status: 'FINISHED', result: botColorOf(game) === 'w' ? 'WHITE' : 'BLACK', endReason: 'ABANDON' },
        });
        await settleGame(tx, updated);
        return true;
      }, TX_OPTS);
      if (done) finished += 1;
    } catch (err) {
      logger.error({ err, gameId: row.id }, 'Harakatsiz bot o\'yinini tugatishda xato');
    }
  }
  return finished;
}

/**
 * Maintenance: vaqti tugagan faol onlayn o'yinlarni (hech kim so'ramasa ham) TIMEOUT bilan yakunlaydi. Bir chaqiruvda ko'pi bilan 100 ta; qaytadi: tugatilganlar soni.
 * Nomzodlar DB soatida tanlanadi, har biri qulf ostida qayta tekshiriladi (expireIfFlagged).
 */
async function finishTimedOutOnlineGames() {
  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "ChessGame"
    WHERE "mode" = 'ONLINE' AND "status" = 'ACTIVE'
      AND "lastMoveAt" + (CASE WHEN "moveCount" % 2 = 0 THEN "whiteTimeMs" ELSE "blackTimeMs" END) * interval '1 millisecond'
          < (NOW() AT TIME ZONE 'UTC')
    ORDER BY "lastMoveAt" ASC
    LIMIT 100`;
  let finished = 0;
  for (const r of rows) {
    if (await expireIfFlagged(r.id)) finished += 1;
  }
  return finished;
}

module.exports = { startBotGame, getCurrent, getGame, waitGame, makeMove, resign, getStats, finishIdleBotGames, finishTimedOutOnlineGames };