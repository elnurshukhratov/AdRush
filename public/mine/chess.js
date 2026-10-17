'use strict';

/**
 * AdRush — Home = shahmat (bot bilan o'yin). mine.js dan keyin yuklanadi va window.AdRush / window.AdRushI18n orqali ishlaydi
 * (history.js kabi alohida modul, o'z DICT lug'ati bilan). Shahmat kutubxonasi klientda YO'Q: yurish qonuniyligi, natija va olmos faqat serverda;
 * klient faqat server qaytargan fen / legalMoves ni ko'rsatadi va yurish (from, to, promotion) yuboradi.
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q).
 *
 * SHASHKA: o'yin turiga bog'liq faqat taxta chizish va yurish kiritish qismi window.AdRushCheckers (checkers.js) da.
 * Qolgani (start, qidiruv, soat, long-poll, taslim, natija, qayta yuborish) shahmat bilan BIR XIL ishlaydi.
 * window.AdRushCheckers shartnomasi (hammasi ixtiyoriy emas, capNode va slide dan tashqari):
 *   renderBoard(board, g, ui)   — #chessBoard ni to'ldiradi. g — server ko'rinishi (g.fen — pozitsiya matni, g.legalMoves — to'liq yo'llar,
 *                                 g.mustCapture, g.lastMove { path }). ui = { sel, opt, flip, locked, t }. Kataklar: <button class="csq dk|lt" data-sq="c3">.
 *   onSquare(sq, g, ui)         — bosilgan katak -> { sel: [...kataklar] | null, path?: [...kataklar] (to'liq yo'l — yuboriladi), haptic?: true }.
 *   optimistic(g, path)         — yurish yuborilganda taxtada darhol ko'rsatish uchun ixtiyoriy holat (S.opt.map ga qo'yiladi).
 *   slide(board, lastMove)      — (ixtiyoriy) lastMove { path } uchun animatsiya.
 *   capNode(g, opt, color)      — (ixtiyoriy) o'yinchi paneli uchun olingan donalar tuguni (<span class="ccap">) yoki null.
 */
