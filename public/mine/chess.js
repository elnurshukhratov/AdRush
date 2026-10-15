'use strict';

/**
 * AdRush — Home = shahmat (bot bilan o'yin). mine.js dan keyin yuklanadi va window.AdRush / window.AdRushI18n orqali ishlaydi
 * (history.js kabi alohida modul, o'z DICT lug'ati bilan). Shahmat kutubxonasi klientda YO'Q: yurish qonuniyligi, natija va olmos faqat serverda;
 * klient faqat server qaytargan fen / legalMoves ni ko'rsatadi va yurish (from, to, promotion) yuboradi.
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q).
 */
(function () {
  const A = window.AdRush;
  const I = window.AdRushI18n;
  if (!A || !I) return;

  const $ = (id) => document.getElementById(id);
  const { api, el } = A;

  const DICT = {
    uz: {
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
  const BOT_RETRY_MAX = 6;

  const S = {
    panel: 'loading', // loading | error | start | game
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
    botTries: 0,
    botTimer: 0,
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
    // onlayn: o'yin (polling + soat)
    gTimer: 0,
    gBusy: false,
    gFails: 0,
    clock: null, // { w, b, run, at } — serverdan kelgan qiymat + qabul qilingan vaqt (ko'rsatish uchun lokal sanoq)
    tick: 0,
    flagAt: 0,
  };
  const QUEUE = '/api/chess/online/queue';

  const ok = (r) => r.status >= 200 && r.status < 300 && r.data && r.data.success;
  const reasonOf = (r) => (r && r.data && r.data.reason) || '';

  // ---------- Umumiy ----------
  function applyTexts() {
    document.querySelectorAll('#view-home [data-ck]').forEach((n) => { n.textContent = t(n.dataset.ck); });
    $('chessErrText').textContent = t(S.errKey);
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
  }

  async function loadStats() {
    const res = await api('GET', '/api/chess/stats');
    if (!ok(res)) return false;
    S.stats = { wins: res.data.wins, losses: res.data.losses, draws: res.data.draws, diamonds: res.data.diamonds };
    return true;
  }

  async function showStart() {
    S.game = null;
    S.sel = null;
    S.pending = null;
    closeResult();
    clearTimeout(S.botTimer);
    clearTimeout(S.gTimer);
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
    S.game = g;
    S.sel = null;
    S.pending = null;
    $('chessPromo').hidden = true;
    stopSearch();
    clearTimeout(S.gTimer);
    S.gFails = 0;
    S.flagAt = 0;
    setConn(false);
    setClock(g);
    show('game');
    renderGame();
    if (g.status === 'FINISHED') {
      clearTimeout(S.botTimer);
      stopTick();
      A.refresh().catch(() => {}); // global balans: yuqori panel, Vazifalar, Profil
      A.haptic(g.yourDelta > 0 ? 'success' : g.yourDelta < 0 ? 'warning' : 'light');
      if (S.shownFor !== g.id) { S.shownFor = g.id; openResult(); }
      return;
    }
    ensureBotMove();
    if (g.mode === 'ONLINE') { ensureTick(); gameLoop(pollDelay()); }
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

  // ---------- Onlayn: o'yin pollingi ----------
  const isOnlineActive = () => Boolean(S.game && S.game.mode === 'ONLINE' && S.game.status === 'ACTIVE');

  /** Raqib navbatida ≈1 s, o'z navbatingda 3 s; aloqa uzilganda asta-sekin kamayadi (maks. 5 s). */
  function pollDelay() {
    if (S.gFails) return Math.min(5000, 1500 + S.gFails * 1000);
    return S.game && S.game.turn !== S.game.yourColor ? 1000 : 3000;
  }

  function gameLoop(delay) {
    clearTimeout(S.gTimer);
    S.gTimer = setTimeout(() => { pollGame().catch(() => {}); }, delay);
  }

  async function pollGame() {
    if (!isOnlineActive() || S.panel !== 'game' || document.hidden) return; // fonda to'xtaydi, visibilitychange davom ettiradi
    if (S.busy || S.loading || S.gBusy) { gameLoop(pollDelay()); return; }
    const cur = S.game;
    S.gBusy = true;
    const res = await api('GET', '/api/chess/games/' + cur.id);
    S.gBusy = false;
    if (!S.game || S.game.id !== cur.id) return; // o'yin almashgan
    if (S.busy) { gameLoop(pollDelay()); return; } // yurish ketayotgan paytdagi javob eskirgan
    if (!ok(res)) {
      if (reasonOf(res) === 'GAME_NOT_FOUND') { await showStart(); return; }
      S.gFails += 1;
      setConn(true);
      if (isOnlineActive()) gameLoop(pollDelay());
      return;
    }
    S.gFails = 0;
    setConn(false);
    setNet(false);
    const g = res.data.game;
    if (g.moveCount < S.game.moveCount) { gameLoop(pollDelay()); return; } // eskirgan javob
    if (g.moveCount !== S.game.moveCount || g.status !== S.game.status) { applyGame(g); return; } // raqib yurdi / o'yin tugadi
    setClock(g); // holat o'zgarmagan: faqat soat serverga moslanadi (tanlangan figura saqlanadi)
    tickClocks();
    gameLoop(pollDelay());
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
    queueLoop(2000);
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
    const res = await api('POST', QUEUE, {}, { timeout: 15000 });
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
      res = await api('POST', QUEUE, {}, { timeout: 15000 });
    }
    S.qBusy = false;
    if (!S.searching || S.cancelling) return;
    if (!ok(res)) {
      if (reasonOf(res) === 'ALREADY_ACTIVE') { stopSearch(); await loadCurrent(false); return; }
      S.qFails += 1;
      $('chessSearchConn').hidden = false;
      queueLoop(Math.min(6000, 2000 + S.qFails * 1000));
      return;
    }
    S.qFails = 0;
    $('chessSearchConn').hidden = true;
    if (!(await onQueueData(res.data))) { stopSearch(); await showStart(); return; }
    if (S.searching && !document.hidden) queueLoop(2000);
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
    if (!document.hidden) queueLoop(2000);
  }

  /** Botning navbatida qolgan bo'lsa (server o'zi tiklaydi) — qisqa pauza bilan holatni qayta so'raydi. */
  function ensureBotMove() {
    clearTimeout(S.botTimer);
    const g = S.game;
    if (!g || g.status !== 'ACTIVE' || g.mode !== 'BOT' || g.turn === g.yourColor) { S.botTries = 0; return; }
    if (S.botTries >= BOT_RETRY_MAX) { S.botTries = 0; setNet(true); return; }
    S.botTries += 1;
    S.botTimer = setTimeout(() => { reloadGame().catch(() => {}); }, 1500);
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
    const w = ch === ch.toUpperCase();
    return el('span', 'pc ' + (w ? 'w' : 'b') + (cls ? ' ' + cls : ''), PIECE[ch.toLowerCase()] + TEXT_VS);
  }

  const isMyTurn = () => {
    const g = S.game;
    return Boolean(g && g.status === 'ACTIVE' && g.turn === g.yourColor && !S.busy);
  };

  function renderBoard() {
    const g = S.game;
    const board = $('chessBoard');
    const map = parseFen(g.fen);
    const flip = g.yourColor === 'b';
    const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flip ? FILES.slice().reverse() : FILES;
    const targets = new Set(S.sel && g.legalMoves && g.legalMoves[S.sel] ? g.legalMoves[S.sel] : []);
    let kingSq = null;
    if (g.inCheck) {
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
        if (g.lastMove && (g.lastMove.from === sq || g.lastMove.to === sq)) b.classList.add('last');
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
    board.classList.toggle('wait', S.busy);
  }

  function playerBar(node, label, active, color) {
    node.classList.toggle('turn', active);
    const right = el('div', 'cbar-r');
    if (S.clock) {
      const c = el('b', 'cclock');
      c.dataset.c = color; // onlayn: soat; tickClocks to'ldiradi
      right.appendChild(c);
    } else {
      right.appendChild(el('i', null, active ? t(node.id === 'chessMe' ? 'turn_you' : 'turn_opp') : ''));
    }
    node.replaceChildren(el('span', null, label), right);
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
    playerBar($('chessOpp'), oppLabel, active && g.turn !== g.yourColor, oppColor);
    playerBar($('chessMe'), t('you'), active && g.turn === g.yourColor, g.yourColor);
    renderBoard();

    const st = $('chessStatus');
    st.className = 'chess-status';
    if (!active) { st.textContent = t('st_over'); }
    else if (g.turn !== g.yourColor || S.busy) { st.textContent = t(online ? 'st_wait' : 'st_think'); st.classList.add('think'); }
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
    return { kind, delta, d, reason: t('rs_' + g.endReason), note };
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

  function onSquare(sq) {
    if (!isMyTurn()) return;
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
    if (['ILLEGAL_MOVE', 'PROMOTION_REQUIRED', 'BAD_PROMOTION', 'BAD_MOVE'].includes(reason)) return 'illegal';
    if (['MOVE_CONFLICT', 'NOT_YOUR_TURN', 'GAME_FINISHED'].includes(reason)) return 'synced';
    return 'err_generic';
  }

  async function sendMove(from, to, promotion) {
    const g = S.game;
    S.busy = true;
    S.sel = null;
    S.pending = null;
    $('chessPromo').hidden = true;
    renderGame(); // "Bot o'ylayapti…" — taxta server javobi kelguncha o'zgarmaydi (optimistik emas)
    const body = { from, to, expectedMoveCount: g.moveCount };
    if (promotion) body.promotion = promotion;
    const res = await api('POST', '/api/chess/games/' + g.id + '/move', body, { timeout: 15000 });
    S.busy = false;
    if (ok(res)) { setNet(false); applyGame(res.data.game); return; }

    if (res.status === 0 || res.status >= 500) {
      // yurish yetib borgan-bormaganini bilmaymiz: qayta YUBORILMAYDI, holat qayta yuklanadi
      setNet(true);
      renderGame();
      return;
    }
    if (res.status === 401 || res.status === 403) { renderGame(); return; } // mine.js gate/obuna oynasini o'zi ko'rsatadi
    const key = failMessage(res);
    A.toast(t(key), key === 'err_generic');
    await reloadGame(); // 409 / noqonuniy yurish: holat qayta yuklanadi
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
    const res = await api('POST', '/api/chess/bot/start', { level: S.level, color: S.color }, { timeout: 15000 });
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
    if (S.panel === 'game' && S.game) { loadCurrent(true).catch(() => {}); return; }
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
    $('chessNetRetry').addEventListener('click', () => { A.haptic('light'); reloadGame().catch(() => {}); });
    $('chessAgain').addEventListener('click', () => { showStart().catch(() => {}); });
    $('chessHome').addEventListener('click', () => { showStart().catch(() => {}); });

    window.addEventListener('adrush:langchange', () => {
      applyTexts();
      renderStart();
      if (S.game) renderGame();
      renderResultModal();
    });
    // Ilovaga qaytganda (Home ochiq va o'yin faol bo'lsa) holat serverdan yangilanadi
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { // fonda polling to'xtaydi (o'yin soati serverda davom etadi)
        clearTimeout(S.gTimer);
        clearTimeout(S.qTimer);
        stopTick();
        return;
      }
      if (S.searching && !S.cancelling) { pollQueue().catch(() => {}); return; } // qaytganda darhol davom etadi
      if (S.panel === 'game' && isOnlineActive()) { ensureTick(); pollGame().catch(() => {}); return; }
      if (A.state.view === 'home' && S.panel === 'game' && S.game && S.game.status === 'ACTIVE' && !S.busy) reloadGame().catch(() => {});
    });

    window.AdRushChess = { onShow };
    boot();
  }

  init();
})();