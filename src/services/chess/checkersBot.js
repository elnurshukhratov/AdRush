'use strict';

const { parsePosition, listMoves, makeMove, nameOf } = require('./checkersEngine');

/**
 * Server tomonidagi shashka boti (tashqi dvigatelsiz): alpha-beta (negamax) + baholash (material + oldinga siljish + markaz + orqa qator).
 * Sof mantiq: faqat checkersEngine.js (indeks asosidagi yordamchilar) ga tayanadi — config / prisma / logger bu yerda ulanmaydi,
 * shuning uchun fayl worker ichida (chessBotWorker.js orqali) ham xavfsiz yuklanadi. Worker pool va zaxira yurish mexanizmi chessBot.js da.
 *
 * Majburiy urish va zanjirlar dvigatelning listMoves() ida to'liq hisoblangan (har yurish — TO'LIQ zanjir), shuning uchun bot
 * faqat qonuniy yurishlarni ko'radi. Qidiruv oxirida urish majburiy bo'lgan pozitsiyalar yana bir necha yarim yurishga uzaytiriladi
 * ("tinch" bo'lmagan pozitsiyani baholab, almashuvni noto'g'ri ko'rmaslik uchun).
 */

// Darajalar: 1 Oson (sayoz chuqurlik + ba'zan tasodifiy yurish), 2 O'rta, 3 Qiyin (chuqur, lekin timeMs bilan chegaralangan).
// depth — iterativ chuqurlashtirishning eng katta chuqurligi; timeMs — qidiruvning qattiq vaqt chegarasi (chessBot.js worker pool ham shuni ishlatadi).
const LEVELS = Object.freeze({
  1: { depth: 1, randomP: 0.25, timeMs: 600 },
  2: { depth: 5, randomP: 0, timeMs: 1200 },
  3: { depth: 10, randomP: 0, timeMs: 2500 },
});

const WIN = 100000;
const MAX_EXT = 6; // urish majburiy pozitsiyalarni eng ko'pi bilan shuncha yarim yurishga uzaytirish

// Baholash og'irliklari (oddiy dona = 100)
const MAN = 100;
const KING = 300; // damka oddiy donadan ancha qimmat
const ADVANCE = 5; // oddiy donaning har bir oldinga siljigan qatori uchun
const NEAR_PROMO = 12; // damka bo'lishiga bir qadam qolgan oddiy dona
const BACK_ROW = 5; // o'z tomonidagi oxirgi qatorni saqlab turgan oddiy dona (raqib damka bo'lmasligi uchun)
const CENTER = 4; // markaz (c-f vertikal, 3-6 gorizontal) dagi oddiy dona
const MAIN_ROAD = 10; // a1-h8 bosh diagonaldagi damka (eng ko'p erkinlik)

/** Statik baho — OQ nuqtai nazaridan (musbat = oq yaxshi). board: 64 ta belgi ('' | w | W | b | B). */
function evaluate(board) {
  let score = 0;
  for (let i = 0; i < 64; i += 1) {
    const p = board[i];
    if (!p) continue;
    const f = i & 7;
    const r = i >> 3;
    const white = p === 'w' || p === 'W';
    let v;
    if (p === 'w' || p === 'b') {
      const adv = white ? r : 7 - r; // o'z tomonidan necha qator oldinga siljigan
      v = MAN + ADVANCE * adv;
      if (adv === 0) v += BACK_ROW;
      else if (adv === 6) v += NEAR_PROMO;
      if (f >= 2 && f <= 5 && r >= 2 && r <= 5) v += CENTER;
    } else {
      v = KING;
      if (f === r) v += MAIN_ROAD;
    }
    score += white ? v : -v;
  }
  return score;
}

/** Ko'proq dona urgan yurish oldin (alpha-beta kesish uchun foydali). Sort barqaror, shuning uchun teng yurishlar tartibi saqlanadi. */
function byCaptures(a, b) {
  return b.captured.length - a.captured.length;
}

function negamax(board, turn, depth, alpha, beta, ply, ctx) {
  if (ctx.aborted) return 0;
  ctx.nodes += 1;
  if ((ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) {
    ctx.aborted = true;
    return 0;
  }

  const gen = listMoves(board, turn);
  if (!gen.moves.length) return -(WIN - ply); // yura olmaydigan tomon yutqazadi (NO_MOVES)
  // Chuqurlik tugadi: tinch pozitsiyani baholaymiz; urish majburiy bo'lsa almashuv tugaguncha (MAX_EXT gacha) davom etamiz
  if (depth <= 0 && (!gen.mustCapture || depth <= -MAX_EXT)) return (turn === 'w' ? 1 : -1) * evaluate(board);

  const moves = gen.moves;
  if (moves.length > 1) moves.sort(byCaptures);
  const next = turn === 'w' ? 'b' : 'w';
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(makeMove(board, m), next, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (ctx.aborted) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toInput(m) {
  return { path: m.path.map(nameOf) }; // applyMove'ga to'g'ridan-to'g'ri beriladi
}

/**
 * Berilgan pozitsiya matni uchun eng yaxshi yurish: { path: ["c3","e5",...] } yoki yurish bo'lmasa null.
 * Sinxron (worker ichida chaqiriladi). Vaqt chegarasiga yetsa — oxirgi TUGALLANGAN chuqurlikdagi eng yaxshi yurish qaytadi.
 */
function searchBestMove(position, level) {
  const cfg = LEVELS[level] || LEVELS[2];
  const { board, turn } = parsePosition(position);
  const root = listMoves(board, turn).moves;
  if (!root.length) return null;
  if (root.length === 1) return toInput(root[0]); // yagona (masalan majburiy urish) yurish — qidirib o'tirmaymiz

  // Oson daraja: ba'zan butunlay tasodifiy qonuniy yurish
  if (cfg.randomP > 0 && Math.random() < cfg.randomP) return toInput(root[Math.floor(Math.random() * root.length)]);

  // Teng baholi yurishlar orasida tasodifiy tanlash uchun aralashtiramiz, so'ng urishlarni oldinga chiqaramiz (sort barqaror)
  shuffle(root);
  root.sort(byCaptures);

  const next = turn === 'w' ? 'b' : 'w';
  const ctx = { nodes: 0, aborted: false, deadline: Date.now() + cfg.timeMs };
  let best = root[0];

  for (let depth = 1; depth <= cfg.depth; depth += 1) {
    let alpha = -Infinity;
    let iterBest = null;
    let iterScore = -Infinity;
    for (const m of root) {
      const v = -negamax(makeMove(board, m), next, depth - 1, -Infinity, -alpha, 1, ctx);
      if (ctx.aborted) break;
      m.score = v;
      if (v > iterScore) {
        iterScore = v;
        iterBest = m;
      }
      if (v > alpha) alpha = v;
    }
    if (ctx.aborted || !iterBest) break; // tugallanmagan chuqurlik natijasi ishlatilmaydi
    best = iterBest;
    if (iterScore >= WIN - 100) break; // yutuq topildi
    root.sort((a, b) => b.score - a.score); // keyingi chuqurlikda eng yaxshi yurish birinchi
  }
  return toInput(best);
}

module.exports = { LEVELS, evaluate, searchBestMove };