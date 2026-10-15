'use strict';

const { Chess } = require('chess.js');

/**
 * Shahmat qoidalari qobig'i (chess.js ustida). Server — yagona haqiqat manbai: yurish qonuniyligi, mat/pat/durang shu yerda aniqlanadi.
 * O'yin holati DB'da SAN yurishlar ro'yxati sifatida saqlanadi (ChessGame.moves); har safar boshlang'ich pozitsiyadan qayta o'ynaladi —
 * shunda uch marta takrorlanish va 50 yurish qoidasi chess.js ichida to'g'ri hisoblanadi (faqat FEN'dan buni aniqlab bo'lmaydi).
 */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SQUARE_RE = /^[a-h][1-8]$/;
const PROMOTIONS = Object.freeze(['q', 'r', 'b', 'n']);

/** SAN yurishlar ro'yxatidan o'yinni tiklaydi. Buzilgan ro'yxatda xato tashlaydi (DB'dagi ma'lumot noto'g'ri bo'lsa). */
function fromMoves(moves) {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  return chess;
}

/** Navbat kimda: yarim yurishlar soni juft bo'lsa oq. */
function turnFromCount(moveCount) {
  return moveCount % 2 === 0 ? 'w' : 'b';
}

/** { "e2": ["e3","e4"], ... } — faqat navbatdagi tomonning qonuniy yurishlari (promotion maydonlari bir marta). */
function legalMovesMap(chess) {
  const map = {};
  for (const m of chess.moves({ verbose: true })) {
    const list = map[m.from] || (map[m.from] = []);
    if (!list.includes(m.to)) list.push(m.to);
  }
  return map;
}

/** O'yin tugaganmi: mat, pat, uch marta takrorlanish, 50 yurish, material yetishmasligi. */
function detectEnd(chess) {
  if (chess.isCheckmate()) {
    // navbati kelgan tomon mat bo'lgan -> boshqa tomon yutdi
    return { over: true, result: chess.turn() === 'w' ? 'BLACK' : 'WHITE', endReason: 'CHECKMATE' };
  }
  if (chess.isStalemate()) return { over: true, result: 'DRAW', endReason: 'STALEMATE' };
  if (chess.isDraw()) return { over: true, result: 'DRAW', endReason: 'DRAW_RULE' };
  return { over: false, result: null, endReason: null };
}

/** Yurishlar ro'yxati bo'yicha to'liq holat. */
function getState(moves) {
  const chess = fromMoves(moves);
  const end = detectEnd(chess);
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    inCheck: chess.inCheck(),
    legalMoves: end.over ? {} : legalMovesMap(chess),
    ...end,
  };
}

/**
 * Yurishni tekshiradi va bajaradi. Klient faqat from/to/promotion yuboradi.
 * Qaytadi: { ok:true, san, move, moves, state } yoki { ok:false, reason: 'BAD_MOVE' | 'ILLEGAL_MOVE' | 'PROMOTION_REQUIRED' | 'BAD_PROMOTION' }.
 */
function applyMove(moves, { from, to, promotion } = {}) {
  if (!SQUARE_RE.test(from || '') || !SQUARE_RE.test(to || '')) return { ok: false, reason: 'BAD_MOVE' };
  if (promotion != null && !PROMOTIONS.includes(promotion)) return { ok: false, reason: 'BAD_PROMOTION' };

  const chess = fromMoves(moves);
  const candidates = chess.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!candidates.length) return { ok: false, reason: 'ILLEGAL_MOVE' };

  const promoting = candidates.some((m) => m.promotion);
  if (promoting && !promotion) return { ok: false, reason: 'PROMOTION_REQUIRED' };
  if (!promoting && promotion) return { ok: false, reason: 'BAD_PROMOTION' };

  const played = chess.move({ from, to, promotion: promoting ? promotion : undefined });
  const end = detectEnd(chess);
  return {
    ok: true,
    san: played.san,
    move: promoting ? { from, to, promotion } : { from, to },
    moves: [...moves, played.san],
    state: {
      fen: chess.fen(),
      turn: chess.turn(),
      inCheck: chess.inCheck(),
      legalMoves: end.over ? {} : legalMovesMap(chess),
      ...end,
    },
  };
}

/** Tasodifiy qonuniy yurish (bot vaqt chegarasidan oshganda zaxira). Yurish yo'q bo'lsa null. */
function randomMoveFromFen(fen) {
  const list = new Chess(fen).moves({ verbose: true });
  if (!list.length) return null;
  const m = list[Math.floor(Math.random() * list.length)];
  return m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to };
}

module.exports = { START_FEN, PROMOTIONS, fromMoves, turnFromCount, legalMovesMap, detectEnd, getState, applyMove, randomMoveFromFen };