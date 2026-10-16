'use strict';

/**
 * AdRush — SHASHKA (rus shashkasi) taxtasi. chess.js dan OLDIN yuklanadi va window.AdRushCheckers orqali ulanadi.
 * Bu modul faqat taxtani chizadi va bosishni izohlaydi. Qoidalarni klient HISOBLAMAYDI: qonuniy yo'llar (g.legalMoves —
 * to'liq yo'llar ro'yxati, masalan [['c3','d4'], ['c3','e5','g7']]) va majburiy urish (g.mustCapture) serverdan keladi.
 * Pozitsiya matni (g.fen): 8-qatordan 1-qatorgacha "/" bilan; w oddiy oq, W oq damka, b oddiy qora, B qora damka,
 * raqam — ketma-ket bo'sh kataklar; oxirida " w|b" (navbat). Yurishni yuborish chess.js da (path -> serverga).
 * Matnlar faqat textContent orqali (XSS yo'q); tashqi rasm / shrift yo'q.
 */
(function () {
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const START_COUNT = 12; // har tomonda boshida 12 dona

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Pozitsiya matni -> { 'c3': 'w', ... } */
  function parse(position) {
    const map = {};
    String(position || '').split(' ')[0].split('/').forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') f += Number(ch);
        else { map[FILES[f] + (8 - i)] = ch; f += 1; }
      }
    });
    return map;
  }

  const isWhite = (ch) => ch === 'w' || ch === 'W';
  const isKing = (ch) => ch === 'W' || ch === 'B';

  const paths = (g) => (g && Array.isArray(g.legalMoves) ? g.legalMoves : []);
  const sameStart = (p, sel) => sel.every((sq, i) => p[i] === sq);

  /** Bosilgan katakdan keyingi qo'nish kataklari (sel — hozirgacha tanlangan yo'l; faqat serverdan kelgan yo'llar asosida). */
  function nextSquares(g, sel) {
    const out = new Set();
    if (!sel.length) return out;
    for (const p of paths(g)) if (p.length > sel.length && sameStart(p, sel)) out.add(p[sel.length]);
    return out;
  }

  /** Yurishni boshlash mumkin bo'lgan donalar (majburiy urishda faqat urishi mumkinlari — server shuni beradi). */
  function startSquares(g) {
    const out = new Set();
    for (const p of paths(g)) out.add(p[0]);
    return out;
  }

  /** Bosilgan katak -> { sel, path?, haptic? }. To'liq yo'l tugasa path qaytadi va chess.js avtomatik yuboradi. */
  function onSquare(sq, g, ui) {
    const sel = ui && Array.isArray(ui.sel) ? ui.sel : [];
    if (!sel.length) {
      return startSquares(g).has(sq) ? { sel: [sq], haptic: true } : { sel: null };
    }
    if (nextSquares(g, sel).has(sq)) {
      const next = sel.concat(sq);
      const done = paths(g).some((p) => p.length === next.length && sameStart(p, next));
      return done ? { sel: null, path: next } : { sel: next, haptic: true };
    }
    if (sel.length === 1 && sel[0] === sq) return { sel: null, haptic: true }; // shu donani qayta bosish — bekor
    if (startSquares(g).has(sq)) return { sel: [sq], haptic: true }; // boshqa dona tanlandi
    return { sel: null }; // bo'sh joy — tanlov bekor
  }

  /** Faqat ko'rsatish uchun: yo'lni taxtaga qo'llaydi (urilgan donalar olinadi, oxirgi qatorda damka). Qonuniylikni server hal qiladi. */
  function optimistic(g, path) {
    const map = Object.assign({}, parse(g.fen));
    if (!Array.isArray(path) || path.length < 2) return map;
    let ch = map[path[0]];
    if (!ch) return map;
    delete map[path[0]];
    const white = isWhite(ch);
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      const df = Math.sign(FILES.indexOf(b[0]) - FILES.indexOf(a[0]));
      const dr = Math.sign(Number(b[1]) - Number(a[1]));
      let f = FILES.indexOf(a[0]) + df;
      let r = Number(a[1]) + dr;
      while (FILES[f] + r !== b) { // oradagi raqib donasi (bo'lsa) olinadi
        const mid = FILES[f] + r;
        if (map[mid] && isWhite(map[mid]) !== white) delete map[mid];
        f += df;
        r += dr;
        if (f < 0 || f > 7 || r < 1 || r > 8) break;
      }
      if (!isKing(ch) && ((white && b[1] === '8') || (!white && b[1] === '1'))) ch = white ? 'W' : 'B';
    }
    map[path[path.length - 1]] = ch;
    return map;
  }

  /** `color` tomon yutib olgan donalar: raqibning yo'qotganlari (boshlang'ich 12 dan farq). */
  function capNode(g, opt, color) {
    const wrap = node('span', 'ccap');
    const map = opt && opt.map ? opt.map : parse(g.fen);
    let oppLeft = 0;
    for (const sq of Object.keys(map)) if (isWhite(map[sq]) !== (color === 'w')) oppLeft += 1;
    const taken = Math.max(0, START_COUNT - oppLeft);
    if (taken > 0) {
      wrap.appendChild(node('span', 'ckp ckmini ' + (color === 'w' ? 'b' : 'w')));
      wrap.appendChild(node('em', null, '×' + taken));
    }
    return wrap;
  }

  function pieceNode(ch) {
    return node('span', 'ckp ' + (isWhite(ch) ? 'w' : 'b') + (isKing(ch) ? ' k' : ''));
  }

  function renderBoard(board, g, ui) {
    const o = ui && ui.opt;
    const map = o && o.map ? o.map : parse(g.fen);
    const flip = Boolean(ui && ui.flip);
    const sel = ui && Array.isArray(ui.sel) ? ui.sel : [];
    const lastPath = o && Array.isArray(o.path) ? o.path : (g.lastMove && g.lastMove.path) || [];
    const lastSet = new Set(lastPath.length ? [lastPath[0], lastPath[lastPath.length - 1]] : []);
    const targets = o ? new Set() : nextSquares(g, sel);
    const starts = !o && !sel.length ? startSquares(g) : new Set();
    const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flip ? FILES.slice().reverse() : FILES;
    const frag = document.createDocumentFragment();
    ranks.forEach((r, ri) => {
      files.forEach((f, fi) => {
        const sq = f + r;
        const dark = (FILES.indexOf(f) + r) % 2 === 1; // a1 — qora katak
        let b;
        if (dark) {
          b = node('button', 'csq dk');
          b.type = 'button';
          b.setAttribute('role', 'gridcell');
          b.setAttribute('aria-label', map[sq] ? sq + ' ' + map[sq] : sq);
        } else {
          b = node('div', 'csq lt'); // oq kataklar bosilmaydi
          b.setAttribute('role', 'presentation');
        }
        b.dataset.sq = sq;
        if (dark) {
          if (lastSet.has(sq)) b.classList.add('last');
          if (sel[0] === sq) b.classList.add('sel');
          else if (sel.includes(sq)) b.classList.add('via'); // urish yo'lining oraliq qo'nishi
          if (targets.has(sq)) { b.classList.add('tgt'); if (g.mustCapture) b.classList.add('cap'); }
          if (g.mustCapture && starts.has(sq)) b.classList.add('can'); // majburiy urishda: urishi mumkin bo'lgan donalar ajratiladi
        }
        if (fi === 0) b.appendChild(node('span', 'co-r', String(r)));
        if (ri === 7) b.appendChild(node('span', 'co-f', f));
        if (map[sq]) b.appendChild(pieceNode(map[sq]));
        frag.appendChild(b);
      });
    });
    board.replaceChildren(frag);
  }

  /** Dona yo'l bo'ylab sirpanib boradi (FLIP, oraliq qo'nishlar orqali); taxta qayta chizilgandan keyin chaqiriladi. */
  function slide(board, lm) {
    const path = lm && lm.path;
    if (!Array.isArray(path) || path.length < 2) return;
    const cell = (sq) => board.querySelector('[data-sq="' + sq + '"]');
    const last = cell(path[path.length - 1]);
    const pc = last && last.querySelector('.ckp');
    if (!pc || !pc.animate) return;
    const lb = last.getBoundingClientRect();
    const frames = [];
    for (const sq of path) {
      const c = cell(sq);
      if (!c) return;
      const r = c.getBoundingClientRect();
      frames.push({ transform: 'translate(' + (r.left - lb.left) + 'px,' + (r.top - lb.top) + 'px)' });
    }
    frames.push({ transform: 'translate(0,0)' });
    pc.classList.add('mv');
    const anim = pc.animate(frames, { duration: Math.min(700, 170 * (frames.length - 1)), easing: 'cubic-bezier(.2,.8,.2,1)' });
    const done = () => pc.classList.remove('mv');
    anim.onfinish = done;
    anim.oncancel = done;
  }

  window.AdRushCheckers = { parse, renderBoard, onSquare, optimistic, slide, capNode };
})();