(function () {
  const A = window.AdRush;
  const I = window.AdRushI18n;
  if (!A || !I) return;

  const $ = (id) => document.getElementById(id);
  const { api, el } = A;

  const DICT = {
    uz: {
      g_chess: '♟\uFE0E Shahmat', g_checkers: '⚪ Shashka',
      rule_ck: 'Rus shashkasi: urish majburiy, damka uzoqqa yuradi. Yutsang +3 💎, yutqazsang −1 💎. Durang — 0.',
      must_capture: 'Urish majburiy', ck_continue: 'Urishni davom ettiring',
      rs_NO_MOVES: 'Raqibda dona yoki yurish qolmadi', rs_DRAW_RULE_CK: 'Durang qoidasi (takrorlanish yoki damkalar bilan uzoq yurish)',
      diamonds: '💎 Olmos', wins: 'G‘alaba', losses: 'Mag‘lubiyat', draws: 'Durang',
      play_bot: '🤖 Bot bilan', level: 'Qiyinlik', lv1: 'Oson', lv2: 'O‘rta', lv3: 'Qiyin',
      color: 'Rang', c_white: 'Oq', c_black: 'Qora', c_random: 'Tasodifiy',
      start: 'O‘yinni boshlash', online: '🌐 Onlayn',
      searching: 'Raqib qidirilmoqda…', search_note: 'Qidiruv paytida ilovani ochiq qoldiring.', cancel: 'Bekor qilish',
      reconnecting: 'Qayta ulanmoqda…', st_wait: 'Raqib o‘ylayapti…', opp_found: 'Raqib topildi!',
      rule: 'Yutsang +3 💎, yutqazsang −1 💎. Durang — 0.',
      you: 'Siz', bot: '🤖 Bot · {lv}', opp: '👤 Raqib', turn_you: 'Sizning navbatingiz', turn_opp: 'Navbat raqibda',
      st_you: 'Sizning yurishingiz', st_think: 'Bot o‘ylayapti…', st_check: 'Shoh! Himoyalaning', st_over: 'O‘yin tugadi',
      resign: 'Taslim bo‘lish', resign_q: 'Taslim bo‘lasizmi? Bu mag‘lubiyat hisoblanadi.',
      promo: 'Piyoda o‘rniga figura tanlang', q: 'Farzin', r: 'Rux', b: 'Fil', n: 'Ot',
      err_load: 'O‘yinni yuklab bo‘lmadi', err_net: 'Internet aloqasini tekshiring.', err_generic: 'Xatolik yuz berdi. Qayta urinib ko‘ring.',
      retry: 'Qayta urinish', synced: 'Holat yangilandi', illegal: 'Bunday yurish mumkin emas',
      unsent: 'Yurish yuborilmadi — aloqa tiklanishi bilan qayta yuboriladi', sending_slow: 'Yurish yuborilmoqda…',
      res_win: '🏆 G‘alaba!', res_lose: 'Mag‘lubiyat', res_draw: '🤝 Durang',
      rs_CHECKMATE: 'Mat', rs_STALEMATE: 'Pat', rs_DRAW_RULE: 'Durang qoidasi (takrorlanish, 50 yurish yoki material yetishmasligi)',
      rs_RESIGN: 'Taslim bo‘lish', rs_TIMEOUT: 'Vaqt tugadi', rs_ABANDON: 'O‘yin tashlab ketildi',
      again: 'Yana o‘ynash', home: 'Bosh sahifa', close: 'Yopish', moves: 'Yurishlar',
      mt_win: 'G‘alaba!', mt_lose: 'Mag‘lubiyat', mt_draw: 'Durang', diamonds_delta: 'Olmos',
      lim_MIN_MOVES: 'Olmos o‘zgarmadi: o‘yin juda qisqa bo‘ldi (yetarli yurish qilinmagan).',
      lim_BOT_DAILY_LIMIT: 'Bugungi bot g‘alabalari limiti to‘ldi — bu g‘alaba uchun olmos berilmadi.',
      lim_PAIR_LIMIT: 'Shu raqib bilan 24 soatlik limit to‘ldi — bu o‘yin uchun olmos o‘zgarmadi.',
    },
    ru: {
      g_chess: '♟\uFE0E Шахматы', g_checkers: '⚪ Шашки',
      rule_ck: 'Русские шашки: бить обязательно, дамка ходит на любое расстояние. Победа +3 💎, поражение −1 💎. Ничья — 0.',
      must_capture: 'Бить обязательно', ck_continue: 'Продолжайте взятие',
      rs_NO_MOVES: 'У соперника не осталось шашек или ходов', rs_DRAW_RULE_CK: 'Правило ничьей (повторение или долгая игра одними дамками)',
      diamonds: '💎 Алмазы', wins: 'Победы', losses: 'Поражения', draws: 'Ничьи',
      play_bot: '🤖 С ботом', level: 'Сложность', lv1: 'Лёгкий', lv2: 'Средний', lv3: 'Сложный',
      color: 'Цвет', c_white: 'Белые', c_black: 'Чёрные', c_random: 'Случайно',
      start: 'Начать игру', online: '🌐 Онлайн',
      searching: 'Ищем соперника…', search_note: 'Не закрывайте приложение во время поиска.', cancel: 'Отмена',
      reconnecting: 'Переподключение…', st_wait: 'Соперник думает…', opp_found: 'Соперник найден!',
      rule: 'Победа +3 💎, поражение −1 💎. Ничья — 0.',
      you: 'Вы', bot: '🤖 Бот · {lv}', opp: '👤 Соперник', turn_you: 'Ваш ход', turn_opp: 'Ход соперника',
      st_you: 'Ваш ход', st_think: 'Бот думает…', st_check: 'Шах! Защищайтесь', st_over: 'Игра окончена',
      resign: 'Сдаться', resign_q: 'Сдаться? Это будет засчитано как поражение.',
      promo: 'Выберите фигуру вместо пешки', q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь',
      err_load: 'Не удалось загрузить игру', err_net: 'Проверьте подключение к интернету.', err_generic: 'Произошла ошибка. Попробуйте ещё раз.',
      retry: 'Повторить', synced: 'Состояние обновлено', illegal: 'Такой ход невозможен',
      unsent: 'Ход не отправлен — будет отправлен при появлении связи', sending_slow: 'Отправляем ход…',
      res_win: '🏆 Победа!', res_lose: 'Поражение', res_draw: '🤝 Ничья',
      rs_CHECKMATE: 'Мат', rs_STALEMATE: 'Пат', rs_DRAW_RULE: 'Правило ничьей (повторение, 50 ходов или недостаток материала)',
      rs_RESIGN: 'Сдача', rs_TIMEOUT: 'Время вышло', rs_ABANDON: 'Игра брошена',
      again: 'Играть ещё', home: 'На главную', close: 'Закрыть', moves: 'Ходы',
      mt_win: 'Победа!', mt_lose: 'Поражение', mt_draw: 'Ничья', diamonds_delta: 'Алмазы',
      lim_MIN_MOVES: 'Алмазы не изменились: партия была слишком короткой (недостаточно ходов).',
      lim_BOT_DAILY_LIMIT: 'Дневной лимит побед над ботом исчерпан — за эту победу алмазы не начислены.',
      lim_PAIR_LIMIT: 'Лимит за 24 часа с этим соперником исчерпан — алмазы за эту партию не изменились.',
    },
    en: {
      g_chess: '♟\uFE0E Chess', g_checkers: '⚪ Checkers',
      rule_ck: 'Russian draughts: capturing is mandatory, kings fly. Win +3 💎, lose −1 💎. Draw — 0.',
      must_capture: 'Capture is mandatory', ck_continue: 'Continue the capture',
      rs_NO_MOVES: 'The opponent has no pieces or moves left', rs_DRAW_RULE_CK: 'Draw rule (repetition or long play with kings only)',
      diamonds: '💎 Diamonds', wins: 'Wins', losses: 'Losses', draws: 'Draws',
      play_bot: '🤖 Vs bot', level: 'Difficulty', lv1: 'Easy', lv2: 'Medium', lv3: 'Hard',
      color: 'Color', c_white: 'White', c_black: 'Black', c_random: 'Random',
      start: 'Start game', online: '🌐 Online',
      searching: 'Looking for an opponent…', search_note: 'Keep the app open while searching.', cancel: 'Cancel',
      reconnecting: 'Reconnecting…', st_wait: 'Opponent is thinking…', opp_found: 'Opponent found!',
      rule: 'Win +3 💎, lose −1 💎. Draw — 0.',
      you: 'You', bot: '🤖 Bot · {lv}', opp: '👤 Opponent', turn_you: 'Your turn', turn_opp: 'Opponent’s turn',
      st_you: 'Your move', st_think: 'Bot is thinking…', st_check: 'Check! Defend your king', st_over: 'Game over',
      resign: 'Resign', resign_q: 'Resign? This counts as a loss.',
      promo: 'Choose a piece for the pawn', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight',
      err_load: 'Could not load the game', err_net: 'Check your internet connection.', err_generic: 'Something went wrong. Please try again.',
      retry: 'Retry', synced: 'Position updated', illegal: 'That move is not allowed',
      unsent: 'Move not sent — it will be resent when the connection is back', sending_slow: 'Sending move…',
      res_win: '🏆 You won!', res_lose: 'You lost', res_draw: '🤝 Draw',
      rs_CHECKMATE: 'Checkmate', rs_STALEMATE: 'Stalemate', rs_DRAW_RULE: 'Draw rule (repetition, 50 moves or insufficient material)',
      rs_RESIGN: 'Resignation', rs_TIMEOUT: 'Time ran out', rs_ABANDON: 'Game abandoned',
      again: 'Play again', home: 'Home', close: 'Close', moves: 'Moves',
      mt_win: 'You won!', mt_lose: 'You lost', mt_draw: 'Draw', diamonds_delta: 'Diamonds',
      lim_MIN_MOVES: 'Diamonds unchanged: the game was too short (not enough moves).',
      lim_BOT_DAILY_LIMIT: 'Daily limit of bot wins reached — no diamonds for this win.',
      lim_PAIR_LIMIT: '24-hour limit with this opponent reached — diamonds unchanged for this game.',
    },
  };

  function t(key, vars) {
    let s = (DICT[I.lang] && DICT[I.lang][key]) || DICT.uz[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const PIECE = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const TEXT_VS = '\uFE0E'; // iOS pieces emoji bo'lib ketmasin
  const MOVE_TRIES = 3; // yurishni yuborish urinishlari (expectedMoveCount tufayli qayta yuborish xavfsiz — ikki marta qo'llanmaydi)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const S = {
    panel: 'loading', // loading | error | start | game
    gameType: 'CHESS', // 'CHESS' | 'CHECKERS' — start ekranidagi tanlov; faol o'yin tiklanganda o'yinning gameType idan olinadi
    game: null, // serverdan kelgan o'yin ko'rinishi
    stats: null,
    sel: null, // tanlangan maydon
    pending: null, // promotion kutilayotgan yurish { from, to }
    busy: false, // yurish / taslim so'rovi ketmoqda
    net: false, // so'nggi so'rov tarmoq xatosi bilan tugagan
    level: 2,
    color: 'random',
    starting: false,
    loading: false,
    out: null, // serverga hali yetib bormagan yurish { body, from, to } (qayta yuboriladi)
    outTimer: 0,
    opt: null, // optimistik yurish { from, to, promotion, base, map } — server tasdiqlaguncha taxtada ko'rinib turadi
    shownCount: 0, // hozir taxtada ko'rsatilgan pozitsiyaning moveCount'i (animatsiya takrorlanmasligi uchun)
    wId: 0, // long-poll sikli identifikatori (yangisi eskisini to'xtatadi)
    errKey: 'err_net',
    modal: null, // natija oynasi (lazy)
    shownFor: null, // natija oynasi qaysi o'yin uchun ko'rsatilgan
    // onlayn: navbat
    joining: false, // navbatga qo'shilish so'rovi ketmoqda
    searching: false, // "Raqib qidirilmoqda" holati
    cancelling: false,
    searchStart: 0,
    qTimer: 0,
    qBusy: false,
    qFails: 0,
    searchTick: 0,
    // o'yin: long-poll (/wait) + soat
    gFails: 0,
    clock: null, // { w, b, run, at } — serverdan kelgan qiymat + qabul qilingan vaqt (ko'rsatish uchun lokal sanoq)
    tick: 0,
    flagAt: 0,
  };
  const QUEUE = '/api/chess/online/queue';

  // ---------- O'yin turi (shahmat / shashka) ----------
  const normType = (v) => (String(v || '').toUpperCase() === 'CHECKERS' ? 'CHECKERS' : 'CHESS'); // gameType yo'q (eski o'yin) — shahmat
  const isCk = () => S.gameType === 'CHECKERS';
  const apiType = () => S.gameType.toLowerCase(); // API: 'chess' | 'checkers'
  const CK = () => window.AdRushCheckers || null; // checkers.js (chess.js dan oldin ulanadi)
  const playSnd = (name, delay) => { const s = window.AdRushSound; if (s) s.play(name, delay); }; // sounds.js (ixtiyoriy)
  const pieceCount = (fen) => String(fen || '').split(' ')[0].replace(/[\d/]/g, '').length; // taxtadagi donalar soni (urish aniqlash uchun)

  function setType(v) {
    const nt = normType(v);
    if (nt === S.gameType) return;
    S.gameType = nt;
    applyTexts();
    renderStart();
  }

  const ok = (r) => r.status >= 200 && r.status < 300 && r.data && r.data.success;
  const reasonOf = (r) => (r && r.data && r.data.reason) || '';

  // ---------- Umumiy ----------
  function applyTexts() {
    document.querySelectorAll('#view-home [data-ck]').forEach((n) => { n.textContent = t(n.dataset.ck); });
    $('chessErrText').textContent = t(S.errKey);
    $('chessRule').textContent = t(isCk() ? 'rule_ck' : 'rule');
  }

  function show(panel) {
    S.panel = panel;
    $('chessLoading').hidden = panel !== 'loading';
    $('chessError').hidden = panel !== 'error';
    $('chessStart').hidden = panel !== 'start';
    $('chessSearch').hidden = panel !== 'search';
    $('chessGame').hidden = panel !== 'game';
  }

  function showError(key) {
    S.errKey = key || 'err_net';
    $('chessErrText').textContent = t(S.errKey);
    show('error');
  }

  // ---------- Boshlang'ich ekran ----------
  function renderStart() {
    const st = S.stats;
    if (st) {
      A.setNum($('chessDiamonds'), st.diamonds, false);
      $('chessWins').textContent = A.nf.format(st.wins);
      $('chessLosses').textContent = A.nf.format(st.losses);
      $('chessDraws').textContent = A.nf.format(st.draws);
    }
    document.querySelectorAll('#chessGames .cchip').forEach((b) => {
      const on = b.dataset.game === S.gameType;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#chessLevels .cchip').forEach((b) => {
      const on = Number(b.dataset.level) === S.level;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#chessColors .cchip').forEach((b) => {
      const on = b.dataset.color === S.color;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('chessStartBot').disabled = S.starting || S.joining;
    $('chessOnline').disabled = S.starting || S.joining;
    $('chessGames').querySelectorAll('.cchip').forEach((b) => { b.disabled = S.starting || S.joining; });
  }

  async function loadStats() {
    const type = S.gameType; // tur almashsa, eski javob yangisini bosib ketmasin
    const res = await api('GET', '/api/chess/stats?game=' + apiType());
    if (!ok(res) || type !== S.gameType) return false;
    S.stats = { wins: res.data.wins, losses: res.data.losses, draws: res.data.draws, diamonds: res.data.diamonds };
    return true;
  }

  async function showStart() {
    S.game = null;
    S.sel = null;
    S.pending = null;
    closeResult();
    S.opt = null;
    S.wId += 1; // long-poll to'xtaydi
    stopTick();
    S.clock = null;
    setConn(false);
    stopSearch();
    renderStart();
    show('start');
    if (await loadStats()) renderStart();
  }

  // ---------- Yuklash / tiklash ----------
  /** Faol o'yinni tiklaydi; bo'lmasa boshlang'ich ekran. quiet — mavjud ekran o'rniga skeleton ko'rsatilmaydi. */
  async function loadCurrent(quiet) {
    if (S.loading) return;
    S.loading = true;
    if (!quiet && S.panel !== 'game') show('loading');
    try {
      const res = await api('GET', '/api/chess/games/current');
      if (!ok(res)) {
        if (quiet && S.game) { setNet(true); return; }
        showError('err_net');
        return;
      }
      setNet(false);
      const g = res.data.game;
      if (!g) {
        if (await resumeQueue()) return; // ilova navbat paytida qayta ochilgan bo'lishi mumkin
        await showStart();
        return;
      }
      applyGame(g);
    } finally {
      S.loading = false;
    }
  }

  async function reloadGame() {
    if (!S.game) return loadCurrent(false);
    const res = await api('GET', '/api/chess/games/' + S.game.id);
    if (!ok(res)) {
      if (reasonOf(res) === 'GAME_NOT_FOUND') { await showStart(); return; }
      setNet(true);
      return;
    }
    setNet(false);
    applyGame(res.data.game);
  }

  function setNet(v) {
    S.net = v;
    $('chessNet').hidden = !v;
  }

  /** Onlayn o'yinda aloqa uzilgani: "Qayta ulanmoqda…" (polling o'zi tiklaydi). */
  function setConn(v) {
    $('chessConn').hidden = !v;
  }

  // ---------- O'yin holati ----------
  function applyGame(g) {
    setType(g.gameType); // faol o'yinning turi (gameType yo'q bo'lsa — shahmat)
    const prev = S.game && S.game.id === g.id ? S.game : null;
    const fresh = !prev || g.moveCount > S.shownCount; // taxtada hali ko'rinmagan yangi yurish (raqib / bot)
    S.game = g;
    S.opt = null;
    S.out = null;
    clearTimeout(S.outTimer);
    S.sel = null;
    S.pending = null;
    $('chessPromo').hidden = true;
    stopSearch();
    S.gFails = 0;
    S.flagAt = 0;
    setConn(false);
    setClock(g);
    show('game');
    renderGame();
    if (prev && fresh && g.lastMove) slideMove(g.lastMove); // raqib / bot yurishi: figura sirpanib boradi
    const pcs = pieceCount(g.fen);
    if (prev && fresh && g.lastMove) { // raqib / bot yurishi ovozi
      const cap = S.pcs != null && pcs < S.pcs;
      playSnd(g.inCheck && g.turn === g.yourColor ? 'check' : cap ? 'capture' : 'move');
    }
    S.pcs = pcs;
    if (prev && fresh && prev.yourColor && g.turn === g.yourColor && g.status === 'ACTIVE') A.haptic('light', true);
    S.shownCount = g.moveCount;
    if (g.status === 'FINISHED') {
      S.wId += 1;
      stopTick();
      A.refresh().catch(() => {}); // global balans: yuqori panel, Vazifalar, Profil
      A.haptic(g.yourDelta > 0 ? 'success' : g.yourDelta < 0 ? 'warning' : 'light', true);
      if (prev && S.shownFor !== g.id) playSnd(g.yourDelta > 0 ? 'win' : g.yourDelta < 0 ? 'lose' : 'draw', 300); // oxirgi yurish ovozidan keyin
      if (S.shownFor !== g.id) { S.shownFor = g.id; openResult(); }
      return;
    }
    if (g.mode === 'ONLINE') ensureTick();
    startWait();
  }

  // ---------- Onlayn: soat (server qiymati + lokal sanoq) ----------
  function setClock(g) {
    S.clock = g.mode === 'ONLINE' && g.whiteTimeMs != null && g.blackTimeMs != null
      ? { w: g.whiteTimeMs, b: g.blackTimeMs, run: g.status === 'ACTIVE' ? g.turn : null, at: Date.now() }
      : null;
  }

  function clockMs(c) {
    const k = S.clock;
    if (!k || k[c] == null) return null;
    return Math.max(0, k[c] - (k.run === c ? Date.now() - k.at : 0));
  }

  function fmtClock(ms) {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }

  function tickClocks() {
    if (!S.clock) return;
    document.querySelectorAll('#chessGame .cclock').forEach((n) => {
      const ms = clockMs(n.dataset.c);
      if (ms == null) return;
      n.textContent = fmtClock(ms);
      n.classList.toggle('run', S.clock.run === n.dataset.c);
      n.classList.toggle('low', ms <= 10000);
    });
    // navbatdagi tomonning vaqti tugadi: server hal qiladi (TIMEOUT), shuning uchun holatni darhol so'raymiz
    if (S.clock.run && clockMs(S.clock.run) <= 0 && Date.now() - S.flagAt > 1500) {
      S.flagAt = Date.now();
      pollGame().catch(() => {});
    }
  }

  function ensureTick() {
    if (S.tick) return;
    S.tick = setInterval(tickClocks, 250);
    tickClocks();
  }

  function stopTick() {
    clearInterval(S.tick);
    S.tick = 0;
  }

  // ---------- O'yin: long-poll (raqib / bot yurishi kutmasdan keladi) ----------
  const isActive = () => Boolean(S.game && S.game.status === 'ACTIVE');
  const isOnlineActive = () => Boolean(S.game && S.game.mode === 'ONLINE' && S.game.status === 'ACTIVE');

  /** Server o'yin o'zgarguncha (≤20 s) so'rovni ushlab turadi va o'zgarishi bilan javob beradi: polling kechikishi yo'q. */
  function startWait() {
    if (!isActive() || document.hidden) return;
    S.wId += 1;
    waitCycle(S.wId).catch(() => {});
  }

  function syncClockOnly(d) {
    if (S.game && S.game.mode === 'ONLINE' && d.whiteTimeMs != null && d.blackTimeMs != null) {
      S.clock = { w: d.whiteTimeMs, b: d.blackTimeMs, run: d.turn, at: Date.now() };
      tickClocks();
    }
  }

  async function waitCycle(id) {
    while (id === S.wId) {
      const g = S.game;
      if (!g || g.status !== 'ACTIVE' || S.panel !== 'game' || document.hidden) return;
      if (S.busy) { await sleep(120); continue; } // yurish ketmoqda: javobi o'zi yangilaydi
      const url = '/api/chess/games/' + g.id + '/wait?since=' + g.moveCount + '&st=' + g.status + '&ms=20000';
      const res = await api('GET', url, undefined, { timeout: 26000, retry: false });
      if (id !== S.wId) return;
      if (S.busy) continue;
      if (!ok(res)) {
        if (reasonOf(res) === 'GAME_NOT_FOUND') { await showStart(); return; }
        if (res.status === 401 || res.status === 403) return;
        S.gFails += 1;
        if (S.gFails >= 2) setConn(true);
        await sleep(Math.min(4000, 500 * S.gFails));
        continue;
      }
      S.gFails = 0;
      setConn(false);
      setNet(false);
      const d = res.data;
      if (d.changed && d.game) {
        const ng = d.game;
        if (ng.id !== g.id) return;
        if (ng.moveCount < S.game.moveCount) continue; // eskirgan javob
        if (ng.moveCount !== S.game.moveCount || ng.status !== S.game.status) { applyGame(ng); return; } // yangi sikl applyGame ichida
      } else syncClockOnly(d);
    }
  }

  /** Soat nolga yetganda (yoki qo'lda) holatni darhol so'raydi. */
  async function pollGame() {
    if (!isActive() || S.panel !== 'game' || S.busy || S.loading) return;
    await reloadGame();
  }

  // ---------- Onlayn: navbat ----------
  function renderSearchTimer() {
    const s = Math.max(0, Math.floor((Date.now() - S.searchStart) / 1000));
    $('chessSearchTimer').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function queueLoop(delay) {
    clearTimeout(S.qTimer);
    S.qTimer = setTimeout(() => { pollQueue().catch(() => {}); }, delay);
  }

  function showSearch(waitedSec) {
    $('chessSearchIco').textContent = isCk() ? '⚪' : '♞';
    S.searching = true;
    S.cancelling = false;
    S.qFails = 0;
    S.searchStart = Date.now() - (Number(waitedSec) || 0) * 1000;
    $('chessSearchConn').hidden = true;
    $('chessSearchCancel').disabled = false;
    show('search');
    renderSearchTimer();
    clearInterval(S.searchTick);
    S.searchTick = setInterval(renderSearchTimer, 1000);
    queueLoop(1200);
  }

  function stopSearch() {
    S.searching = false;
    S.cancelling = false;
    S.qFails = 0;
    clearTimeout(S.qTimer);
    clearInterval(S.searchTick);
  }

  /** Navbat javobini qayta ishlaydi: matched → o'yin ochiladi, searching → qidiruv ekrani. idle bo'lsa false. */
  async function onQueueData(d) {
    if (d.status === 'matched' && d.gameId) {
      stopSearch();
      await openOnlineGame(d.gameId);
      return true;
    }
    if (d.status === 'searching') {
      if (d.gameType) setType(d.gameType); // ilova qayta ochilganda navbat qaysi turdaligi
      if (S.searching) S.searchStart = Date.now() - (Number(d.waitedSec) || 0) * 1000;
      else showSearch(d.waitedSec);
      return true;
    }
    return false;
  }

  async function openOnlineGame(id) {
    const res = await api('GET', '/api/chess/games/' + id);
    if (ok(res)) {
      A.haptic('success');
      if (A.state.view !== 'home') A.toast(t('opp_found'), false); // foydalanuvchi boshqa bo'limda bo'lishi mumkin
      applyGame(res.data.game);
      return;
    }
    if (res.status === 401 || res.status === 403) return;
    showError('err_net'); // "Qayta urinish" faol o'yinni /games/current orqali tiklaydi
  }

  /** Ilova navbat paytida qayta ochilsa: qidiruv / topilgan o'yin tiklanadi. */
  async function resumeQueue() {
    const res = await api('GET', QUEUE);
    if (!ok(res) || res.data.status === 'idle') return false;
    return onQueueData(res.data);
  }

  async function startOnline() {
    if (S.joining || S.starting || S.searching) return;
    S.joining = true;
    renderStart();
    const res = await api('POST', QUEUE, { gameType: apiType() }, { timeout: 15000 });
    S.joining = false;
    renderStart();
    if (ok(res)) { A.haptic('light'); await onQueueData(res.data); return; }
    if (reasonOf(res) === 'ALREADY_ACTIVE') { await loadCurrent(false); return; } // boshqa qurilmada boshlangan bot o'yini tiklanadi
    if (res.status === 401 || res.status === 403) return;
    A.toast(t(res.status === 0 ? 'err_net' : 'err_generic'), true);
  }

  async function pollQueue() {
    if (!S.searching || S.cancelling || S.qBusy || document.hidden) return;
    S.qBusy = true;
    let res = await api('GET', QUEUE);
    if (ok(res) && res.data.status === 'idle' && S.searching && !S.cancelling) {
      // navbat yozuvi eskirgan (masalan, ilova fonda qolgan) — qidiruv davom etadi
      res = await api('POST', QUEUE, { gameType: apiType() }, { timeout: 15000 });
    }
    S.qBusy = false;
    if (!S.searching || S.cancelling) return;
    if (!ok(res)) {
      if (reasonOf(res) === 'ALREADY_ACTIVE') { stopSearch(); await loadCurrent(false); return; }
      S.qFails += 1;
      $('chessSearchConn').hidden = false;
      queueLoop(Math.min(5000, 1200 + S.qFails * 800));
      return;
    }
    S.qFails = 0;
    $('chessSearchConn').hidden = true;
    if (!(await onQueueData(res.data))) { stopSearch(); await showStart(); return; }
    if (S.searching && !document.hidden) queueLoop(1200);
  }

  async function cancelSearch() {
    if (!S.searching || S.cancelling) return;
    S.cancelling = true;
    $('chessSearchCancel').disabled = true;
    clearTimeout(S.qTimer);
    const res = await api('DELETE', QUEUE, undefined, { timeout: 10000 });
    if (ok(res)) {
      const matched = res.data.status === 'matched' && res.data.gameId; // raqib shu orada juftlab ulgurgan bo'lishi mumkin
      stopSearch();
      if (matched) await openOnlineGame(res.data.gameId);
      else await showStart();
      return;
    }
    // bekor qilinmadi — qidiruv davom etadi
    S.cancelling = false;
    $('chessSearchCancel').disabled = false;
    if (res.status !== 401 && res.status !== 403) A.toast(t(res.status === 0 ? 'err_net' : 'err_generic'), true);
    if (!document.hidden) queueLoop(1200);
  }

  function parseFen(fen) {
    const map = {};
    fen.split(' ')[0].split('/').forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') f += Number(ch);
        else { map[FILES[f] + (8 - i)] = ch; f += 1; }
      }
    });
    return map;
  }

  function pieceNode(ch, cls) {
    if (window.AdRushPieces) return window.AdRushPieces.make(ch, cls); // SVG dona (pieces.js) — hamma qurilmada bir xil
    const w = ch === ch.toUpperCase();
    return el('span', 'pc ' + (w ? 'w' : 'b') + (cls ? ' ' + cls : ''), PIECE[ch.toLowerCase()] + TEXT_VS); // zaxira: matn belgisi
  }

  /** Optimistik yurish bo'lsa navbat allaqachon raqibda. */
  const turnNow = () => {
    const g = S.game;
    if (!g) return 'w';
    return S.opt ? (g.turn === 'w' ? 'b' : 'w') : g.turn;
  };

  const isMyTurn = () => {
    const g = S.game;
    return Boolean(g && g.status === 'ACTIVE' && g.turn === g.yourColor && !S.busy && !S.opt);
  };

  /** Faqat ko'rsatish uchun: yurishni taxta xaritasiga qo'llaydi (qonuniylikni server hal qiladi; bu yerda tekshirilmaydi). */
  function applyOpt(map, from, to, promo) {
    const m = Object.assign({}, map);
    const ch = m[from];
    if (!ch) return m;
    const lower = ch.toLowerCase();
    if (lower === 'p' && from[0] !== to[0] && !m[to]) delete m[to[0] + from[1]]; // en passant
    if (lower === 'k' && Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0])) === 2) { // rokirovka: rux ham ko'chadi
      const king = to[0] === 'g';
      const rf = (king ? 'h' : 'a') + from[1];
      const rt = (king ? 'f' : 'd') + from[1];
      if (m[rf]) { m[rt] = m[rf]; delete m[rf]; }
    }
    delete m[from];
    m[to] = promo ? (ch === ch.toUpperCase() ? promo.toUpperCase() : promo) : ch;
    return m;
  }

  /** Figura qo'yilgan maydonga sirpanib boradi (FLIP): taxta qayta chizilgandan keyin chaqiriladi. */
  function slideMove(lm) {
    if (!lm || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const board = $('chessBoard');
    if (lm.path) { // shashka: { path } — animatsiyani checkers.js chizadi
      const D = CK();
      if (D && D.slide) D.slide(board, lm);
      return;
    }
    const from = board.querySelector('[data-sq="' + lm.from + '"]');
    const to = board.querySelector('[data-sq="' + lm.to + '"]');
    const pc = to && to.querySelector('.pc');
    if (!from || !pc) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) return;
    pc.classList.add('mv');
    pc.style.transition = 'none';
    pc.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    void pc.offsetWidth; // reflow
    pc.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
    pc.style.transform = '';
    setTimeout(() => { pc.style.transition = ''; pc.classList.remove('mv'); }, 280);
  }

  // Olingan figuralar va material farqi (taxtadagi figuralardan; klient qoida hisoblamaydi, faqat sanaydi)
  const START_CNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  function materialOf(map) {
    const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const sq of Object.keys(map)) {
      const ch = map[sq];
      const k = ch.toLowerCase();
      if (cnt.w[k] === undefined) continue; // shoh
      cnt[ch === ch.toUpperCase() ? 'w' : 'b'][k] += 1;
    }
    const sum = (c) => Object.keys(PVAL).reduce((x, k) => x + PVAL[k] * c[k], 0);
    const lost = (c) => ['q', 'r', 'b', 'n', 'p'].map((k) => [k, Math.max(0, START_CNT[k] - c[k])]).filter((x) => x[1] > 0);
    return { diff: sum(cnt.w) - sum(cnt.b), lostW: lost(cnt.w), lostB: lost(cnt.b) };
  }

  /** `color` tomon yutib olgan figuralar (qarshi rangning yo'qotganlari) + ustunlik "+N". */
  function capNode(mat, color) {
    const wrap = el('span', 'ccap');
    const lost = color === 'w' ? mat.lostB : mat.lostW;
    for (const [k, n] of lost) for (let i = 0; i < n; i += 1) {
      wrap.appendChild(window.AdRushPieces
        ? window.AdRushPieces.small(k, color !== 'w')
        : el('span', 'cp ' + (color === 'w' ? 'b' : 'w'), PIECE[k] + TEXT_VS));
    }
    const adv = color === 'w' ? mat.diff : -mat.diff;
    if (adv > 0) wrap.appendChild(el('em', null, '+' + adv));
    return wrap;
  }

  function renderBoard() {
    const g = S.game;
    const board = $('chessBoard');
    board.classList.toggle('ckb', isCk()); // CSS: .cboard.ckb — shashka taxtasi
    if (isCk()) {
      const D = CK();
      if (D) D.renderBoard(board, g, { sel: S.sel, opt: S.opt, flip: g.yourColor === 'b', locked: !isMyTurn(), t });
      else board.replaceChildren();
      board.classList.toggle('locked', !isMyTurn());
      board.classList.toggle('wait', Boolean(S.opt));
      return;
    }
    const map = S.opt ? S.opt.map : parseFen(g.fen);
    const lm = S.opt ? { from: S.opt.from, to: S.opt.to } : g.lastMove;
    const flip = g.yourColor === 'b';
    const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flip ? FILES.slice().reverse() : FILES;
    const targets = new Set(S.sel && g.legalMoves && g.legalMoves[S.sel] ? g.legalMoves[S.sel] : []);
    let kingSq = null;
    if (g.inCheck && !S.opt) {
      const k = g.turn === 'w' ? 'K' : 'k';
      kingSq = Object.keys(map).find((sq) => map[sq] === k) || null;
    }
    const frag = document.createDocumentFragment();
    ranks.forEach((r, ri) => {
      files.forEach((f, fi) => {
        const sq = f + r;
        const dark = (FILES.indexOf(f) + r) % 2 === 1; // a1 — to'q
        const b = el('button', 'csq ' + (dark ? 'dk' : 'lt'));
        b.type = 'button';
        b.dataset.sq = sq;
        b.setAttribute('role', 'gridcell');
        const ch = map[sq];
        b.setAttribute('aria-label', ch ? sq + ' ' + ch : sq);
        if (lm && (lm.from === sq || lm.to === sq)) b.classList.add('last');
        if (S.sel === sq) b.classList.add('sel');
        if (kingSq === sq) b.classList.add('chk');
        if (targets.has(sq)) { b.classList.add('tgt'); if (ch) b.classList.add('cap'); }
        if (fi === 0) b.appendChild(el('span', 'co-r', String(r)));
        if (ri === 7) b.appendChild(el('span', 'co-f', f));
        if (ch) b.appendChild(pieceNode(ch));
        frag.appendChild(b);
      });
    });
    board.replaceChildren(frag);
    board.classList.toggle('locked', !isMyTurn());
    board.classList.toggle('wait', Boolean(S.opt));
  }

  function playerBar(node, label, active, color, cap) {
    node.classList.toggle('turn', active);
    const right = el('div', 'cbar-r');
    if (S.clock) {
      const c = el('b', 'cclock');
      c.dataset.c = color; // onlayn: soat; tickClocks to'ldiradi
      right.appendChild(c);
    } else if (active) {
      right.appendChild(el('i', null, t(node.id === 'chessMe' ? 'turn_you' : 'turn_opp')));
    }
    const left = el('div', 'cbar-l');
    left.append(el('span', 'cdot'), el('span', 'cname', label), cap);
    node.replaceChildren(left, right);
  }

  function renderGame() {
    const g = S.game;
    if (!g) return;
    const active = g.status === 'ACTIVE';
    const online = g.mode === 'ONLINE';
    const oppLabel = g.opponent && g.opponent.type === 'BOT'
      ? t('bot', { lv: t('lv' + (g.opponent.level || 2)) })
      : '👤 ' + (g.opponent && g.opponent.name ? g.opponent.name : t('opp').replace('👤 ', '')); // ism — textContent orqali (XSS yo'q)
    const oppColor = g.yourColor === 'w' ? 'b' : 'w';
    const turn = turnNow();
    const ck = isCk();
    const mat = ck ? null : materialOf(S.opt ? S.opt.map : parseFen(g.fen));
    const capOf = (c) => {
      if (!ck) return capNode(mat, c);
      const D = CK();
      return (D && D.capNode && D.capNode(g, S.opt, c)) || el('span', 'ccap');
    };
    playerBar($('chessOpp'), oppLabel, active && turn !== g.yourColor, oppColor, capOf(oppColor));
    playerBar($('chessMe'), t('you'), active && turn === g.yourColor, g.yourColor, capOf(g.yourColor));
    renderBoard();

    const st = $('chessStatus');
    st.className = 'chess-status';
    if (!active) { st.textContent = t('st_over'); }
    else if (S.opt && !S.busy) { st.textContent = t('unsent'); st.classList.add('bad'); }
    else if (turn !== g.yourColor || S.busy) { st.textContent = t(online ? 'st_wait' : 'st_think'); st.classList.add('think'); }
    else if (ck && g.mustCapture) { st.textContent = t(S.sel && S.sel.length > 1 ? 'ck_continue' : 'must_capture'); st.classList.add('bad'); }
    else if (g.inCheck) { st.textContent = t('st_check'); st.classList.add('bad'); }
    else st.textContent = t('st_you');

    renderMoves();
    $('chessResign').hidden = !active;
    $('chessResign').disabled = S.busy;
    renderResult();
    tickClocks();
  }

  /** Natija ma'lumoti (matnlar, rang turi, olmos o'zgarishi, limit izohi) — modal va ixcham karta uchun umumiy. */
  function resultInfo(g) {
    const won = (g.result === 'WHITE' && g.yourColor === 'w') || (g.result === 'BLACK' && g.yourColor === 'b');
    const kind = g.result === 'DRAW' ? 'draw' : won ? 'win' : 'lose';
    const d = Number(g.yourDelta) || 0;
    const delta = (d > 0 ? '+' + A.nf.format(d) : d < 0 ? '−' + A.nf.format(-d) : '0') + ' 💎';
    const note = g.limit && DICT.uz['lim_' + g.limit] ? t('lim_' + g.limit) : ''; // noma'lum limit kodi — izoh yo'q
    const rk = 'rs_' + g.endReason + (g.endReason === 'DRAW_RULE' && normType(g.gameType) === 'CHECKERS' ? '_CK' : '');
    return { kind, delta, d, reason: t(rk), note };
  }

  /** Ixcham natija kartasi (taxta ostida): oyna yopilgandan keyin ham "Yana o'ynash" / "Bosh sahifa" qoladi. */
  function renderResult() {
    const g = S.game;
    const box = $('chessResult');
    if (!g || g.status !== 'FINISHED') { box.hidden = true; return; }
    const r = resultInfo(g);
    box.className = 'card chess-result ' + r.kind;
    $('chessResTitle').textContent = t('mt_' + r.kind);
    $('chessResReason').textContent = r.reason + (r.note ? ' · ' + r.note : '');
    $('chessResDelta').textContent = r.delta;
    box.hidden = false;
  }

  // ---------- Natija oynasi (modal) ----------
  function ensureModal() {
    if (S.modal) return S.modal;
    const bg = el('div', 'cmodal-bg');
    bg.hidden = true;
    const box = el('div', 'cmodal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const close = el('button', 'cmodal-x', '✕');
    close.type = 'button';
    const ico = el('div', 'cmodal-ico');
    const title = el('b', 'cmodal-title');
    const reason = el('span', 'muted cmodal-reason');
    const delta = el('div', 'cmodal-delta');
    const note = el('p', 'muted cmodal-note');
    const btns = el('div', 'cmodal-btns');
    const again = el('button', 'btn');
    again.type = 'button';
    const home = el('button', 'btn sec');
    home.type = 'button';
    btns.append(again, home);
    box.append(close, ico, title, reason, delta, note, btns);
    bg.appendChild(box);
    bg.addEventListener('click', (e) => { if (e.target === bg) closeResult(); });
    close.addEventListener('click', closeResult);
    again.addEventListener('click', () => { showStart().catch(() => {}); });
    home.addEventListener('click', () => { showStart().catch(() => {}); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bg.hidden) closeResult(); });
    document.body.appendChild(bg);
    S.modal = { bg, box, close, ico, title, reason, delta, note, again, home };
    return S.modal;
  }

  function renderResultModal() {
    const m = S.modal;
    const g = S.game;
    if (!m || m.bg.hidden || !g || g.status !== 'FINISHED') return;
    const r = resultInfo(g);
    m.box.className = 'cmodal ' + r.kind;
    m.ico.textContent = r.kind === 'win' ? '🏆' : r.kind === 'draw' ? '🤝' : '😔';
    m.title.textContent = t('mt_' + r.kind);
    m.reason.textContent = r.reason;
    m.delta.textContent = t('diamonds_delta') + ': ' + r.delta;
    m.note.textContent = r.note;
    m.note.hidden = !r.note;
    m.again.textContent = t('again');
    m.home.textContent = t('home');
    m.close.setAttribute('aria-label', t('close'));
  }

  function openResult() {
    const m = ensureModal();
    m.bg.hidden = false;
    renderResultModal();
    requestAnimationFrame(() => { try { m.again.focus({ preventScroll: true }); } catch (_e) { /* ixtiyoriy */ } });
  }

  function closeResult() {
    if (S.modal) S.modal.bg.hidden = true;
  }

  // ---------- Yurishlar ro'yxati (server bergan SAN; klient hech narsani hisoblamaydi) ----------
  function renderMoves() {
    const g = S.game;
    const box = $('chessMoves');
    const list = g && Array.isArray(g.moves) ? g.moves : [];
    box.hidden = list.length === 0;
    if (!list.length) { box.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < list.length; i += 2) {
      const pair = el('span', 'cm-pair');
      pair.append(el('i', null, String(i / 2 + 1) + '.'));
      pair.append(el('span', 'cm-san' + (i === list.length - 1 ? ' cur' : ''), String(list[i])));
      if (i + 1 < list.length) pair.append(el('span', 'cm-san' + (i + 1 === list.length - 1 ? ' cur' : ''), String(list[i + 1])));
      frag.appendChild(pair);
    }
    box.replaceChildren(frag);
    box.scrollLeft = box.scrollWidth;
  }

  // ---------- Bosish orqali yurish ----------
  function isPromotion(from, to) {
    const ch = parseFen(S.game.fen)[from];
    return Boolean(ch) && ((ch === 'P' && to[1] === '8') || (ch === 'p' && to[1] === '1'));
  }

  /** Shashka: bosishni checkers.js izohlaydi; to'liq yo'l tayyor bo'lsa avtomatik yuboriladi. Qoidani klient hisoblamaydi (legalMoves serverdan). */
  function onCheckersSquare(sq) {
    const D = CK();
    if (!D) return;
    const act = D.onSquare(sq, S.game, { sel: S.sel }) || {};
    S.sel = act.sel && act.sel.length ? act.sel : null;
    if (Array.isArray(act.path) && act.path.length >= 2) { sendPath(act.path); return; }
    if (act.haptic) A.haptic('select');
    renderGame(); // holat qatori ("Urishni davom ettiring") ham yangilanadi
  }

  function onSquare(sq) {
    if (!isMyTurn()) return;
    if (isCk()) { onCheckersSquare(sq); return; }
    const legal = S.game.legalMoves || {};
    if (S.sel && (legal[S.sel] || []).includes(sq)) {
      if (isPromotion(S.sel, sq)) { openPromo(S.sel, sq); return; }
      sendMove(S.sel, sq);
      return;
    }
    if (legal[sq]) { S.sel = S.sel === sq ? null : sq; A.haptic('select'); }
    else S.sel = null;
    $('chessPromo').hidden = true;
    S.pending = null;
    renderBoard();
  }

  function openPromo(from, to) {
    S.pending = { from, to };
    const white = S.game.yourColor === 'w';
    const row = $('chessPromoRow');
    row.replaceChildren(...['q', 'r', 'b', 'n'].map((p) => {
      const b = el('button');
      b.type = 'button';
      b.dataset.p = p;
      b.append(pieceNode(white ? p.toUpperCase() : p), el('span', null, t(p)));
      return b;
    }));
    $('chessPromo').hidden = false;
  }

  function failMessage(res) {
    const reason = reasonOf(res);
    if (reason === 'MUST_CAPTURE') return 'must_capture';
    if (['ILLEGAL_MOVE', 'PROMOTION_REQUIRED', 'BAD_PROMOTION', 'BAD_MOVE'].includes(reason)) return 'illegal';
    if (['MOVE_CONFLICT', 'NOT_YOUR_TURN', 'GAME_FINISHED'].includes(reason)) return 'synced';
    return 'err_generic';
  }

  /**
   * Yurish: taxtada DARHOL ko'rinadi (optimistik), keyin serverga ketadi. Tarmoq xatosi / 5xx da {MOVE_TRIES} marta qayta yuboriladi —
   * expectedMoveCount tufayli bir yurish ikki marta qo'llanmaydi (yetib borgan bo'lsa MOVE_CONFLICT keladi va holat jimgina yangilanadi).
   * Hammasi muvaffaqiyatsiz bo'lsa yurish taxtada saqlanadi va aloqa tiklanishi bilan avtomatik qayta yuboriladi.
   */
  function sendMove(from, to, promotion) {
    const g = S.game;
    if (!g || S.busy || S.out) return Promise.resolve();
    const body = { from, to, expectedMoveCount: g.moveCount };
    if (promotion) body.promotion = promotion;
    return submitMove(body, { from, to, promotion, map: applyOpt(parseFen(g.fen), from, to, promotion) }, { from, to });
  }

  /** Shashka yurishi: { path: [...kataklar], expectedMoveCount } — server bitta qonuniy yo'lni topadi. */
  function sendPath(path) {
    const g = S.game;
    if (!g || S.busy || S.out) return Promise.resolve();
    const D = CK();
    const map = D && D.optimistic ? D.optimistic(g, path) : null;
    return submitMove({ path, expectedMoveCount: g.moveCount }, { path, map }, { path });
  }

  /** Ikkala tur uchun umumiy: optimistik ko'rsatish, soat, yuborish (flushMove) va animatsiya. */
  function submitMove(body, opt, slide) {
    const g = S.game;
    S.sel = null;
    S.pending = null;
    $('chessPromo').hidden = true;
    S.opt = Object.assign({ base: g.moveCount }, opt);
    S.out = { id: g.id, body };
    S.shownCount = g.moveCount + 1;
    if (S.clock && g.mode === 'ONLINE') { // mening soatim darhol to'xtaydi, raqibniki yura boshlaydi
      S.clock = { w: clockMs('w'), b: clockMs('b'), run: g.yourColor === 'w' ? 'b' : 'w', at: Date.now() };
    }
    A.haptic('select', true);
    let cap = false;
    if (opt && opt.map && typeof opt.map === 'object') { // o'z yurishim: darhol ovoz (optimistik taxta bo'yicha urish aniqlanadi)
      const n = Object.keys(opt.map).length;
      cap = S.pcs != null && n < S.pcs;
      S.pcs = n;
    }
    playSnd(cap ? 'capture' : 'move');
    const sent = flushMove(); // S.busy sinxron o'rnatiladi (birinchi await gacha), shuning uchun render "yuborilmadi" demaydi
    renderGame();
    slideMove(slide);
    return sent;
  }

  async function flushMove() {
    const out = S.out;
    if (!out || S.busy) return;
    clearTimeout(S.outTimer);
    S.busy = true;
    setNet(false);
    let res = null;
    let tries = 0;
    for (; tries < MOVE_TRIES; tries += 1) {
      res = await api('POST', '/api/chess/games/' + out.id + '/move', out.body, { timeout: tries === 0 ? 10000 : 12000, retry: false });
      if (res.status !== 0 && res.status < 500) break; // server javob berdi
      if (tries < MOVE_TRIES - 1) await sleep(400 * (tries + 1));
    }
    S.busy = false;
    if (!S.game || S.game.id !== out.id) { S.out = null; S.opt = null; return; } // o'yin almashgan
    if (ok(res)) { setNet(false); applyGame(res.data.game); return; }

    if (res.status === 0 || res.status >= 500) {
      // Hozircha yetib bormadi: yurish taxtada qoladi, aloqa tiklanishi bilan qayta yuboriladi (idempotent)
      setNet(true);
      renderGame();
      S.outTimer = setTimeout(() => { flushMove().catch(() => {}); }, 2500);
      return;
    }
    if (res.status === 401 || res.status === 403) { S.out = null; S.opt = null; renderGame(); return; } // mine.js gate/obuna oynasini o'zi ko'rsatadi
    // Server rad etdi (409 / 422 / 400). Qayta urinishdan keyingi MOVE_CONFLICT — avvalgi urinish yetib borgan: jim yangilanadi
    S.out = null;
    S.opt = null;
    const key = failMessage(res);
    if (tries === 0 || key !== 'synced') A.toast(t(key), key === 'err_generic');
    renderGame();
    await reloadGame();
  }

  async function resign() {
    const g = S.game;
    if (!g || g.status !== 'ACTIVE' || S.busy) return;
    if (!(await A.confirmBox(t('resign_q')))) return;
    S.busy = true;
    renderGame();
    const res = await api('POST', '/api/chess/games/' + g.id + '/resign', {}, { timeout: 15000 });
    S.busy = false;
    if (ok(res)) { setNet(false); applyGame(res.data.game); return; }
    if (res.status === 0 || res.status >= 500) { setNet(true); renderGame(); return; }
    if (res.status === 401 || res.status === 403) { renderGame(); return; }
    A.toast(t(failMessage(res)), false);
    await reloadGame();
  }

  async function startBot() {
    if (S.starting) return;
    S.starting = true;
    renderStart();
    const res = await api('POST', '/api/chess/bot/start', { level: S.level, color: S.color, gameType: apiType() }, { timeout: 15000 });
    S.starting = false;
    renderStart();
    if (ok(res)) { A.haptic('light'); applyGame(res.data.game); return; }
    if (reasonOf(res) === 'ALREADY_ACTIVE') { await loadCurrent(false); return; } // boshqa qurilmada boshlangan o'yin tiklanadi
    if (res.status === 401 || res.status === 403) return;
    A.toast(t(res.status === 0 ? 'err_net' : 'err_generic'), true);
  }

  // ---------- Kirish nuqtalari ----------
  /** Home ochilganda mine.js go('home') shuni chaqiradi (va ilova ochilganda boot()). */
  function onShow() {
    const gated = A.state && A.state.gated;
    if (gated || S.loading || S.busy) return;
    if (S.panel === 'search') return; // qidiruv polling bilan davom etmoqda
    if (S.panel === 'game' && S.game && S.game.status === 'FINISHED') return; // natija ko'rsatilgan — foydalanuvchi o'zi yopadi
    if (S.panel === 'game' && S.game) {
      if (S.out) { flushMove().catch(() => {}); return; }
      loadCurrent(true).catch(() => {});
      return;
    }
    loadCurrent(false).catch(() => {});
  }

  function boot() {
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      const s = A.state;
      if (s.gated) { clearInterval(iv); return; }
      if (s.loaded || tries > 150) {
        clearInterval(iv);
        if (s.view === 'home') onShow();
      }
    }, 100);
  }

  function init() {
    if (!$('chessRoot')) return;
    applyTexts();
    renderStart();
    $('chessBoard').addEventListener('click', (e) => {
      const b = e.target.closest('.csq');
      if (b) onSquare(b.dataset.sq);
    });
    $('chessPromoRow').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b || !S.pending) return;
      const { from, to } = S.pending;
      sendMove(from, to, b.dataset.p);
    });
    $('chessPromo').addEventListener('click', (e) => {
      if (e.target === $('chessPromo')) { S.pending = null; $('chessPromo').hidden = true; }
    });
    $('chessGames').addEventListener('click', (e) => {
      const b = e.target.closest('.cchip');
      if (!b || b.disabled || S.panel !== 'start') return;
      A.haptic('select');
      setType(b.dataset.game);
      loadStats().then((okk) => { if (okk) renderStart(); }).catch(() => {});
    });
    $('chessLevels').addEventListener('click', (e) => {
      const b = e.target.closest('.cchip');
      if (!b) return;
      S.level = Number(b.dataset.level);
      A.haptic('select');
      renderStart();
    });
    $('chessColors').addEventListener('click', (e) => {
      const b = e.target.closest('.cchip');
      if (!b) return;
      S.color = b.dataset.color;
      A.haptic('select');
      renderStart();
    });
    $('chessStartBot').addEventListener('click', () => { startBot().catch(() => {}); });
    $('chessOnline').addEventListener('click', () => { startOnline().catch(() => {}); });
    $('chessSearchCancel').addEventListener('click', () => { A.haptic('light'); cancelSearch().catch(() => {}); });
    $('chessResign').addEventListener('click', () => { resign().catch(() => {}); });
    $('chessRetry').addEventListener('click', () => { A.haptic('light'); loadCurrent(false).catch(() => {}); });
    $('chessNetRetry').addEventListener('click', () => {
      A.haptic('light');
      if (S.out) flushMove().catch(() => {});
      else reloadGame().catch(() => {});
    });
    $('chessAgain').addEventListener('click', () => { showStart().catch(() => {}); });
    $('chessHome').addEventListener('click', () => { showStart().catch(() => {}); });

    window.addEventListener('adrush:langchange', () => {
      applyTexts();
      renderStart();
      if (S.game) renderGame();
      renderResultModal();
    });
    // Fonda long-poll / soat to'xtaydi (o'yin soati serverda davom etadi); qaytganda holat DARHOL serverdan olinadi
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        S.wId += 1;
        clearTimeout(S.qTimer);
        stopTick();
        return;
      }
      if (S.searching && !S.cancelling) { pollQueue().catch(() => {}); return; }
      if (S.panel === 'game' && S.game && S.game.status === 'ACTIVE') {
        if (S.game.mode === 'ONLINE') ensureTick();
        if (S.out) { flushMove().catch(() => {}); return; }
        if (!S.busy) reloadGame().catch(() => {}); // applyGame ichida long-poll qayta boshlanadi
      }
    });
    // Internet qaytdi: yuborilmagan yurish bo'lsa yuboriladi, bo'lmasa holat yangilanadi
    window.addEventListener('online', () => {
      if (document.hidden || S.panel !== 'game' || !S.game || S.game.status !== 'ACTIVE') return;
      if (S.out) flushMove().catch(() => {});
      else if (!S.busy) reloadGame().catch(() => {});
    });

    window.AdRushChess = { onShow };
    boot();
  }

  init();
})();