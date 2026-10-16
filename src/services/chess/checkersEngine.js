'use strict';

/**
 * Rus shashkasi qoidalari (sof mantiq: server, DB va Telegramga bog'liq emas). Shahmat dvigateli (chessEngine.js) kabi:
 * o'yin DB'da yurishlar ro'yxati sifatida saqlanadi (ChessGame.moves), holat har safar boshlang'ich pozitsiyadan qayta o'ynaladi —
 * shunda uch marta takrorlanish va "faqat damkalar yurgan" hisobi to'g'ri yuradi (faqat pozitsiya matnidan buni bilib bo'lmaydi).
 *
 * Taxta: 8x8, maydon nomlari shahmatdagidek a1..h8, faqat qora kataklar o'ynaladi (a1 qora). Oq pastdan (1-qator) yuqoriga yuradi.
 *
 * Pozitsiya matni (ChessGame.fen ustuniga yoziladi): FEN uslubida, 8-qatordan 1-qatorgacha "/" bilan.
 *   w oddiy oq, W oq damka, b oddiy qora, B qora damka, raqam = ketma-ket bo'sh kataklar; oxirida bo'sh joy va navbat (w | b).
 *
 * Yurishlar ro'yxati (ChessGame.moves): har element satr. Oddiy yurish "c3-d4", urish "c3:e5:g7" (boshlang'ich katak, keyin qo'nish kataklari).
 *
 * Qoidalar:
 *  - Oddiy dona oldinga 1 katak yuradi, urishni oldinga ham, orqaga ham qiladi. Urish MAJBURIY, ko'p dona urish majburiy emas,
 *    lekin boshlangan urish zanjiri oxirigacha davom etishi shart.
 *  - Oddiy dona urish davomida oxirgi qatorga yetsa darrov damka bo'lib, shu yurishni damka sifatida davom ettiradi.
 *  - Damka (uchuvchi): diagonal bo'ylab istalgan masofaga yuradi; urishda yo'ldagi yagona raqib donasidan sakrab, undan keyingi
 *    istalgan bo'sh katakka qo'nadi. Bir nechta qo'nish katagi bo'lsa va ulardan ayrimida urish davom etsa — faqat davom etadiganlari qonuniy.
 *  - Urilgan donalar yurish tugagach olinadi: yurish davomida taxtada qoladi, yo'lni to'sadi va ikki marta urilmaydi.
 *  - Yutuq: navbatdagi tomonda dona qolmasa yoki yura olmasa (NO_MOVES).
 *  - Durang (DRAW_RULE): bir xil pozitsiya (shu navbat bilan) 3 marta takrorlansa; yoki ketma-ket 30 yarim yurish davomida faqat damkalar
 *    yurib, urish ham, oddiy dona yurishi ham bo'lmasa. Maxsus tugatish qoidalari (3 damka 1 ga qarshi) yo'q. Durang taklifi yo'q.
 *
 * Bot (checkersBot.js) tezlik uchun pastdagi INDEKS asosidagi yordamchilardan foydalanishi mumkin: parsePosition, serializePosition,
 * listMoves, makeMove, nameOf, indexOf (indeks = gorizontal * 8 + vertikal, a1 = 0, h8 = 63).
 */

const FILES = 'abcdefgh';
const SQUARE_RE = /^[a-h][1-8]$/;
const MAX_PATH = 20; // klient yuboradigan yo'lning eng uzun uzunligi (zanjir bundan uzun bo'lmaydi: 12 dona + boshlang'ich katak)
const REPEAT_LIMIT = 3; // bir xil pozitsiya (navbat bilan) shuncha marta takrorlansa — durang
const KING_QUIET_LIMIT = 30; // ketma-ket shuncha yarim yurish faqat damkalar, urishsiz — durang
const DIRS = Object.freeze([
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]); // [vertikal (fayl), gorizontal (qator)] bo'yicha qadam

// ---------------------------------------------------------------------------------------------------------------------
// Maydon va dona yordamchilari
// ---------------------------------------------------------------------------------------------------------------------

/** 0..63 indeks -> "a1".."h8". */
function nameOf(i) {
  return FILES[i & 7] + ((i >> 3) + 1);
}

/** "a1".."h8" -> 0..63 indeks (format tekshirilgan bo'lishi kerak). */
function indexOf(name) {
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}

