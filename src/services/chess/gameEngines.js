'use strict';

const chess = require('./chessEngine');
const checkers = require('./checkersEngine');

/**
 * O'yin dvigatellari registri. Servislar dvigatelni to'g'ridan-to'g'ri emas, getEngine(game.gameType) orqali oladi.
 *
 * Umumiy interfeys:
 *   { gameType, START_POSITION, turnFromCount(moveCount), getState(moves), applyMove(moves, input), randomMove(position) }
 *
 * getState / applyMove holati: { position, turn: 'w'|'b', over, result: 'WHITE'|'BLACK'|'DRAW'|null, endReason, legalMoves, ... }
 * applyMove: muvaffaqiyatda { ok:true, notation, move, moves, state }, xatoda { ok:false, reason }.
 *
 * Shahmat dvigateli (chessEngine.js) O'ZGARTIRILMAGAN — bu yerda faqat adapter (position = fen, notation = san).
 * Shashka dvigateli (checkersEngine.js) shu interfeysni o'zi beradi: position = pozitsiya matni, notation = "c3-d4" | "c3:e5", yurish kirishi { path }.
 * Eski o'yinlarda gameType yo'q (null/undefined) bo'lishi mumkin — ular har doim shahmat hisoblanadi.
 */

/** Shahmat holatini umumiy ko'rinishga o'tkazadi: position = fen (fen maydoni ham qoladi — eski kod uchun). */
function chessState(s) {
  return { ...s, position: s.fen };
}

const CHESS_ADAPTER = Object.freeze({
  gameType: 'CHESS',
  START_POSITION: chess.START_FEN,

  turnFromCount: chess.turnFromCount,

  getState(moves) {
    return chessState(chess.getState(moves));
  },

  applyMove(moves, input) {
    const r = chess.applyMove(moves, input);
    if (!r.ok) return r;
    return { ok: true, notation: r.san, san: r.san, move: r.move, moves: r.moves, state: chessState(r.state) };
  },

  randomMove(position) {
    return chess.randomMoveFromFen(position);
  },

  // --- qo'shimcha (ixtiyoriy) yordamchilar: servislar shahmat obyektiga bevosita tegmasligi uchun ---

  /** Oxirgi yurish { from, to } yoki null (toView uchun). */
  lastMove(moves) {
    const history = chess.fromMoves(moves).history({ verbose: true });
    const last = history.length ? history[history.length - 1] : null;
    return last ? { from: last.from, to: last.to } : null;
  },

  /** Qolgan material mat qilishga yetmaydimi (vaqt tugaganda durang). */
  isInsufficientMaterial(moves) {
    return chess.fromMoves(moves).isInsufficientMaterial();
  },
});

const CHECKERS_ENGINE = Object.freeze({
  gameType: 'CHECKERS',
  START_POSITION: checkers.START_POSITION,
  turnFromCount: checkers.turnFromCount,
  getState: checkers.getState,
  applyMove: checkers.applyMove,
  randomMove: checkers.randomMove,
  lastMove: checkers.lastMove, // { path } | null (shahmatdagi { from, to } o'rnida)
  // isInsufficientMaterial yo'q: shashkada vaqti tugagan tomon doim yutqazadi (servis funksiya borligini tekshiradi)
});

const ENGINES = {
  CHESS: CHESS_ADAPTER,
  CHECKERS: CHECKERS_ENGINE,
};

/** 'CHESS' | 'chess' | null/undefined (eski o'yin) -> 'CHESS'; boshqa qiymat o'zgarishsiz (katta harfda). */
function normalizeGameType(gameType) {
  if (gameType == null || gameType === '') return 'CHESS';
  return String(gameType).toUpperCase();
}

/** O'yin turiga mos dvigatelni qaytaradi. Noma'lum tur uchun aniq xato tashlaydi. */
function getEngine(gameType) {
  const type = normalizeGameType(gameType);
  const engine = ENGINES[type];
  if (!engine) throw new Error(`Noma'lum o'yin turi: ${type}`);
  return engine;
}

module.exports = { getEngine, normalizeGameType };