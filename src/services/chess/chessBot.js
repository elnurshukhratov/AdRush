'use strict';

const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { Chess } = require('chess.js');
const checkersBot = require('./checkersBot');

/**
 * Server tomonidagi shahmat boti (tashqi dvigatelsiz): alpha-beta (negamax) + baholash (material + figura-maydon jadvallari).
 * Qidiruv worker_threads'da (chooseMove) — event loop bloklanmaydi. Har yurish uchun qattiq vaqt chegarasi bor:
 * qidiruv o'zi iterativ chuqurlashtirish bilan vaqtni kuzatadi, worker javob bermasa pool uni to'xtatib, tasodifiy qonuniy yurish beradi.
 * Bu fayl worker ichida ham yuklanadi — shuning uchun config / prisma / logger bu yerda yuqorida ulanmaydi.
 * Shashka boti (checkersBot.js) ham shu pool va shu vaqt chegarasi/zaxira yurish mexanizmi orqali ishlaydi: chooseMove(position, level, gameType).
 */

// Darajalar: 1 Oson (chuqurlik 1 + ma'lum ehtimol bilan tasodifiy yurish), 2 O'rta (chuqurlik 2), 3 Qiyin (chuqurlik 3, tartiblash, vaqt chegarasi)
const LEVELS = Object.freeze({
  1: { depth: 1, randomP: 0.3, timeMs: 800 },
  2: { depth: 2, randomP: 0, timeMs: 1800 },
  3: { depth: 3, randomP: 0, timeMs: 3000 },
});

/** 'CHECKERS' | 'checkers' -> true; boshqa hamma narsa (CHESS, null, eski o'yin) -> shahmat. */
function isCheckers(gameType) {
  return String(gameType || '').toUpperCase() === 'CHECKERS';
}

/** O'yin turiga mos daraja jadvali (timeMs pool'dagi qattiq chegara uchun kerak). */
function levelsFor(gameType) {
  return isCheckers(gameType) ? checkersBot.LEVELS : LEVELS;
}

const MATE = 100000;
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Figura-maydon jadvallari (oq nuqtai nazaridan, 0-indeks = a8, oxirgi = h1). Qora uchun vertikal aks ettiriladi.
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  kMid: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

/** Statik baho — OQ nuqtai nazaridan (musbat = oq yaxshi). */
function evaluate(chess) {
  const board = chess.board(); // board[0] = 8-gorizontal
  const side = { w: { q: 0, r: 0, minor: 0 }, b: { q: 0, r: 0, minor: 0 } };
  const list = [];
  let wk = null;
  let bk = null;
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c];
      if (!p) continue;
      list.push(p.type, p.color, r, c);
      if (p.type === 'q') side[p.color].q += 1;
      else if (p.type === 'r') side[p.color].r += 1;
      else if (p.type === 'n' || p.type === 'b') side[p.color].minor += 1;
      else if (p.type === 'k') {
        if (p.color === 'w') wk = [r, c];
        else bk = [r, c];
      }
    }
  }
  const quiet = (s) => s.q === 0 || (s.r === 0 && s.minor <= 1);
  const endgame = quiet(side.w) && quiet(side.b);

  let score = 0;
  for (let i = 0; i < list.length; i += 4) {
    const type = list[i];
    const color = list[i + 1];
    const r = list[i + 2];
    const c = list[i + 3];
    const table = type === 'k' ? (endgame ? PST.kEnd : PST.kMid) : PST[type];
    const idx = color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
    const v = VAL[type] + table[idx];
    score += color === 'w' ? v : -v;
  }

  // Oxirgi o'yin: ustun tomon raqib shohini chetga siqib, o'z shohini yaqinlashtirsin (mat qo'yish uchun)
  if (endgame && wk && bk && (score > 300 || score < -300)) {
    const strong = score > 0 ? wk : bk;
    const weak = score > 0 ? bk : wk;
    const centerDist = Math.min(Math.abs(weak[0] - 3), Math.abs(weak[0] - 4)) + Math.min(Math.abs(weak[1] - 3), Math.abs(weak[1] - 4));
    const kingDist = Math.abs(strong[0] - weak[0]) + Math.abs(strong[1] - weak[1]);
    const bonus = 10 * centerDist + 4 * (14 - kingDist);
    score += score > 0 ? bonus : -bonus;
  }
  return score;
}