function inside(f, r) {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

/** 'w' | 'b' | null (bo'sh katak). */
function colorOf(p) {
  if (p === 'w' || p === 'W') return 'w';
  if (p === 'b' || p === 'B') return 'b';
  return null;
}

function isKing(p) {
  return p === 'W' || p === 'B';
}

/** Oq uchun 8-qator, qora uchun 1-qator — oddiy dona shu yerga yetsa damka bo'ladi. */
function isPromoRow(color, i) {
  return i >> 3 === (color === 'w' ? 7 : 0);
}

function turnFromCount(moveCount) {
  return moveCount % 2 === 0 ? 'w' : 'b';
}

// ---------------------------------------------------------------------------------------------------------------------
// Pozitsiya matni
// ---------------------------------------------------------------------------------------------------------------------

function startBoard() {
  const board = new Array(64).fill('');
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      if ((f + r) % 2 !== 0) continue; // faqat qora kataklar
      if (r <= 2) board[r * 8 + f] = 'w';
      else if (r >= 5) board[r * 8 + f] = 'b';
    }
  }
  return board;
}

/** Taxta (64 ta belgi, '' = bo'sh) va navbatni matnga aylantiradi. */
function serializePosition(board, turn) {
  const rows = [];
  for (let r = 7; r >= 0; r -= 1) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f += 1) {
      const p = board[r * 8 + f];
      if (!p) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += p;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn}`;
}

/** Pozitsiya matnidan { board, turn }. Buzilgan matnda xato tashlaydi (DB'dagi ma'lumot noto'g'ri bo'lsa). */
function parsePosition(text) {
  const parts = String(text).trim().split(/\s+/);
  const rows = (parts[0] || '').split('/');
  const turn = parts[1];
  if (rows.length !== 8 || (turn !== 'w' && turn !== 'b')) throw new Error(`Shashka: pozitsiya matni noto'g'ri: ${text}`);
  const board = new Array(64).fill('');
  for (let row = 0; row < 8; row += 1) {
    const rank = 7 - row;
    let file = 0;
    for (const ch of rows[row]) {
      if (ch >= '1' && ch <= '8') file += Number(ch);
      else if ((ch === 'w' || ch === 'W' || ch === 'b' || ch === 'B') && file < 8) {
        board[rank * 8 + file] = ch;
        file += 1;
      } else throw new Error(`Shashka: pozitsiya matni noto'g'ri: ${text}`);
    }
    if (file !== 8) throw new Error(`Shashka: pozitsiya matni noto'g'ri: ${text}`);
  }
  return { board, turn };
}

const START_POSITION = serializePosition(startBoard(), 'w');

// ---------------------------------------------------------------------------------------------------------------------
// Yurishlarni hosil qilish (indekslar bilan). Yurish: { from, path: [from, ...qo'nish kataklari], captured: [urilgan kataklar] }
// ---------------------------------------------------------------------------------------------------------------------

/**
 * pos katagidagi dona uchun mumkin bo'lgan bitta sakrashlar: [{ over, lands: [...] }].
 * captured — shu yurishda allaqachon urilgan (taxtada turgan) donalar: ular yo'lni to'sadi va qayta urilmaydi.
 */
function jumpsFrom(board, pos, king, color, captured) {
  const out = [];
  const f0 = pos & 7;
  const r0 = pos >> 3;
  for (const [df, dr] of DIRS) {
    let f = f0 + df;
    let r = r0 + dr;
    if (king) {
      while (inside(f, r) && !board[r * 8 + f]) {
        f += df;
        r += dr;
      }
    }
    if (!inside(f, r)) continue;
    const over = r * 8 + f;
    const p = board[over];
    if (!p || colorOf(p) === color || captured.has(over)) continue;
    const lands = [];
    let lf = f + df;
    let lr = r + dr;
    while (inside(lf, lr) && !board[lr * 8 + lf]) {
      lands.push(lr * 8 + lf);
      if (!king) break; // oddiy dona faqat darhol orqasiga qo'nadi
      lf += df;
      lr += dr;
    }
    if (lands.length) out.push({ over, lands });
  }
  return out;
}

/** from katagidagi dona boshlaydigan barcha TO'LIQ urish zanjirlari (zanjir oxirigacha davom etadi). */
function capturesFor(board, from, color) {
  const piece = board[from];
  const results = [];
  const captured = new Set();
  const path = [from];
  const caps = [];

  board[from] = ''; // yurayotgan dona o'z joyini bo'shatadi (damka boshlang'ich katagidan qaytib o'tishi mumkin)
  const walk = (pos, king) => {
    const jumps = jumpsFrom(board, pos, king, color, captured);
    if (!jumps.length) {
      if (caps.length) results.push({ from, path: path.slice(), captured: caps.slice() });
      return;
    }
    for (const j of jumps) {
      captured.add(j.over);
      caps.push(j.over);
      // Oddiy dona oxirgi qatorga yetsa shu zahoti damka bo'ladi va zanjirni damka sifatida davom ettiradi
      const options = j.lands.map((land) => {
        const k = king || isPromoRow(color, land);
        return { land, k, cont: jumpsFrom(board, land, k, color, captured).length > 0 };
      });
      const anyCont = options.some((o) => o.cont);
      for (const o of options) {
        if (anyCont && !o.cont) continue; // urishni davom ettirish mumkin bo'lsa, shunday qo'nish majburiy
        path.push(o.land);
        walk(o.land, o.k);
        path.pop();
      }
      captured.delete(j.over);
      caps.pop();
    }
  };
  walk(from, isKing(piece));
  board[from] = piece;
  return results;
}

/** Urishsiz oddiy yurishlar (urish majburiy bo'lsa ham hisoblanadi — MUST_CAPTURE ni aniqlash uchun). */
function simpleMoves(board, turn) {
  const out = [];
  const forward = turn === 'w' ? 1 : -1;
  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (colorOf(piece) !== turn) continue;
    const king = isKing(piece);
    for (const [df, dr] of DIRS) {
      if (!king && dr !== forward) continue;
      let f = (from & 7) + df;
      let r = (from >> 3) + dr;
      while (inside(f, r) && !board[r * 8 + f]) {
        out.push({ from, path: [from, r * 8 + f], captured: [] });
        if (!king) break;
        f += df;
        r += dr;
      }
    }
  }
  return out;
}

/** Navbatdagi tomonning qonuniy yurishlari: urish bo'lsa faqat urishlar (mustCapture), aks holda oddiy yurishlar. */
function listMoves(board, turn) {
  const caps = [];
  for (let i = 0; i < 64; i += 1) {
    if (colorOf(board[i]) === turn) caps.push(...capturesFor(board, i, turn));
  }
  if (caps.length) return { mustCapture: true, moves: caps };
  return { mustCapture: false, moves: simpleMoves(board, turn) };
}

/** Yurishni taxtaga qo'llaydi va YANGI taxta qaytaradi (eskisi o'zgarmaydi). Urilgan donalar olinadi, kerak bo'lsa damka bo'ladi. */
function makeMove(board, move) {
  const next = board.slice();
  let piece = next[move.from];
  next[move.from] = '';
  for (const c of move.captured) next[c] = '';
  if (!isKing(piece)) {
    const color = colorOf(piece);
    for (let i = 1; i < move.path.length; i += 1) {
      if (isPromoRow(color, move.path[i])) {
        piece = color === 'w' ? 'W' : 'B';
        break;
      }
    }
  }
  next[move.path[move.path.length - 1]] = piece;
  return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Yurishlar ro'yxatidan holatni tiklash va tugashni aniqlash
// ---------------------------------------------------------------------------------------------------------------------

/** "c3-d4" | "c3:e5:g7" -> indekslar yo'li. Buzilgan yozuvda xato tashlaydi. */
function parseMoveString(str) {
  const names = String(str).split(/[-:]/);
  if (names.length < 2 || names.some((n) => !SQUARE_RE.test(n))) throw new Error(`Shashka: yurish yozuvi noto'g'ri: ${str}`);
  return names.map(indexOf);
}

function samePath(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function notationOf(move) {
  return move.path.map(nameOf).join(move.captured.length ? ':' : '-');
}

/** Bitta yurishdan keyin kontekstni yangilaydi (taxta, navbat, takrorlanish hisobi, "faqat damka" hisobi). */
function advance(ctx, move) {
  const wasKing = isKing(ctx.board[move.from]);
  ctx.board = makeMove(ctx.board, move);
  ctx.quiet = wasKing && !move.captured.length ? ctx.quiet + 1 : 0; // urish yoki oddiy dona yurishi hisobni nolga tushiradi
  ctx.turn = ctx.turn === 'w' ? 'b' : 'w';
  const key = serializePosition(ctx.board, ctx.turn);
  ctx.seen.set(key, (ctx.seen.get(key) || 0) + 1);
}

function newContext() {
  const board = startBoard();
  const ctx = { board, turn: 'w', seen: new Map(), quiet: 0 };
  ctx.seen.set(serializePosition(board, 'w'), 1);
  return ctx;
}

/** Yurishlar ro'yxatini boshidan o'ynab kontekstni tiklaydi. Qonunsiz yozuv topilsa xato tashlaydi. */
function replay(moves) {
  const ctx = newContext();
  for (const str of moves) {
    const path = parseMoveString(str);
    const move = listMoves(ctx.board, ctx.turn).moves.find((m) => samePath(m.path, path));
    if (!move) throw new Error(`Shashka: yurishlar ro'yxatida qonunsiz yurish: ${str}`);
    advance(ctx, move);
  }
  return ctx;
}

/** O'yin tugaganmi: raqib yura olmasa (NO_MOVES) yutadi; takrorlanish yoki 30 yarim yurish faqat damka — durang. */
function detectEnd(ctx, gen) {
  if (!gen.moves.length) return { over: true, result: ctx.turn === 'w' ? 'BLACK' : 'WHITE', endReason: 'NO_MOVES' };
  if ((ctx.seen.get(serializePosition(ctx.board, ctx.turn)) || 0) >= REPEAT_LIMIT) return { over: true, result: 'DRAW', endReason: 'DRAW_RULE' };
  if (ctx.quiet >= KING_QUIET_LIMIT) return { over: true, result: 'DRAW', endReason: 'DRAW_RULE' };
  return { over: false, result: null, endReason: null };
}

function stateOf(ctx) {
  const gen = listMoves(ctx.board, ctx.turn);
  const end = detectEnd(ctx, gen);
  return {
    position: serializePosition(ctx.board, ctx.turn),
    turn: ctx.turn,
    // To'liq yo'llar ro'yxati, masalan [["c3","d4"],["c3","e5","g7"]]; o'yin tugagan bo'lsa bo'sh
    legalMoves: end.over ? [] : gen.moves.map((m) => m.path.map(nameOf)),
    mustCapture: !end.over && gen.mustCapture,
    ...end,
  };
}