/** SAN bo'yicha yurishni tartiblash bahosi: mat > almashtirish/olish (MVV-LVA) > shah. */
function sanScore(chess, san) {
  let s = 0;
  if (san.endsWith('#')) return 1000000;
  const eq = san.indexOf('=');
  if (eq !== -1) s += 9000 + VAL[san[eq + 1].toLowerCase()];
  if (san.indexOf('x') !== -1) {
    const core = san.replace(/[+#]/g, '').replace(/=.$/, '');
    const victim = chess.get(core.slice(-2));
    const attacker = /^[NBRQK]/.test(san) ? san[0].toLowerCase() : 'p';
    s += 10000 + 10 * VAL[victim ? victim.type : 'p'] - VAL[attacker];
  }
  if (san.endsWith('+')) s += 50;
  return s;
}

function orderedMoves(chess) {
  const sans = chess.moves();
  const scored = sans.map((san) => [sanScore(chess, san), san]);
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map((x) => x[1]);
}

function negamax(chess, depth, alpha, beta, ply, ctx) {
  if (ctx.aborted) return 0;
  ctx.nodes += 1;
  if ((ctx.nodes & 127) === 0 && Date.now() > ctx.deadline) {
    ctx.aborted = true;
    return 0;
  }
  if (depth === 0) return (chess.turn() === 'w' ? 1 : -1) * evaluate(chess);

  const moves = orderedMoves(chess);
  if (moves.length === 0) return chess.inCheck() ? -(MATE - ply) : 0; // mat yoki pat
  if (moves[0].endsWith('#')) return MATE - ply - 1; // mat qo'yadigan yurish bor

  let best = -Infinity;
  for (const san of moves) {
    chess.move(san);
    const v = -negamax(chess, depth - 1, -beta, -alpha, ply + 1, ctx);
    chess.undo();
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

function toMove(m) {
  return m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to };
}

/**
 * Berilgan FEN uchun eng yaxshi yurish: { from, to, promotion? } yoki yurish bo'lmasa null.
 * Sinxron (worker ichida chaqiriladi). Vaqt chegarasiga yetsa — oxirgi TUGALLANGAN chuqurlikdagi eng yaxshi yurish qaytadi.
 */
function searchBestMove(fen, level) {
  const cfg = LEVELS[level] || LEVELS[2];
  const chess = new Chess(fen);
  const root = chess.moves({ verbose: true });
  if (!root.length) return null;

  // Oson daraja: ba'zan butunlay tasodifiy yurish
  if (cfg.randomP > 0 && Math.random() < cfg.randomP) return toMove(root[Math.floor(Math.random() * root.length)]);

  // Teng baholi yurishlar orasida tasodifiy tanlash uchun aralashtiramiz, so'ng tartiblaymiz (sort barqaror)
  shuffle(root);
  root.sort((a, b) => sanScore(chess, b.san) - sanScore(chess, a.san));

  const ctx = { nodes: 0, aborted: false, deadline: Date.now() + cfg.timeMs };
  let best = root[0];

  for (let depth = 1; depth <= cfg.depth; depth += 1) {
    let alpha = -Infinity;
    let iterBest = null;
    let iterScore = -Infinity;
    for (const m of root) {
      let v;
      if (m.san.endsWith('#')) v = MATE;
      else {
        chess.move(m.san);
        v = -negamax(chess, depth - 1, -Infinity, -alpha, 1, ctx);
        chess.undo();
      }
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
    if (iterScore >= MATE - 100) break; // mat topildi
    root.sort((a, b) => b.score - a.score); // keyingi chuqurlikda eng yaxshi yurish birinchi
  }
  return toMove(best);
}

/**
 * O'yin turiga qarab yo'naltiradi (worker shu funksiyani chaqiradi): shahmat -> { from, to, promotion? } (position = FEN),
 * shashka -> { path: [...] } (position = pozitsiya matni). Yurish bo'lmasa null.
 */
function searchBest(position, level, gameType) {
  if (isCheckers(gameType)) return checkersBot.searchBestMove(position, level);
  return searchBestMove(position, level);
}

// ---------------------------------------------------------------------------------------------------------------------
// Worker pool (faqat asosiy oqimda ishlatiladi)
// ---------------------------------------------------------------------------------------------------------------------

const WORKER_FILE = path.join(__dirname, 'chessBotWorker.js');
const CPUS = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const POOL_SIZE = Math.max(1, Math.min(4, CPUS - 1));
const HARD_GRACE_MS = 1500; // qidiruv o'z vaqtidan shuncha oshib ketsa worker majburan to'xtatiladi
const MAX_QUEUE = 64; // navbat to'lib ketsa — zaxira (tasodifiy) yurish, so'rov osilib qolmaydi

const slots = []; // { worker, job }
const queue = [];
let seq = 0;
let closed = false;

function logWarn(obj, msg) {
  try {
    require('../../utils/logger').warn(obj, msg); // lazy: worker ichida logger yuklanmasin
  } catch (_e) {
    /* logger bo'lmasa — jim */
  }
}

function fallbackMove(position, gameType) {
  try {
    if (isCheckers(gameType)) return require('./checkersEngine').randomMove(position);
    return require('./chessEngine').randomMoveFromFen(position);
  } catch (_e) {
    return null;
  }
}

function finish(slot, move, reason) {
  const job = slot.job;
  if (!job) return;
  clearTimeout(job.timer);
  slot.job = null;
  if (reason) logWarn({ reason, level: job.level, gameType: job.gameType }, `${isCheckers(job.gameType) ? 'Shashka' : 'Shahmat'} boti: zaxira yurish ishlatildi`);
  job.resolve(move || fallbackMove(job.fen, job.gameType));
  pump();
}

function spawnSlot(slot) {
  const worker = new Worker(WORKER_FILE);
  worker.unref();
  slot.worker = worker;
  worker.on('message', (msg) => {
    if (!slot.job || slot.job.id !== msg.id) return;
    if (msg.error) finish(slot, null, `worker xatosi: ${msg.error}`);
    else finish(slot, msg.move, null);
  });
  const onDead = (err) => {
    if (slot.worker !== worker) return;
    slot.worker = null;
    if (slot.job) finish(slot, null, `worker to'xtadi${err ? `: ${err.message}` : ''}`);
  };
  worker.on('error', onDead);
  worker.on('exit', () => onDead(null));
}

function pump() {
  if (closed) return;
  for (const slot of slots) {
    if (slot.job || !queue.length) continue;
    const job = queue.shift();
    if (!slot.worker) {
      try {
        spawnSlot(slot);
      } catch (err) {
        job.resolve(fallbackMove(job.fen, job.gameType));
        continue;
      }
    }
    slot.job = job;
    job.timer = setTimeout(() => {
      const w = slot.worker;
      slot.worker = null; // qotib qolgan worker'ni o'chirib, keyingi ishda yangisi ochiladi
      if (w) w.terminate().catch(() => {});
      finish(slot, null, 'vaqt chegarasi');
    }, (levelsFor(job.gameType)[job.level] || levelsFor(job.gameType)[2]).timeMs + HARD_GRACE_MS);
    slot.worker.postMessage({ id: job.id, fen: job.fen, level: job.level, gameType: job.gameType });
  }
}

/**
 * Bot yurishi (asinxron, worker'da). Pozitsiya (shahmatda FEN, shashkada pozitsiya matni), daraja (1–3) va o'yin turi bo'yicha
 * shahmatda { from, to, promotion? }, shashkada { path: [...] } qaytaradi (gameType berilmasa — shahmat);
 * qonuniy yurish yo'q bo'lsa null. Hech qachon osilib qolmaydi: vaqt/xatoda tasodifiy qonuniy yurish qaytadi.
 */
function chooseMove(position, level, gameType = 'CHESS') {
  const type = isCheckers(gameType) ? 'CHECKERS' : 'CHESS';
  const lv = levelsFor(type)[level] ? level : 2;
  if (closed) return Promise.resolve(fallbackMove(position, type));
  if (!slots.length) for (let i = 0; i < POOL_SIZE; i += 1) slots.push({ worker: null, job: null });
  if (queue.length >= MAX_QUEUE) return Promise.resolve(fallbackMove(position, type));
  return new Promise((resolve) => {
    seq += 1;
    queue.push({ id: seq, fen: position, level: lv, gameType: type, resolve, timer: null });
    pump();
  });
}

/** Server to'xtaganda worker'larni yopish. */
async function shutdown() {
  closed = true;
  for (const job of queue.splice(0)) job.resolve(fallbackMove(job.fen, job.gameType));
  await Promise.all(
    slots.map(async (slot) => {
      if (slot.job) {
        clearTimeout(slot.job.timer);
        slot.job.resolve(fallbackMove(slot.job.fen, slot.job.gameType));
        slot.job = null;
      }
      if (slot.worker) await slot.worker.terminate().catch(() => {});
      slot.worker = null;
    }),
  );
}

module.exports = { LEVELS, evaluate, searchBestMove, searchBest, chooseMove, shutdown };