/** Yurishlar ro'yxati bo'yicha to'liq holat. */
function getState(moves) {
  return stateOf(replay(moves));
}

/**
 * Yurishni tekshiradi va bajaradi. Klient faqat { path: ["c3","e5",...] } yuboradi.
 * Qaytadi: { ok:true, notation, move, moves, state } yoki { ok:false, reason: 'BAD_MOVE' | 'ILLEGAL_MOVE' | 'MUST_CAPTURE' }.
 */
function applyMove(moves, input) {
  const path = input && input.path;
  if (!Array.isArray(path) || path.length < 2 || path.length > MAX_PATH) return { ok: false, reason: 'BAD_MOVE' };
  if (path.some((s) => typeof s !== 'string' || !SQUARE_RE.test(s))) return { ok: false, reason: 'BAD_MOVE' };

  const ctx = replay(moves);
  const want = path.map(indexOf);
  const gen = listMoves(ctx.board, ctx.turn);
  const move = gen.moves.find((m) => samePath(m.path, want));
  if (!move) {
    // Urish majburiy paytda oddiy yurish — alohida sabab; qolgani (noto'g'ri yo'l, to'liq bo'lmagan zanjir) — ILLEGAL_MOVE
    if (gen.mustCapture && simpleMoves(ctx.board, ctx.turn).some((m) => samePath(m.path, want))) return { ok: false, reason: 'MUST_CAPTURE' };
    return { ok: false, reason: 'ILLEGAL_MOVE' };
  }

  const notation = notationOf(move);
  advance(ctx, move);
  return {
    ok: true,
    notation,
    move: { path: path.slice(), captured: move.captured.map(nameOf) },
    moves: [...moves, notation],
    state: stateOf(ctx),
  };
}

/** Tasodifiy qonuniy yurish (bot vaqt chegarasidan oshganda zaxira): { path } — to'g'ridan-to'g'ri applyMove'ga beriladi. Yurish yo'q bo'lsa null. */
function randomMove(position) {
  const { board, turn } = parsePosition(position);
  const { moves } = listMoves(board, turn);
  if (!moves.length) return null;
  const m = moves[Math.floor(Math.random() * moves.length)];
  return { path: m.path.map(nameOf) };
}

/** Oxirgi yurish { path } yoki null (toView uchun). Qayta o'ynamaydi — faqat oxirgi yozuvni o'qiydi. */
function lastMove(moves) {
  if (!moves.length) return null;
  return { path: parseMoveString(moves[moves.length - 1]).map(nameOf) };
}

module.exports = {
  START_POSITION,
  turnFromCount,
  getState,
  applyMove,
  randomMove,
  lastMove,
  // bot uchun (indeks asosida)
  parsePosition,
  serializePosition,
  listMoves,
  makeMove,
  nameOf,
  indexOf,
  colorOf,
  isKing,
};