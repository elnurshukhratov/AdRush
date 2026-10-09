'use strict';

/**
 * AdRush — Mine App UI (framework-siz). Barcha ma'lumot serverdan; klient hech narsani hisoblamaydi:
 * ball FAQAT backend tasdiqlagan reward orqali o'zgaradi (klientda views++ yo'q). Progress foizi, taymer va
 * animatsiyalar faqat ko'rsatish uchun. Identifikatsiya: Authorization: tma <initData>.
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q).
 */
(function () {
  let tg = window.Telegram && window.Telegram.WebApp;
  // initData ni hash (#tgWebAppData=...) dan qo'lda olish — SDK kech yuklansa yoki xato bersa zaxira yo'li
  function hashInitData() {
    try {
      const h = String(window.location.hash || '').replace(/^#/, '');
      const v = new URLSearchParams(h).get('tgWebAppData');
      return v || '';
    } catch (_e) { return ''; }
  }
  function getInitData() { return (tg && tg.initData) || hashInitData() || ''; }
  // SDK (telegram-web-app.js) ni va initData ni biroz kutadi (sekin tarmoq / kech yuklanish)
  function waitForTelegram(maxMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        tg = window.Telegram && window.Telegram.WebApp;
        if (getInitData() || Date.now() - t0 > maxMs) return resolve(!!getInitData());
        setTimeout(tick, 100);
      })();
    });
  }
  const $ = (id) => document.getElementById(id);
  const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
  // ---------- i18n ----------
  // Matnlar AdRushI18n lug'atida (public/mine/i18n.js). Statik HTML: data-i18n; dinamik: tt()/tx().
  const i18n = window.AdRushI18n || { t: (k) => k, has: () => false, apply() {}, setLang() { return false; }, lang: 'uz', locale: 'uz-UZ' };
  const tt = (k, v) => i18n.t(k, v);

  // Raqamlar tanlangan til locale'iga bog'langan; admin bo'limi (o'zbekcha) uchun alohida o'zgarmas en-US format (AdRush.nf).
  const nfCache = {};
  const nf = { format: (n) => (nfCache[i18n.locale] || (nfCache[i18n.locale] = new Intl.NumberFormat(i18n.locale))).format(n) };
  const nfFixed = new Intl.NumberFormat('en-US');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DATE_FMT = { dateStyle: 'medium', timeStyle: 'short' };

  /** Element matnini kalit bilan qo'yadi: til o'zgarsa AdRushI18n.apply() uni avtomatik qayta yozadi. */
  function tx(node, key, vars) {
    const raw = vars ? JSON.stringify(vars) : '';
    if (node.dataset.i18n === key && (node.dataset.i18nVars || '') === raw) return; // allaqachon shu matn
    node.dataset.i18n = key;
    if (raw) node.dataset.i18nVars = raw; else delete node.dataset.i18nVars;
    node.textContent = tt(key, vars);
  }
  /** Tarjimasiz (serverdan kelgan) matn: eski kalit bog'lanishi olib tashlanadi. */
  function plain(node, text) {
    delete node.dataset.i18n;
    delete node.dataset.i18nVars;
    if (node.textContent !== text) node.textContent = text;
  }
  /** Backend `reason` kodi -> lug'at kaliti (noma'lum kod bo'lsa fallback kalit). */
  const reasonKey = (reason, fallback) => (reason && i18n.has('reason.' + reason) ? 'reason.' + reason : fallback);

  const state = {
    view: 'home', refreshSec: 15, startAt: null, endAt: null, countTo: null, busy: false, busyLabel: '',
    coolUntil: 0, cooldownMs: 0, noAdUntil: 0, adControllers: {}, blockId: null, quickBlockId: null, pollId: null, ticks: 0,
    me: null, prizes: [], loaded: false, metaOk: false, boardOk: false, competition: null, isAdmin: false,
    histLoaded: 0, metaReloadAt: 0, backFn: null, gated: false, gateKind: null, subChannel: null, subBusy: false, prizesAnimated: false, lbSig: '', champs: [], selId: null,
    participants: 0, lbData: null, histList: [], coinItems: [], chOk: false,
    // Rush Coin: hammasi serverdan keladi (faqat ko'rsatish uchun saqlanadi)
    tgId: '', coins: 0, adReward: 5, referralReward: 20, lossPct: 30, minBet: 1, maxBet: 1000000, activeBets: 0, maxBets: 5,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tgTry = (fn) => { try { fn(); } catch (_e) { /* ixtiyoriy imkoniyat */ } };
  const atLeast = (v) => Boolean(tg && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(v));

  function haptic(kind) {
    const h = tg && tg.HapticFeedback;
    if (!h) return;
    tgTry(() => {
      if (kind === 'select') h.selectionChanged();
      else if (kind === 'light') h.impactOccurred('light');
      else h.notificationOccurred(kind); // success | warning | error
    });
  }

  // ---------- Tarmoq ----------
  function onAuthProblem(res) {
    if (res.status === 401) gate('open');
    else if (res.status === 403 && res.data && res.data.reason === 'USER_BLOCKED') gate('blocked');
    else if (res.status === 403 && res.data && res.data.reason === 'SUBSCRIPTION_REQUIRED') gate('subscribe', res.data.channel);
  }

  /**
   * Timeout (12s) bilan; faqat GET xato/5xx da bir marta qayta uriniladi (POST hech qachon qayta yuborilmaydi).
   * Tarmoq xatosida { status: 0, data: null } qaytadi.
   */
  async function api(method, path, body, opts = {}) {
    const { timeout = 12000, retry = method === 'GET' } = opts;
    for (let attempt = 0; ; attempt += 1) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await fetch(path, {
          method,
          headers: {
            Authorization: 'tma ' + getInitData(),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
        let data = null;
        try { data = await res.json(); } catch (_e) { /* 304 yoki bo'sh javob */ }
        if (retry && attempt === 0 && res.status >= 502) { await sleep(700); continue; }
        const out = { status: res.status, data };
        onAuthProblem(out);
        return out;
      } catch (_e) {
        if (retry && attempt === 0) { await sleep(700); continue; }
        return { status: 0, data: null };
      } finally {
        clearTimeout(timer);
      }
    }
  }
  const ok = (r) => r.status >= 200 && r.status < 300 && r.data && r.data.success;

  // ---------- DOM yordamchilari ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  /** Xabar kalit bilan beriladi (til o'zgarsa o'zi tarjima bo'ladi); kalit bo'sh bo'lsa tozalanadi. */
  let quickMode = false; // tepadagi tezkor tugma: xabarlar toast bilan ko'rsatiladi (#msg faqat Vazifalar sahifasida)
  function say(key, kind, vars) {
    if (quickMode) { if (key) toast(tt(key, vars), kind === 'bad'); return; }
    const m = $('msg');
    if (key) tx(m, key, vars); else plain(m, '');
    m.className = 'msg center' + (kind ? ' ' + kind : '');
  }
  let toastTimer = null;
  function toast(text, isErr) { // text — tayyor matn (admin.js ham shu yerdan foydalanadi)
    let t = document.getElementById('toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text;
    t.classList.toggle('err', Boolean(isErr));
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
    haptic(isErr ? 'error' : 'light');
  }
  function confirmBox(text) {
    return new Promise((resolve) => {
      if (tg && typeof tg.showConfirm === 'function') { try { tg.showConfirm(text, (v) => resolve(Boolean(v))); return; } catch (_e) { /* fallback */ } }
      resolve(window.confirm(text));
    });
  }
  /** i18n kalitli element (kalit lug'atda bo'lmasa — matnning o'zi ko'rinadi, shuning uchun admin.js ham ishlayveradi). */
  function ti(tag, cls, key) {
    const n = el(tag, cls);
    tx(n, key);
    return n;
  }
  /** Bo'sh / xato holat bloki (ikonka, sarlavha, matn, ixtiyoriy tugma). title/text/btnText — i18n kalitlari. */
  function stateNode(ico, title, text, btnText, onClick) {
    const n = el('div', 'state');
    n.append(el('div', 'state-ico', ico), ti('b', null, title));
    if (text) n.appendChild(ti('span', 'muted', text));
    if (btnText) {
      const b = ti('button', 'btn', btnText);
      b.type = 'button';
      b.addEventListener('click', onClick);
      n.appendChild(b);
    }
    return n;
  }
  function skeleton(n, cls) {
    const g = el('div', 'sk-group');
    for (let i = 0; i < n; i += 1) g.appendChild(el('div', 'sk sk-row' + (cls ? ' ' + cls : '')));
    return g;
  }
  function placeLabel(p) { return MEDALS[p] || p + '.'; }
  function who(r) { return r.username ? '@' + r.username : (r.firstName || tt('common.user')); }
  function prizeThumb(p, cls) {
    const box = el('div', 'thumb' + (cls ? ' ' + cls : ''));
    if (p.imageUrl && /^\/uploads\/prizes\//.test(p.imageUrl)) {
      const img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = p.imageUrl;
      img.onerror = () => box.replaceChildren(document.createTextNode(placeLabel(p.place)));
      box.appendChild(img);
    } else {
      box.textContent = placeLabel(p.place);
    }
    return box;
  }
  /** Raqam animatsiyasi (faqat ko'rsatish; qiymat doim serverdan keladi). */
  function setNum(node, value, bump) {
    const to = Number(value) || 0;
    const from = node.dataset.v === undefined ? NaN : Number(node.dataset.v);
    node.dataset.v = String(to);
    if (Number.isNaN(from) || from === to || reduceMotion) { node.textContent = nf.format(to); return; }
    const t0 = performance.now();
    const dur = 450;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      node.textContent = nf.format(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    if (bump && to > from) { node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); }
  }

  /** Balans ham kartada, ham doim ko'rinib turadigan yuqori panelda yangilanadi (qiymat faqat serverdan). */
  function setCoinBal(value, bump) {
    setNum($('coinBal'), value, bump);
    setNum($('topCoins'), value, false);
    setNum($('rushBal'), value, false);
    setNum($('sendBal'), value, false);
    const chip = $('topCoinChip');
    if (bump && chip && !reduceMotion) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
  }

  // ---------- Tema: Kun / Tun ----------
  // Ranglar CSS tokenlari bilan bir xil (mine.css). Telegram sarlavhasi va fon rangi temaga qarab yangilanadi.
  const THEME_COLORS = { dark: { bg: '#050914', bg2: '#08111F' }, light: { bg: '#E9F1FB', bg2: '#F3F8FE' } };
  const THEME_KEY = 'adrush-theme';
  const root = document.documentElement;
  const currentTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark');

  function savedTheme() {
    try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : null; } catch (_e) { return null; }
  }

  function syncBrowserChrome(t) {
    const c = THEME_COLORS[t] || THEME_COLORS.dark;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', c.bg2);
    if (!tg) return;
    if (atLeast('6.1')) {
      tgTry(() => tg.setHeaderColor(c.bg2));
      tgTry(() => tg.setBackgroundColor(c.bg));
    }
    if (atLeast('7.10')) tgTry(() => tg.setBottomBarColor(c.bg2));
  }

  function applyTheme(t) {
    root.dataset.theme = t === 'light' ? 'light' : 'dark';
    syncBrowserChrome(currentTheme());
  }

  /** Tugma turgan joydan doira shaklida yangi tema "ochiladi" (View Transitions); eski telefonlarda oddiy transition. */
  function toggleTheme() {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) { /* private rejim */ }
    haptic('select');
    const btn = $('themeBtn');
    if (!reduceMotion && typeof document.startViewTransition === 'function' && btn) {
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      try {
        const vt = document.startViewTransition(() => applyTheme(next));
        vt.ready.then(() => {
          root.animate(
            { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
            { duration: 550, easing: 'cubic-bezier(.22,.8,.25,1)', pseudoElement: '::view-transition-new(root)' }
          );
        }).catch(() => {});
        return;
      } catch (_e) { /* zaxira yo'lga o'tamiz */ }
    }
    root.classList.add('theme-anim');
    applyTheme(next);
    setTimeout(() => root.classList.remove('theme-anim'), 450);
  }

  function initTheme() {
    const btn = $('themeBtn');
    if (btn) btn.addEventListener('click', toggleTheme);
    syncBrowserChrome(currentTheme());
    // Foydalanuvchi o'zi tanlamagan bo'lsa, Telegram temasini kuzatamiz
    if (tg && typeof tg.onEvent === 'function') {
      tgTry(() => tg.onEvent('themeChanged', () => { if (!savedTheme()) applyTheme(tg.colorScheme === 'light' ? 'light' : 'dark'); }));
    }
  }

  // ---------- Effektlar: sahifa kirishi, uchqun, konfetti ----------
  /** Sahifa elementlari ketma-ket pastdan chiqadi (har biri 40 ms kechikish bilan). */
  function enterView(view) {
    const v = document.getElementById('view-' + view);
    if (!v || reduceMotion) return;
    if (view === 'leaderboard') playLbEnter();
    Array.from(v.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
    v.classList.remove('stag');
    void v.offsetWidth;
    v.classList.add('stag');
    clearTimeout(v._stagT);
    v._stagT = setTimeout(() => v.classList.remove('stag'), 900);
  }

  /** Reyting: podium pastdan ko'tariladi, qatorlar o'ngdan suriladi, "Mening qatorim" to'lqin bilan ajraladi. */
  function playLbEnter() {
    const v = $('view-leaderboard');
    if (!v || reduceMotion) return;
    v.classList.remove('lb-enter');
    void v.offsetWidth;
    v.classList.add('lb-enter');
    clearTimeout(v._lbT);
    v._lbT = setTimeout(() => v.classList.remove('lb-enter'), 1600);
  }

  /** Tugmadan 6-8 ta tanga/uchqun sachraydi. */
  function burstSparks() {
    if (reduceMotion) return;
    const wrap = document.querySelector('.cta-wrap');
    if (!wrap) return;
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i += 1) {
      const sp = el('i', 'spark');
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const d = 54 + Math.random() * 40;
      sp.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
      sp.style.setProperty('--dy', Math.round(Math.sin(a) * d - 14) + 'px');
      wrap.appendChild(sp);
      setTimeout(() => sp.remove(), 1000);
    }
  }

  /** Top 3 ga kirganda bir marta konfetti (1.5 s). */
  function confetti() {
    haptic('success');
    if (reduceMotion) return;
    const box = el('div', 'confetti');
    box.setAttribute('aria-hidden', 'true');
    const colors = ['#4B50E6', '#7A5CF6', '#C2417F', '#FF8C32', '#FFC83A', '#3DDC84'];
    for (let i = 0; i < 36; i += 1) {
      const c = document.createElement('i');
      c.style.left = Math.round(Math.random() * 100) + '%';
      c.style.setProperty('--c', colors[i % colors.length]);
      c.style.setProperty('--d', (Math.random() * 0.3).toFixed(2) + 's');
      c.style.setProperty('--x', Math.round(Math.random() * 240 - 120) + 'px');
      c.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }

  /** O'rin o'zgarishi: ▲ yashil yoki ▼ qizil belgi chiqib, 2 s dan keyin so'nadi. */
  let deltaTimer = null;
  function showRankDelta(prevRank, newRank) {
    if (prevRank === newRank || !newRank) return;
    const node = $('homeRankDelta');
    if (!node) return;
    let txt;
    let cls;
    if (prevRank) {
      const d = prevRank - newRank;
      cls = d > 0 ? 'up' : 'down';
      txt = (d > 0 ? '▲ ' : '▼ ') + Math.abs(d);
    } else {
      cls = 'up';
      txt = '▲';
    }
    node.textContent = txt;
    node.className = 'rdelta ' + cls;
    void node.offsetWidth;
    node.classList.add('show');
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => node.classList.remove('show'), 2000);
    if (newRank <= 3 && (!prevRank || prevRank > 3)) confetti();
  }

  function flashBar() {
    const f = $('homeBarFill');
    if (!f || reduceMotion) return;
    f.classList.remove('flash');
    void f.offsetWidth;
    f.classList.add('flash');
  }

  // ---------- Telegram muhiti ----------
  function tgSetup() {
    if (!tg) return;
    tgTry(() => tg.ready());
    tgTry(() => tg.expand());
    if (atLeast('7.7')) tgTry(() => tg.disableVerticalSwipes());
    syncBrowserChrome(currentTheme()); // aniq HEX (Telegram o'z ranglarini qo'ymasin)
    if (atLeast('6.1') && tg.BackButton) {
      tgTry(() => tg.BackButton.onClick(() => { if (state.backFn) state.backFn(); else go('home'); }));
    }
  }
  function applyBack() {
    if (!atLeast('6.1') || !tg.BackButton) return;
    tgTry(() => { if (state.view !== 'home' || state.backFn) tg.BackButton.show(); else tg.BackButton.hide(); });
  }
  /** Admin ichki sahifalari uchun: fn berilsa Telegram BackButton shu funksiyani chaqiradi. */
  function setBack(fn) { state.backFn = fn || null; applyBack(); }

  // ---------- Global holat (Telegram tashqarisida / bloklangan) ----------
  function gate(kind, channel) {
    if (kind === 'subscribe' && channel) state.subChannel = channel;
    if (state.gated) { if (kind === 'subscribe' && state.gateKind === 'subscribe') fillSubGate(); return; }
    state.gated = true;
    state.gateKind = kind;
    const blocked = kind === 'blocked';
    const sub = kind === 'subscribe';
    $('gateIco').textContent = blocked ? '🚫' : (sub ? '📢' : '📱');
    tx($('gateTitle'), blocked ? 'gate.blocked.title' : (sub ? 'gate.sub.title' : 'gate.open.title'));
    tx($('gateText'), blocked ? 'gate.blocked.text' : (sub ? 'gate.sub.text' : 'gate.open.text'));
    $('subBox').hidden = !sub;
    if (sub) fillSubGate();
    $('gate').hidden = false;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    $('nav').hidden = true;
    clearTimeout(state.pollId);
  }

  // ---------- Majburiy kanalga obuna ----------
  /** Kanal havolasi: inviteUrl, bo'lmasa @username bo'yicha t.me manzili. */
  function channelUrl(ch) {
    if (!ch) return '';
    return ch.inviteUrl || (ch.username ? 'https://t.me/' + ch.username : '');
  }

  /** Kanal kartasini to'ldiradi (matnlar faqat textContent orqali). */
  function fillSubGate() {
    const ch = state.subChannel;
    $('subCard').hidden = !ch;
    $('subOpen').disabled = !channelUrl(ch);
    if (!ch) return;
    $('subTitle').textContent = ch.title || (ch.username ? '@' + ch.username : '');
    $('subUser').textContent = ch.username ? '@' + ch.username : '';
  }

  /** Kanalni ochadi: openTelegramLink -> openLink -> window.open. */
  function openChannel() {
    const url = channelUrl(state.subChannel);
    if (!url) return;
    haptic('light');
    if (tg && typeof tg.openTelegramLink === 'function') {
      try { tg.openTelegramLink(url); return; } catch (_e) { /* openLink ga o'tamiz */ }
    }
    if (tg && typeof tg.openLink === 'function') {
      try { tg.openLink(url); return; } catch (_e) { /* window.open ga o'tamiz */ }
    }
    window.open(url, '_blank', 'noopener');
  }

  /** Obunani serverda tekshiradi (bir vaqtda bitta so'rov). Obuna bo'lsa — +Rush ko'rsatib, sahifani qayta yuklaydi. */
  async function checkSubscription() {
    if (state.subBusy || !state.gated || state.gateKind !== 'subscribe') return;
    state.subBusy = true;
    const btn = $('subCheck');
    const msg = $('subMsg');
    btn.disabled = true;
    btn.textContent = tt('gate.sub.check') + ' …';
    plain(msg, '');
    let reloading = false;
    try {
      const res = await api('POST', '/api/subscription/check');
      if (ok(res) && (res.data.subscribed || !res.data.required)) {
        reloading = true; // tugma qulf holatida qoladi, sahifa qayta yuklanadi
        if (res.data.rewarded && res.data.amount > 0) { toast(tt('gate.sub.reward', { n: res.data.amount })); haptic('success'); }
        await sleep(res.data.rewarded ? 1500 : 400);
        location.reload();
        return;
      }
      if (ok(res)) {
        tx(msg, 'gate.sub.not_yet');
        toast(tt('gate.sub.not_yet'), true);
      } else {
        const key = res.status === 0 ? 'gate.sub.error' : reasonKey(res.data && res.data.reason, 'gate.sub.error');
        tx(msg, key);
        toast(tt(key), true);
      }
    } finally {
      if (!reloading) {
        state.subBusy = false;
        btn.disabled = false;
        btn.textContent = tt('gate.sub.check');
      }
    }
  }

  function initSubGate() {
    $('subCard').addEventListener('click', openChannel);
    $('subOpen').addEventListener('click', openChannel);
    $('subCheck').addEventListener('click', () => { haptic('light'); checkSubscription().catch(() => {}); });
    // Ilova ochiq qolib, foydalanuvchi Telegram'da kanaldan qaytsa (visibilitychange kelmasa) — 'activated' hodisasi
    if (tg && atLeast('8.0') && typeof tg.onEvent === 'function') tgTry(() => tg.onEvent('activated', () => { checkSubscription().catch(() => {}); }));
  }

  // ---------- Navigatsiya ----------
  function syncNav() {
    const act = document.querySelector('.tab.active');
    const ind = $('navInd');
    if (!act || !ind) return;
    const nav = $('nav');
    const maxLeft = nav ? Math.max(0, nav.clientWidth - act.offsetWidth) : act.offsetLeft;
    const left = Math.min(Math.max(act.offsetLeft, 0), maxLeft); // navbar chegarasidan chiqmasin
    ind.style.width = act.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + left + 'px)';
  }

  // Indikatorni bosib turib surish: barmoq ostidagi tab yoritiladi, qo'yib yuborilganda o'sha tabga o'tadi.
  function initNavDrag() {
    const nav = $('nav'), ind = $('navInd');
    if (!nav || !ind) return;
    let drag = false, target = null;
    function tabs() { return Array.from(nav.querySelectorAll('.tab')); }
    function pick(x) {
      const list = tabs(); if (!list.length) return null;
      const r = nav.getBoundingClientRect();
      const first = list[0], last = list[list.length - 1];
      const min = first.offsetLeft + first.offsetWidth / 2, max = last.offsetLeft + last.offsetWidth / 2;
      const center = Math.min(Math.max(x - r.left, min), max);
      ind.style.transform = 'translateX(' + (center - ind.offsetWidth / 2) + 'px) scale(1.05)';
      let best = list[0], bd = Infinity;
      list.forEach((t) => { const d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - center); if (d < bd) { bd = d; best = t; } });
      list.forEach((t) => t.classList.toggle('drag-target', t === best));
      return best;
    }
    function end() {
      if (!drag) return;
      drag = false; ind.classList.remove('dragging');
      tabs().forEach((t) => t.classList.remove('drag-target'));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const dest = target && target.dataset.go;
      target = null;
      if (dest && dest !== state.view) go(dest); else syncNav();
    }
    function move(e) { target = pick(e.clientX); }
    ind.addEventListener('pointerdown', (e) => {
      e.preventDefault(); drag = true; ind.classList.add('dragging'); target = pick(e.clientX);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  function go(view) {
    if (state.gated) return;
    if (!document.getElementById('view-' + view)) return;
    if (view === 'admin' && !state.isAdmin) return; // UI himoyasi; haqiqiy tekshiruv serverda (403)
    const changed = state.view !== view;
    state.view = view;
    if (view !== 'admin') state.backFn = null;
    if (view === 'champ') state.backFn = () => go('rewards');
    if (view === 'send') state.backFn = () => go('profile'); // Tanga yuborish — Profilning ichki sahifasi
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    const tabView = view === 'champ' ? 'rewards' : view === 'send' ? 'profile' : view; // chempionat sahifasi "Chempionatlar", yuborish sahifasi "Profil" bo'limining ichki sahifasi
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.go === tabView;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    syncNav();
    applyBack();
    window.scrollTo(0, 0);
    if (changed) { haptic('light'); enterView(view); }
    if (view === 'tasks') updateWatchState();
    if (view === 'send') enterSend();
    if (view === 'profile') { loadReferrals().catch(() => {}); loadCoinHistory(false).catch(() => {}); }
    if (view === 'rewards') { if (champ.tab === 'history') loadChampHistory().catch(() => {}); }
    if (state.loaded && view !== 'admin') refresh().catch(() => {});
    if (view === 'admin' && window.AdRushAdmin) window.AdRushAdmin.onShow();
  }

  // ---------- Taymer / tugma holati ----------
  const pad = (n) => String(n).padStart(2, '0');
  function renderTimer() {
    if (!state.countTo) return;
    const left = Math.max(0, Math.floor((state.countTo - Date.now()) / 1000));
    setRoll($('cdD'), String(Math.floor(left / 86400)), false);
    setRoll($('cdH'), pad(Math.floor((left % 86400) / 3600)), false);
    setRoll($('cdM'), pad(Math.floor((left % 3600) / 60)), true);
    setRoll($('cdS'), pad(left % 60), true);
  }
  function setRoll(node, txt, anim) {
    if (node.textContent === txt) return;
    const first = node.textContent === '--';
    node.textContent = txt;
    if (anim && !first && !reduceMotion) { node.classList.remove('roll'); void node.offsetWidth; node.classList.add('roll'); }
  }

  // Boshlanmagan bo'lsa boshlanishigacha, aks holda tugashigacha sanaydi (faqat ko'rsatish; qaror serverda)
  function updateCountTarget() {
    const upcoming = state.startAt && Date.now() < state.startAt;
    state.countTo = upcoming ? state.startAt : state.endAt;
    tx($('cdCaption'), upcoming ? 'cd.until_start' : 'cd.until_end');
  }

  function isLive() {
    return Boolean(state.competition) && state.startAt <= Date.now() && Date.now() < state.endAt;
  }

  function updateWatchState() {
    const live = isLive();
    const cd = Math.max(0, Math.ceil((state.coolUntil - Date.now()) / 1000));
    const noAd = Math.max(0, Math.ceil((state.noAdUntil - Date.now()) / 1000)); // AdsGram reklama bermadi -> tugma vaqtincha o'chiq
    const btn = $('watch');
    btn.disabled = state.busy || !state.loaded || cd > 0 || noAd > 0; // reklama Rush Coin beradi: faol chempionat shart emas
    btn.classList.toggle('busy', state.busy);
    const qa = $('quickAd');
    if (qa) { qa.disabled = btn.disabled; qa.classList.toggle('busy', state.busy); }

    if (state.busy) tx($('watchLabel'), state.busyLabel || 'watch.loading');
    else if (!state.loaded) tx($('watchLabel'), 'watch.loading');
    else if (cd > 0) tx($('watchLabel'), 'watch.cooldown', { n: cd });
    else if (noAd > 0) tx($('watchLabel'), 'watch.no_ad', { n: noAd });
    else tx($('watchLabel'), 'watch.label', { n: state.adReward });
    $('livePill').hidden = !live;
    $('lbLive').hidden = !live;
    updateBetState();
  }

  /** AdsGram reklama bermasa (no fill / SDK yo'q) tugmalarni NO_AD_RETRY_MS ga o'chirib qo'yadi, keyin o'zi qayta yoqiladi. */
  const NO_AD_RETRY_MS = 60000;
  function markNoAd() {
    state.noAdUntil = Date.now() + NO_AD_RETRY_MS;
    updateWatchState();
  }

  function startCooldown(ms) {
    if (ms > 0) state.coolUntil = Date.now() + ms;
    updateWatchState();
  }

  // ---------- Render ----------
  function renderCompetition(c, participants) {
    state.competition = c || null;
    state.participants = participants || 0;
    $('heroSk').hidden = true;
    $('heroBody').hidden = false;
    const none = !c;
    $('noComp').hidden = !none;
    $('countdown').hidden = none;
    $('cdCaption').hidden = none;
    $('progressCard').hidden = none;
    $('joinRow').hidden = none;
    $('compDesc').hidden = none || !c.description;
    $('pComp').hidden = none;
    if (none) {
      tx($('period'), 'period.waiting');
      tx($('compTitle'), 'home.comp_default');
      $('lbPeriod').textContent = '';
      plain($('participants'), '');
      plain($('pCompEnds'), '');
      state.countTo = null; state.startAt = null; state.endAt = null;
      updateWatchState();
      return;
    }
    plain($('period'), c.title); // chempionat nomi admin kiritgan tilda qoladi
    plain($('compTitle'), c.title);
    $('compDesc').textContent = c.description || '';
    $('lbPeriod').textContent = c.title;
    $('pCompTitle').textContent = c.title;
    if (participants) tx($('participants'), 'home.participants', { n: nf.format(participants) }); else plain($('participants'), '');
    state.startAt = new Date(c.startAt).getTime();
    state.endAt = new Date(c.endAt).getTime();
    plain($('pCompEnds'), tt('profile.ends', { date: new Date(c.endAt).toLocaleString(i18n.locale, DATE_FMT) }));
    updateCountTarget();
    renderTimer();
    updateWatchState();
  }

  // ---------- Chempionatlar (bir vaqtda bir nechta faol) ----------
  // Faqat ko'rsatish: reyting, tikish va sovrin hisob-kitobi serverda; klient faqat qaysi chempionat tanlanganini yuboradi.
  function selectedChamp() { return state.champs.find((c) => c.id === state.selId) || null; }

  function champPrizeLine(c) {
    const p = c.firstPrize;
    if (!p) return tt('champs.prize_soon');
    return tt('champs.first_prize') + ': ' + p.title + (p.value ? ' • ' + p.value : '');
  }

  // Qolgan vaqt: "2 kun 3 soat" / "5 soat 12 daq" / "7 daq 30 s" (faqat ko'rsatish; qaror serverda)
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
    if (d > 0) return tt('dur.d', { n: d }) + ' ' + tt('dur.h', { n: h });
    if (h > 0) return tt('dur.h', { n: h }) + ' ' + tt('dur.m', { n: m });
    if (m > 0) return tt('dur.m', { n: m }) + ' ' + tt('dur.s', { n: r });
    return tt('dur.s', { n: r });
  }

  /** Karta ichidagi holat qatori: [Boshlanmagan | Davom etmoqda] + "Boshlanishiga / Tugashiga: ..." — har soniya yangilanadi. */
  function statusRow(c) {
    const row = el('div', 'cc-status');
    row.dataset.start = String(new Date(c.startAt).getTime());
    row.dataset.end = String(new Date(c.endAt).getTime());
    row.append(el('span', 'cc-badge'), el('span', 'cc-time'));
    paintStatus(row);
    return row;
  }

  function paintStatus(row) {
    const st = Number(row.dataset.start), en = Number(row.dataset.end), now = Date.now();
    const upcoming = now < st;
    const badge = row.firstChild, time = row.lastChild;
    badge.className = 'cc-badge ' + (upcoming ? 'upcoming' : 'live');
    tx(badge, upcoming ? 'champs.st_upcoming' : 'champs.st_live');
    plain(time, tt(upcoming ? 'champs.left_start' : 'champs.left_end', { t: fmtDur(((upcoming ? st : en) - now) / 1000) }));
  }

  function champCard(c, full) {
    const sel = c.id === state.selId;
    const upcoming = new Date(c.startAt).getTime() > Date.now();
    const card = el('div', 'card prize champ' + (sel ? ' sel' : ''));
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    const body = el('div', 'pbody');
    body.append(el('div', 'pt', c.title), el('div', 'ps', champPrizeLine(c)), statusRow(c));
    if (full) {
      const when = upcoming ? tt('champs.starts', { date: new Date(c.startAt).toLocaleString(i18n.locale, DATE_FMT) })
        : tt('champs.ends', { date: new Date(c.endAt).toLocaleString(i18n.locale, DATE_FMT) });
      body.appendChild(el('div', 'pm', when + (c.participants ? ' • ' + tt('home.participants', { n: nf.format(c.participants) }) : '')));
      if (c.description) body.appendChild(el('div', 'pd', c.description));
    }
    if (c.my && c.my.rank) body.appendChild(el('div', 'youtag', tt('champs.my', { rank: c.my.rank, n: nf.format(c.my.validAds) })));

    card.append(c.firstPrize ? prizeThumb(c.firstPrize, 'lg') : el('div', 'thumb lg', '🏆'), body, el('span', 'cc-go', '›'));

    // Kartani bosish: chempionat sahifasi ochiladi (tikish va tikkanlar shu yerda)
    const open = () => openChamp(c.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return card;
  }

  // ---------- Chempionat sahifasi: holat, taymer, tikish, tikkanlar ----------
  function openChamp(id) {
    if (state.gated || !state.champs.some((c) => c.id === id)) return;
    if (state.selId !== id) { haptic('select'); selectChamp(id); }
    go('champ');
    renderChampDetail();
  }

  function renderChampDetail() {
    const c = selectedChamp();
    if (!c || !$('chTitle')) return;
    plain($('chTitle'), c.title);
    const d = $('chDesc');
    d.textContent = c.description || '';
    d.hidden = !c.description;
    plain($('chPrize'), champPrizeLine(c) + (c.participants ? ' • ' + tt('home.participants', { n: nf.format(c.participants) }) : ''));
    const upcoming = new Date(c.startAt).getTime() > Date.now();
    plain($('chDates'), tt(upcoming ? 'champs.starts' : 'champs.ends', { date: new Date(upcoming ? c.startAt : c.endAt).toLocaleString(i18n.locale, DATE_FMT) }));
    $('chCount').textContent = nf.format(c.participants || 0);
    tickChampDetail();
  }

  function tickChampDetail() {
    const c = selectedChamp();
    if (!c || !$('chD')) return;
    const st = new Date(c.startAt).getTime(), en = new Date(c.endAt).getTime(), now = Date.now();
    const upcoming = now < st;
    const left = Math.max(0, Math.floor(((upcoming ? st : en) - now) / 1000));
    tx($('chCap'), upcoming ? 'cd.until_start' : 'cd.until_end');
    setRoll($('chD'), String(Math.floor(left / 86400)), false);
    setRoll($('chH'), pad(Math.floor((left % 86400) / 3600)), false);
    setRoll($('chM'), pad(Math.floor((left % 3600) / 60)), true);
    setRoll($('chS'), pad(left % 60), true);
    const badge = $('chBadge');
    badge.hidden = !upcoming;
    if (upcoming) { badge.className = 'cc-badge upcoming'; tx(badge, 'champs.st_upcoming'); }
    $('chLive').hidden = upcoming || now >= en;
  }

  function tickChamps() {
    document.querySelectorAll('.cc-status').forEach(paintStatus);
    if (state.view === 'champ') tickChampDetail();
  }

  /** Shu chempionatga tikkanlar: tartib — tikilgan Rush Coin miqdori (server hisoblaydi, klient faqat ko'rsatadi). */
  function renderChampBoard(list, me) {
    const box = $('chBoard');
    if (!box) return;
    state.chOk = true;
    box.replaceChildren();
    if (!list.length) {
      box.appendChild(stateNode('🏁', 'ch.empty', 'ch.empty_hint'));
    } else {
      const wrap = el('div');
      for (const r of list) {
        const row = el('div', 'row' + (r.isMe ? ' mine' : ''));
        row.append(
          el('span', 'rk', MEDALS[r.rank] || '#' + r.rank),
          el('span', 'name', who(r) + (r.isMe ? ' ' + tt('common.you_paren') : '')),
          el('span', 'val', '🪙 ' + nf.format(r.validAds)),
        );
        wrap.appendChild(row);
      }
      box.appendChild(wrap);
    }
    const meCard = $('chMe');
    if (me && me.rank && !list.some((r) => r.isMe)) {
      meCard.hidden = false;
      meCard.replaceChildren();
      const row = el('div', 'row mine');
      row.append(el('span', 'rk', '#' + nf.format(me.rank)), ti('span', 'name', 'common.you'), el('span', 'val', '🪙 ' + nf.format(me.validAds)));
      meCard.appendChild(row);
    } else {
      meCard.hidden = true;
    }
  }

  function renderChampBoardError() {
    if (state.chOk || !$('chBoard')) return;
    $('chBoard').replaceChildren(stateNode('📡', 'lb.fail', 'err.check_network', 'common.retry', () => {
      $('chBoard').replaceChildren(skeleton(3));
      refresh().catch(() => {});
    }));
  }

  function renderLbChamps() {
    const box = $('lbChamps');
    if (!box) return;
    box.replaceChildren();
    box.hidden = state.champs.length < 2;
    for (const c of state.champs) {
      const b = el('button', 'lbchip' + (c.id === state.selId ? ' on' : ''), c.title);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', c.id === state.selId ? 'true' : 'false');
      b.addEventListener('click', () => { if (c.id !== state.selId) { haptic('select'); selectChamp(c.id); } });
      box.appendChild(b);
    }
  }

  function renderChamps() {
    const animate = !state.prizesAnimated;
    state.prizesAnimated = true;
    const home = $('homeChamps');
    const box = $('champList');
    home.replaceChildren();
    box.replaceChildren();

    if (!state.champs.length) {
      home.appendChild(stateNode('🏆', 'champs.none'));
      const c = el('div', 'card');
      c.appendChild(stateNode('🏆', 'champs.none', 'champs.none_hint'));
      box.appendChild(c);
      renderLbChamps();
      return;
    }
    const hw = el('div', animate ? 'stagger' : '');
    const bw = el('div', animate ? 'stagger' : '');
    for (const c of state.champs) { hw.appendChild(champCard(c, false)); bw.appendChild(champCard(c, true)); }
    home.appendChild(hw);
    box.appendChild(bw);
    renderLbChamps();
  }

  /** Server ro'yxatini qabul qiladi; tanlangan chempionat tugagan/yo'qolgan bo'lsa birinchisiga o'tadi. */
  function applyChamps(list) {
    const prevSel = state.selId;
    state.champs = Array.isArray(list) ? list : [];
    if (!state.champs.some((c) => c.id === state.selId)) state.selId = state.champs.length ? state.champs[0].id : null;
    const c = selectedChamp();
    renderCompetition(c, c ? c.participants : 0);
    renderChamps();
    // Ko'rilayotgan chempionat tugab ketgan bo'lsa (tanlov boshqasiga o'tdi) ro'yxatga qaytamiz
    if (state.view === 'champ' && (!state.champs.length || state.selId !== prevSel)) { go('rewards'); return; }
    renderChampDetail();
  }

  /** Foydalanuvchi boshqa chempionatni tanladi: hero, reyting, o'z natijam va tikish shu chempionatga o'tadi. */
  function selectChamp(id) {
    if (state.selId === id || !state.champs.some((c) => c.id === id)) return;
    state.selId = id;
    state.me = null; // o'rin o'zgarishi animatsiyasi boshqa chempionat bilan solishtirilmasin
    state.lbSig = '';
    state.boardOk = false;
    state.activeBets = 0;
    state.chOk = false;
    if ($('chBoard')) { $('chBoard').replaceChildren(skeleton(3)); $('chMe').hidden = true; }
    const c = selectedChamp();
    renderCompetition(c, c ? c.participants : 0);
    renderChamps();
    renderChampDetail();
    updateBetState();
    refresh().catch(() => {});
  }

  async function loadHistory() {
    if (Date.now() - state.histLoaded < 30000) return;
    const res = await api('GET', '/api/competition/history?limit=5');
    if (!ok(res)) return;
    state.histLoaded = Date.now();
    state.histList = res.data.competitions.filter((c) => c.winners.length);
    renderHistory();
  }

  function renderHistory() {
    const box = $('history');
    if (!box) return; // takroriy blok olib tashlangan: to'liq tarix "Tarix" tabida
    box.replaceChildren();
    const list = state.histList;
    if ($('histHead')) $('histHead').hidden = !list.length;
    for (const c of list) {
      const card = el('div', 'card hist');
      card.appendChild(el('div', 'hist-title', c.title));
      for (const w of c.winners) {
        const row = el('div', 'row');
        row.append(el('span', 'rk', placeLabel(w.place)), el('span', 'name', who(w)), el('span', 'val', w.prize));
        card.appendChild(row);
      }
      box.appendChild(card);
    }
  }

  function crownNode() {
    const NS = 'http://www.w3.org/2000/svg';
    const box = el('div', 'crown');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M3 17 2 6l5.5 4.5L12 3l4.5 7.5L22 6l-1 11Z');
    svg.appendChild(path);
    box.appendChild(svg);
    return box;
  }

  function podiumSlot(r, place) {
    const s = el('div', 'pod p' + place + (r && r.isMe ? ' mine' : '') + (r ? '' : ' empty'));
    if (place === 1 && r) s.appendChild(crownNode());
    s.append(el('div', 'medal', MEDALS[place]), el('div', 'pn', r ? who(r) + (r.isMe ? ' ' + tt('common.you_paren') : '') : '—'), el('div', 'pa', r ? nf.format(r.validAds) : ''));
    return s;
  }

  function renderBoard(list, me, hasCompetition) {
    state.lbData = { list, me, hasCompetition };
    // Ma'lumot o'zgarmagan bo'lsa DOM qayta chizilmaydi (har 15 s da animatsiya takrorlanmasin)
    const sig = JSON.stringify([list, me && me.rank, me && me.validAds, hasCompetition]);
    if (state.boardOk && sig === state.lbSig) return;
    state.lbSig = sig;
    const firstShow = !state.boardOk;
    state.boardOk = true;
    const box = $('board');
    const pod = $('podium');
    box.replaceChildren();
    pod.replaceChildren();

    if (!list.length) {
      pod.hidden = true;
      box.hidden = false;
      box.appendChild(hasCompetition
        ? stateNode('🏁', 'lb.empty', 'lb.empty_hint', 'lb.bet_btn', () => go('home'))
        : stateNode('⏳', 'home.no_comp', 'lb.nocomp_hint'));
    } else {
      pod.hidden = false;
      for (const place of [2, 1, 3]) pod.appendChild(podiumSlot(list.find((r) => r.rank === place), place));
      const rest = list.filter((r) => r.rank > 3);
      box.hidden = rest.length === 0;
      const wrap = el('div');
      rest.forEach((r, i) => {
        const row = el('div', 'row rr' + (r.isMe ? ' mine' : ''));
        if (i < 10) row.style.setProperty('--ri', String(i)); // faqat birinchi 10 ta qator ketma-ket chiqadi
        row.append(el('span', 'rk', '#' + r.rank), el('span', 'name', who(r) + (r.isMe ? ' ' + tt('common.you_paren') : '')), el('span', 'val', nf.format(r.validAds)));
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    }

    // Foydalanuvchi TOP ro'yxatida bo'lmasa, o'z o'rni alohida (yopishqoq) kartada
    const meCard = $('lbMe');
    if (me && me.rank && !list.some((r) => r.isMe)) {
      const wasHidden = meCard.hidden;
      meCard.hidden = false;
      meCard.replaceChildren();
      const row = el('div', 'row mine');
      const rk = el('span', 'rk', '#' + nf.format(me.rank));
      if (!wasHidden && state.meRank && state.meRank !== me.rank && !reduceMotion) rk.classList.add('roll'); // o'rin o'zgarsa raqam aylanadi
      state.meRank = me.rank;
      row.append(rk, ti('span', 'name', 'common.you'), el('span', 'val', nf.format(me.validAds)));
      meCard.appendChild(row);
      if (wasHidden && !reduceMotion) { meCard.classList.remove('in'); void meCard.offsetWidth; meCard.classList.add('in'); }
    } else {
      meCard.hidden = true;
      meCard.classList.remove('in');
      state.meRank = null;
    }

    if (firstShow && state.view === 'leaderboard') playLbEnter();
  }

  function renderBoardError() {
    if (state.boardOk) return; // eski ro'yxat ko'rinib tursin
    $('podium').hidden = true;
    const box = $('board');
    box.hidden = false;
    box.replaceChildren(stateNode('📡', 'lb.fail', 'err.check_network', 'common.retry', () => {
      state.lbSig = '';
      state.boardOk = false;
      box.replaceChildren(skeleton(5));
      refresh().catch(() => {});
    }));
  }

  function renderMe(me) {
    const prev = state.me;
    const first = !prev;
    state.me = me;

    // Rush Coin: balans va statistika faqat serverdan (frontend o'zi o'zgartirmaydi)
    if (Number.isInteger(me.rushCoins)) {
      state.coins = me.rushCoins;
      setCoinBal(me.rushCoins, !first);
      setNum($('pCoins'), me.rushCoins, false);
    }
    if (Number.isInteger(me.adReward)) { state.adReward = me.adReward; $('plusOne').textContent = '+' + me.adReward; }
    if (Number.isInteger(me.adsWatched)) setNum($('pAdsWatched'), me.adsWatched, false);
    if (Number.isInteger(me.activeBets)) state.activeBets = me.activeBets;
    if (Number.isInteger(me.maxActiveBets)) state.maxBets = me.maxActiveBets;
    renderCoinHint();
    updateBetState();
    const rank = me.rank ? '#' + nf.format(me.rank) : '—';

    $('homeRank').textContent = rank;
    setNum($('homeAds'), me.validAds, !first);
    if (me.rank === 1) tx($('homeNext'), 'rank.first');
    else if (me.adsToNextRank) tx($('homeNext'), 'rank.next', { n: nf.format(me.adsToNextRank) });
    else tx($('homeNext'), 'home.join_hint');
    $('pRank').textContent = rank;
    setNum($('pAds'), me.validAds, false);
    if (me.rank === 1) tx($('pNext'), 'rank.first_short');
    else plain($('pNext'), me.adsToNextRank ? `${nf.format(me.adsToNextRank)} Rush Coin` : '—');

    // Faqat ko'rsatish uchun: keyingi o'ringa qancha yaqinligi (hisob-kitob serverda)
    let pct = 0;
    if (me.rank === 1) pct = 100;
    else if (me.adsToNextRank) pct = Math.round((me.validAds / (me.validAds + me.adsToNextRank)) * 100);
    $('homeBarFill').style.width = pct + '%';
    $('pBarFill').style.width = pct + '%';
    $('homeBar').setAttribute('aria-valuenow', String(pct));

    if (!first) {
      if (me.validAds > prev.validAds) flashBar();
      showRankDelta(prev.rank, me.rank);
    }

    // Kartadagi "mening o'rnim" yangilansin (faqat o'zgargan bo'lsa qayta chizamiz)
    const sc = selectedChamp();
    if (sc && (!sc.my || sc.my.rank !== me.rank || sc.my.validAds !== me.validAds)) {
      sc.my = { validAds: me.validAds, rank: me.rank };
      renderChamps();
    }
  }

  function renderProfile() {
    renderMyId();
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; // faqat ko'rsatish uchun; identifikatsiya serverda
    if (!u) return;
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
    if (full) plain($('pName'), full); else tx($('pName'), 'common.user');
    $('pUser').textContent = u.username ? '@' + u.username : '';
    const av = $('avatar');
    if (u.photo_url && /^https:\/\//i.test(u.photo_url)) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = u.photo_url;
      img.onerror = () => av.replaceChildren(document.createTextNode((u.first_name || '?').slice(0, 1).toUpperCase()));
      av.replaceChildren(img);
    } else {
      av.textContent = (u.first_name || '?').slice(0, 1).toUpperCase();
    }
  }

  // ---------- Ma'lumot yuklash ----------
  function showHomeError(res) {
    const reason = res && res.data && res.data.reason;
    tx($('homeErrorText'), reason ? reasonKey(reason, 'err.generic') : 'err.check_network');
    $('homeError').hidden = false;
  }

  async function loadMeta() {
    state.metaReloadAt = Date.now();
    const res = await api('GET', '/api/competition/current');
    if (!ok(res)) {
      if (!state.metaOk && !state.gated) {
        $('heroSk').hidden = true;
        $('heroBody').hidden = true;
        $('heroCard').hidden = true;
        $('progressCard').hidden = true;
        showHomeError(res);
        $('homeChamps').replaceChildren(stateNode('📡', 'prizes.load_fail'));
        $('champList').replaceChildren(stateNode('📡', 'prizes.load_fail', 'err.check_network', 'common.retry', retryAll));
      }
      return false;
    }
    state.metaOk = true;
    $('homeError').hidden = true;
    $('heroCard').hidden = false;
    const d = res.data;
    applyChamps(d.championships || []);
    state.blockId = d.adsgram && d.adsgram.blockId;
    state.quickBlockId = (d.adsgram && d.adsgram.quickBlockId) || null;
    if (d.ads && d.ads.cooldownMs) state.cooldownMs = d.ads.cooldownMs;
    if (d.rush) {
      state.adReward = d.rush.adReward || state.adReward;
      state.referralReward = d.rush.referralReward || state.referralReward;
      state.lossPct = Number.isInteger(d.rush.lossRefundPercent) ? d.rush.lossRefundPercent : state.lossPct;
      state.minBet = d.rush.minBet || state.minBet;
      state.maxBet = d.rush.maxBet || state.maxBet;
      state.maxBets = d.rush.maxActiveBets || state.maxBets;
      $('plusOne').textContent = '+' + state.adReward;
      renderCoinHint();
    }
    updateBetState();
    return true;
  }

  async function refresh() {
    const cid = state.selId ? '&competitionId=' + state.selId : '';
    const [lb, st] = await Promise.all([api('GET', '/api/leaderboard/current?limit=50' + cid), api('GET', '/api/users/me/stats' + (cid ? '?' + cid.slice(1) : ''))]);
    // Javob kelguncha foydalanuvchi boshqa chempionatni tanlagan bo'lishi mumkin: eski natija yangisini bosib ketmasin
    if (state.selId && ((ok(lb) && lb.data.competition && lb.data.competition.id !== state.selId) || (ok(st) && st.data.competition && st.data.competition.id !== state.selId))) return false;
    if (ok(lb)) {
      renderBoard(lb.data.leaderboard, lb.data.me, Boolean(lb.data.competition));
      renderChampBoard(lb.data.leaderboard, lb.data.me);
      state.refreshSec = lb.data.refreshAfterSec || state.refreshSec;
    } else if (!state.gated) {
      renderBoardError();
      renderChampBoardError();
    }
    if (ok(st)) renderMe(st.data);
    return ok(lb) && ok(st);
  }

  async function retryAll() {
    $('homeError').hidden = true;
    $('heroCard').hidden = false;
    $('heroSk').hidden = false;
    $('heroBody').hidden = true;
    haptic('light');
    await Promise.all([loadMeta(), refresh()]);
    state.loaded = true;
    updateWatchState();
    if (!state.pollId) schedule();
  }

  // ---------- Reklama oqimi ----------
  // Server tasdig'i (AdsGram Reward URL) kutilayotgan bo'lsa sessiya holatini so'rab turadi
  async function waitConfirmation(sessionId) {
    for (let i = 0; i < 12; i += 1) {
      await sleep(2500);
      const { data } = await api('GET', '/api/ads/session/' + encodeURIComponent(sessionId));
      if (data && data.status === 'REWARDED') return true;
      if (data && (data.status === 'EXPIRED' || data.status === 'REJECTED')) return false;
    }
    return false;
  }

  function setBusy(on, label) {
    state.busy = on;
    state.busyLabel = label || '';
    updateWatchState();
  }

  /** Xato javobi -> lug'at kaliti (tarjima frontendda kod bo'yicha qilinadi). */
  function failKey(res) {
    if (res.status === 0) return 'err.network';
    const reason = res.data && res.data.reason;
    if (reason === 'COOLDOWN') startCooldown((res.data && res.data.retryAfterMs) || state.cooldownMs);
    return reasonKey(reason, 'reason.SESSION_REJECTED');
  }

  /** Server reklamani hisoblagandan keyin: animatsiya + haptic. Coin va balans serverdan kelgan javobdan olinadi. */
  function celebrate(data) {
    const coins = (data && Number.isInteger(data.coins) && data.coins) || state.adReward;
    say('watch.credited', 'good', { n: coins });
    coinHist.loadedAt = 0;
    $('plusOne').textContent = '+' + coins;
    haptic('success');
    const btn = $('watch');
    btn.classList.add('ok');
    setTimeout(() => btn.classList.remove('ok'), 1400);
    const plus = $('plusOne');
    plus.classList.remove('go');
    void plus.offsetWidth;
    plus.classList.add('go');
    burstSparks();
    if (data && Number.isInteger(data.rushCoins)) { state.coins = data.rushCoins; setCoinBal(data.rushCoins, true); }
    if (state.cooldownMs) startCooldown(state.cooldownMs);
  }

  /** AdsGram SDK (defer) tayyor bo'lguncha kutadi; ms ichida chiqmasa null. */
  async function waitAdsgram(ms) {
    const t0 = Date.now();
    while (!window.Adsgram && Date.now() - t0 < ms) await sleep(100);
    return window.Adsgram || null;
  }

  async function watchAd(quick) {
    if (state.busy || state.gated) return;
    quickMode = quick === true;
    setBusy(true, 'watch.preparing');
    say('');
    haptic('light');
    if (atLeast('6.2')) tgTry(() => tg.enableClosingConfirmation());
    try {
      const s = await api('POST', '/api/ads/session', undefined, { retry: false });
      if (!ok(s)) { say(failKey(s), 'bad'); haptic('error'); return; }

      const cfg = s.data.adsgram || {};
      const mainId = cfg.blockId || state.blockId;
      const blockId = quickMode ? (cfg.quickBlockId || state.quickBlockId || mainId) : mainId;
      // sad.min.js "defer" bilan yuklanadi — sekin tarmoqda hali tayyor bo'lmasligi mumkin, biroz kutamiz
      const sdk = await waitAdsgram(4000);
      if (!blockId || !sdk) { say('watch.unavailable', 'bad'); markNoAd(); return; }
      const bk = String(blockId);

      // Har ko'rsatishda YANGI controller: xatodan/yopilgandan keyin eski controller buzuq holatda qolib,
      // keyingi reklamani darhol yopib yuborishi mumkin edi.
      let ctrl;
      try { ctrl = sdk.init({ blockId: bk }); } catch (e) { console.warn('[AdsGram] init xatosi:', e); say('watch.unavailable', 'bad'); markNoAd(); return; }

      setBusy(true, 'watch.showing');
      let result;
      try {
        result = await ctrl.show();
      } catch (e) {
        result = e; // AdsGram xatoda ham result obyektini reject qiladi
      }
      if (!result || !result.done) {
        try { if (ctrl && typeof ctrl.destroy === 'function') ctrl.destroy(); } catch (_e) { /* allaqachon yopilgan */ }
        console.warn('[AdsGram] reklama tugallanmadi:', result);
        if (result && result.error === true) {
          // Haqiqiy AdsGram xatosi (reklama topilmadi / yuklanmadi / ko'rsatilmadi) — sababini ekranda ko'rsatamiz
          const why = [result.state, result.description].filter(Boolean).join(': ').slice(0, 140) || 'unknown';
          say('watch.ad_error', 'bad', { d: why });
          markNoAd(); // reklama yo'q/yuklanmadi -> tugma bosilmaydigan bo'ladi
        } else {
          // foydalanuvchi o'zi yopdi / o'tkazib yubordi YOKI AdsGram reklamani o'zi yopdi: sababini (state/description) ko'rsatamiz
          const why = result ? [result.state, result.description].filter(Boolean).join(': ').slice(0, 140) : '';
          if (why) say('watch.not_finished_d', 'bad', { d: why }); else say('watch.not_finished', 'bad');
        }
        haptic('warning');
        return;
      }

      // Klient faqat "ko'rdim" deydi — hisoblash qarori serverda (validatsiya + tranzaksiya)
      setBusy(true, 'watch.checking');
      const r = await api('POST', '/api/ads/reward', { sessionId: s.data.sessionId }, { retry: false });
      if (ok(r)) {
        if (r.data.status === 'PENDING_CONFIRMATION') {
          setBusy(true, 'watch.confirming');
          say('watch.wait_confirm');
          if (await waitConfirmation(s.data.sessionId)) celebrate(null);
          else { say('watch.no_confirm', 'bad'); haptic('warning'); }
        } else if (r.data.counted === false) {
          say('reason.DUPLICATE_REWARD', 'bad');
        } else {
          celebrate(r.data);
        }
      } else {
        say(failKey(r), 'bad');
        haptic('error');
      }
      await refresh();
    } catch (_e) {
      say('err.unexpected', 'bad');
    } finally {
      if (atLeast('6.2')) tgTry(() => tg.disableClosingConfirmation());
      setBusy(false);
      quickMode = false;
    }
  }


  // ---------- Sovrinlar: Joriy / Tarix tablari ----------
  // Tarix ma'lumoti to'liq serverdan (/api/competition/history): g'olib, reklama soni, sovrin, topshirilganlik va proof rasm.
  const PROOF_URL_RE = /^\/uploads\/proofs\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
  const champ = { tab: 'current', loadedAt: 0, loading: false, list: [] };

  function whoName(w) { return w.username ? '@' + w.username : (w.firstName || tt('championship.unknown_user')); }

  function monthLabel(c, upper) {
    let s = c.title;
    if (Number.isInteger(c.year) && Number.isInteger(c.month)) {
      try {
        s = new Intl.DateTimeFormat(i18n.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(c.year, c.month - 1, 1)));
      } catch (_e) { s = c.title; }
    }
    return upper ? s.toLocaleUpperCase(i18n.locale) : s.charAt(0).toLocaleUpperCase(i18n.locale) + s.slice(1);
  }

  function syncChampInd() {
    const on = champ.tab === 'history';
    $('champInd').style.transform = on ? 'translateX(100%)' : 'translateX(0)';
    document.querySelectorAll('.ctab').forEach((b) => {
      const active = b.dataset.ctab === champ.tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setChampTab(tab) {
    if (tab === champ.tab) return;
    champ.tab = tab;
    syncChampInd();
    for (const [name, pane] of [['current', $('ctab-current')], ['history', $('ctab-history')]]) {
      pane.hidden = name !== tab;
      if (name === tab) { pane.classList.remove('ctab-in'); void pane.offsetWidth; pane.classList.add('ctab-in'); }
    }
    haptic('select');
    if (tab === 'history') loadChampHistory().catch(() => {});
  }

  function openProofLightbox(src) {
    const bg = el('div', 'lightbox');
    const img = document.createElement('img');
    img.alt = tt('championship.proof_alt');
    img.src = src;
    bg.appendChild(img);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
  }

  function proofBlock(w) {
    const box = el('div', 'proof');
    if (w.proofImage && PROOF_URL_RE.test(w.proofImage)) {
      box.appendChild(el('div', 'proof-cap', tt('championship.proof')));
      const btn = el('button', 'proof-img');
      btn.type = 'button';
      const img = document.createElement('img');
      img.alt = tt('championship.proof_alt'); img.loading = 'lazy'; img.decoding = 'async'; img.src = w.proofImage;
      btn.appendChild(img);
      btn.addEventListener('click', () => openProofLightbox(w.proofImage));
      box.appendChild(btn);
    } else {
      box.appendChild(el('div', 'proof-pending', '⏳ ' + tt('championship.proof_pending')));
    }
    return box;
  }

  function winnerBlock(w) {
    const b = el('div', 'wblock');
    b.appendChild(el('div', 'wplace', `${MEDALS[w.place] || ''} ${tt('championship.place', { n: w.place })}`.trim()));
    const rows = el('div', 'wrows');
    for (const [k, v] of [['championship.winner', whoName(w)], ['championship.ad_views', nf.format(w.validAds)], ['championship.prize', w.prize]]) {
      const r = el('div', 'wrow');
      r.append(el('span', 'wk', tt(k)), el('b', 'wv', v));
      rows.appendChild(r);
    }
    b.appendChild(rows);
    if (w.delivered) b.appendChild(el('div', 'delivered', tt('championship.delivered')));
    b.appendChild(proofBlock(w));
    return b;
  }

  function openChampSheet(c) {
    const bg = el('div', 'sheet-bg');
    const sheet = el('div', 'sheet csheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const head = el('div', 'csheet-head');
    head.append(el('h3', null, tt('championship.title_of', { month: monthLabel(c, true) })));
    const x = el('button', 'csheet-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', tt('championship.close'));
    head.appendChild(x);
    sheet.appendChild(head);
    if (!c.winners.length) sheet.appendChild(el('p', 'muted center', tt('championship.no_winners')));
    for (const w of c.winners) sheet.appendChild(winnerBlock(w));
    bg.appendChild(sheet);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    x.addEventListener('click', close);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    haptic('light');
  }

  function historyCard(c) {
    const card = el('button', 'hcard');
    card.type = 'button';
    card.append(el('div', 'hc-month', '📅 ' + monthLabel(c)), el('div', 'hc-status', tt('championship.finished')));
    const list = el('div', 'hc-winners');
    for (const w of c.winners.slice(0, 3)) {
      const r = el('div', 'hc-row');
      r.append(el('span', 'hc-medal', MEDALS[w.place] || w.place + '.'), el('span', 'hc-name', whoName(w)));
      list.appendChild(r);
    }
    if (!c.winners.length) list.appendChild(el('div', 'muted', tt('championship.no_winners')));
    card.append(list, el('span', 'hc-go', '›'));
    card.addEventListener('click', () => openChampSheet(c));
    return card;
  }

  function renderChampHistory() {
    const box = $('champHistory');
    box.replaceChildren();
    if (!champ.list.length) {
      box.appendChild(stateNode('📜', 'championship.empty', 'championship.empty_hint'));
      return;
    }
    const wrap = el('div', 'stagger');
    for (const c of champ.list) wrap.appendChild(historyCard(c));
    box.appendChild(wrap);
  }

  async function loadChampHistory(force) {
    if (champ.loading || (!force && champ.loadedAt && Date.now() - champ.loadedAt < 30000)) return;
    champ.loading = true;
    if (!champ.loadedAt) $('champHistory').replaceChildren(skeleton(3, 'tall'));
    try {
      const res = await api('GET', '/api/competition/history?limit=20');
      if (!ok(res)) {
        if (!champ.loadedAt && !state.gated) {
          $('champHistory').replaceChildren(stateNode('📡', 'championship.error', null, 'championship.retry', () => loadChampHistory(true)));
        }
        return;
      }
      champ.loadedAt = Date.now();
      champ.list = res.data.competitions || [];
      renderChampHistory();
    } finally {
      champ.loading = false;
    }
  }

  function initChampTabs() {
    document.querySelectorAll('.ctab').forEach((b) => b.addEventListener('click', () => setChampTab(b.dataset.ctab)));
    syncChampInd();
  }

  // ---------- Rush Coin: hint, tikish, referal, tarix ----------
  const coinHist = { cursor: null, loadedAt: 0, loading: false };
  const ref = { loadedAt: 0, link: null, loading: false };
  const bet = { busy: false };
  // Tanga yuborish: reqId — joriy urinishning UUID'si (tarmoq xatosidan keyingi qayta urinishda o'zgarmaydi)
  const send = { busy: false, reqId: null };

  function renderCoinHint() {
    tx($('coinHint'), 'coin.hint', { n: state.adReward });
    tx($('homeRef'), 'coin.ref', { n: state.referralReward });
    $('refReward').textContent = '+' + state.referralReward;
    $('rushAdReward').textContent = '+' + state.adReward;
    const qr = $('quickAdReward'); if (qr) qr.textContent = '+' + state.adReward;
    const tr = $('taskRefReward'); if (tr) tr.textContent = '+' + state.referralReward;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function betAmount() {
    const v = $('betAmount').value.trim();
    return /^\d{1,9}$/.test(v) ? Number(v) : 0;
  }

  function betSay(key, kind, vars) {
    const m = $('betMsg');
    if (key) tx(m, key, vars); else plain(m, '');
    m.className = 'msg' + (kind ? ' ' + kind : '');
  }

  // Faqat ko'rsatish: haqiqiy tekshiruv (balans, limit, competition ochiqligi) serverda
  function updateBetState() {
    if (!$('betBtn')) return;
    const live = isLive();
    const full = state.activeBets >= state.maxBets;
    $('betSlots').textContent = `${state.activeBets}/${state.maxBets}`;
    $('betBtn').disabled = bet.busy || !state.loaded || !live || full || betAmount() <= 0;
    $('betBtn').classList.toggle('busy', bet.busy);
    const target = $('betTarget');
    const sc = selectedChamp();
    if (target) plain(target, sc ? tt('champs.bet_target', { name: sc.title }) : '');
    const note = $('betNote');
    if (!state.competition) tx(note, 'bet.note.none');
    else if (!live) tx(note, state.startAt && Date.now() < state.startAt ? 'bet.note.upcoming' : 'bet.note.closed');
    else if (full) tx(note, 'bet.note.full', { n: state.maxBets });
    else tx(note, 'bet.note.info', { n: state.lossPct });
  }

  async function placeBet() {
    if (bet.busy || state.gated) return;
    const amount = betAmount();
    betSay('');
    if (!amount) return;
    if (amount < state.minBet) { betSay('bet.min', 'bad', { n: nf.format(state.minBet) }); haptic('error'); return; }
    if (amount > state.maxBet) { betSay('bet.max', 'bad', { n: nf.format(state.maxBet) }); haptic('error'); return; }
    if (amount > state.coins) { betSay('reason.INSUFFICIENT_FUNDS', 'bad'); haptic('error'); return; }
    if (!(await confirmBox(tt('bet.confirm', { n: nf.format(amount) })))) return;

    bet.busy = true;
    updateBetState();
    try {
      // Klient faqat miqdor va requestId yuboradi; userId/balans yuborilmaydi — hammasi serverda
      const r = await api('POST', '/api/competition/bet', { amount, competitionId: state.selId, requestId: uuid() }, { retry: false });
      if (ok(r)) {
        if (Number.isInteger(r.data.rushCoins)) { state.coins = r.data.rushCoins; setCoinBal(r.data.rushCoins, false); }
        if (Number.isInteger(r.data.activeBets)) state.activeBets = r.data.activeBets;
        $('betAmount').value = '';
        coinHist.loadedAt = 0;
        betSay('bet.placed', 'good', { n: nf.format(amount) });
        haptic('success');
        await refresh();
        loadMeta().catch(() => {}); // kartalardagi ishtirokchilar/o'rin yangilansin
      } else {
        if (r.status === 0) betSay('err.network', 'bad');
        else {
          const d = r.data || {};
          if (Number.isInteger(d.rushCoins)) { state.coins = d.rushCoins; setCoinBal(d.rushCoins, false); }
          betSay(reasonKey(d.reason, 'bet.failed'), 'bad');
        }
        haptic('error');
        refresh().catch(() => {});
      }
    } catch (_e) {
      betSay('err.unexpected', 'bad');
    } finally {
      bet.busy = false;
      updateBetState();
    }
  }

  // ---------- Bosh sahifa: chempionatga kirish; reklama Vazifalar sahifasida ----------
  // Faqat navigatsiya/ko'rinish: reklama oqimi (watchAd, AdsGram, server tasdig'i) o'zgarmagan.
  function initRush() {
    // "RUSH OLISH" tugmasi data-go="tasks" orqali Vazifalar sahifasiga o'tkazadi (init() dagi umumiy handler)
    $('joinBtn').addEventListener('click', () => {
      haptic('select');
      if (state.selId) openChamp(state.selId);
    });
  }

  function initBet() {
    const input = $('betAmount');
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
      if (clean !== input.value) input.value = clean;
      betSay('');
      updateBetState();
    });
    document.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.chip === 'max' ? Math.min(state.coins, state.maxBet) : Number(b.dataset.chip);
      input.value = v > 0 ? String(v) : '';
      haptic('select');
      betSay('');
      updateBetState();
    }));
    $('betBtn').addEventListener('click', placeBet);
  }

  // ---------- Tanga yuborish (Profil -> 💸) ----------
  // Klient faqat miqdor, qabul qiluvchi ID va requestId yuboradi; balans va limitlar serverda tekshiriladi.
  // Yangi balans FAQAT serverdan (r.data.rushCoins) olinadi — klient hech narsani hisoblamaydi.
  /** O'z Telegram ID'si: /me dan (server), bo'lmasa initDataUnsafe (faqat ko'rsatish uchun). */
  function ownId() {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return state.tgId || (u && u.id ? String(u.id) : '');
  }

  function renderMyId() {
    const b = $('myId');
    if (!b) return;
    const id = ownId();
    b.hidden = !id;
    if (id) tx(b, 'send.my_id', { id });
  }

  function sendAmount() {
    const v = $('sendAmount').value.trim();
    return /^\d{1,9}$/.test(v) ? Number(v) : 0;
  }

  /** Qabul qiluvchi ID — satr sifatida (BigInt-xavfsiz); noto'g'ri bo'lsa ''. */
  function sendToId() {
    const v = $('sendTo').value.trim();
    return /^\d{1,15}$/.test(v) && Number(v) > 0 ? v : '';
  }

  function sendSay(key, kind, vars) {
    const m = $('sendMsg');
    if (key) tx(m, key, vars); else plain(m, '');
    m.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function updateSendState() {
    const b = $('sendBtn');
    if (!b) return;
    b.disabled = send.busy || !state.loaded || sendAmount() <= 0 || !sendToId();
    b.classList.toggle('busy', send.busy);
  }

  /** Sahifaga kirganda: inputlar tozalanadi, balans ko'rsatiladi (go() refresh() ham chaqiradi). */
  function enterSend() {
    if (send.busy) return;
    $('sendAmount').value = '';
    $('sendTo').value = '';
    send.reqId = null;
    sendSay('');
    setCoinBal(state.coins, false);
    updateSendState();
  }

  async function sendCoins() {
    if (send.busy || state.gated) return;
    const amount = sendAmount();
    const to = sendToId();
    sendSay('');
    if (!amount) { sendSay('send.bad_amount', 'bad'); haptic('error'); return; }
    if (!to) { sendSay('send.bad_id', 'bad'); haptic('error'); return; }
    if (to === ownId()) { sendSay('reason.SELF_TRANSFER', 'bad'); haptic('error'); return; } // faqat tezkor xabar; haqiqiy tekshiruv serverda
    if (amount > state.coins) { sendSay('reason.INSUFFICIENT_FUNDS', 'bad'); haptic('error'); return; }
    if (!(await confirmBox(tt('send.confirm', { n: nf.format(amount), id: to })))) return;

    send.busy = true;
    updateSendState();
    if (!send.reqId) send.reqId = uuid(); // qayta bosishda yangi emas: tarmoq xatosidan keyin shu id bilan qayta uriniladi
    try {
      const r = await api('POST', '/api/coins/transfer', { toTelegramId: to, amount, requestId: send.reqId }, { retry: false });
      if (ok(r)) {
        send.reqId = null;
        if (Number.isInteger(r.data.rushCoins)) { state.coins = r.data.rushCoins; setCoinBal(r.data.rushCoins, false); }
        coinHist.loadedAt = 0; // tarix keshi eskirdi: profilga qaytganda qayta yuklanadi
        const t = r.data.to || {};
        const who = t.username ? '@' + t.username : (t.firstName || to);
        $('sendAmount').value = '';
        $('sendTo').value = '';
        sendSay('');
        toast(tt('send.sent', { n: nf.format(amount), who }), false);
        haptic('success');
        go('profile');
      } else if (r.status === 0) {
        sendSay('err.network', 'bad'); // reqId saqlanadi: server o'tkazmani qabul qilgan bo'lsa, qayta urinish DUPLICATE_REQUEST beradi
        haptic('error');
      } else {
        const d = r.data || {};
        if (r.status < 500) send.reqId = null; // server aniq rad etdi — keyingi urinish yangi so'rov
        if (Number.isInteger(d.rushCoins)) { state.coins = d.rushCoins; setCoinBal(d.rushCoins, false); }
        if (d.reason === 'INVALID_AMOUNT' && Number.isInteger(d.min) && Number.isInteger(d.max)) {
          sendSay('send.range', 'bad', { min: nf.format(d.min), max: nf.format(d.max) });
        } else if (d.reason === 'DUPLICATE_REQUEST') {
          coinHist.loadedAt = 0;
          sendSay('send.duplicate', 'bad');
        } else {
          sendSay(reasonKey(d.reason, 'send.failed'), 'bad');
        }
        haptic('error');
        refresh().catch(() => {});
      }
    } catch (_e) {
      sendSay('err.unexpected', 'bad');
    } finally {
      send.busy = false;
      updateSendState();
    }
  }

  function initSend() {
    for (const id of ['sendAmount', 'sendTo']) {
      const input = $(id);
      input.addEventListener('input', () => {
        const clean = input.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
        if (clean !== input.value) input.value = clean;
        sendSay('');
        updateSendState();
      });
    }
    $('sendBtn').addEventListener('click', sendCoins);
    $('myId').addEventListener('click', async () => {
      const id = ownId();
      if (!id) return;
      toast(tt((await copyText(id)) ? 'send.id_copied' : 'ref.copy_fail'), false);
    });
  }

  async function loadReferrals(force) {
    if (ref.loading || (!force && ref.loadedAt && Date.now() - ref.loadedAt < 30000)) return;
    ref.loading = true;
    try {
      const res = await api('GET', '/api/referrals/me');
      if (!ok(res)) return;
      ref.loadedAt = Date.now();
      const d = res.data;
      if (Number.isInteger(d.reward)) { state.referralReward = d.reward; renderCoinHint(); }
      setNum($('refInvited'), d.invited, false);
      $('refEarned').textContent = '+' + nf.format(d.earned || 0);
      ref.link = typeof d.link === 'string' && /^https:\/\/t\.me\//.test(d.link) ? d.link : null;
      if (ref.link) plain($('refLink'), ref.link); else tx($('refLink'), 'ref.no_link');
      $('refShare').disabled = !ref.link;
      $('refCopy').disabled = !ref.link;
    } finally {
      ref.loading = false;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (_e) { /* zaxira yo'l */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:-999px';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (_e) { done = false; }
    ta.remove();
    return done;
  }

  function initReferral() {
    $('refCopy').addEventListener('click', async () => {
      if (!ref.link) return;
      toast(tt((await copyText(ref.link)) ? 'ref.copied' : 'ref.copy_fail'), false);
    });
    $('refShare').addEventListener('click', () => {
      if (!ref.link) return;
      const url = 'https://t.me/share/url?url=' + encodeURIComponent(ref.link) + '&text=' + encodeURIComponent(tt('ref.share_text'));
      haptic('light');
      if (tg && typeof tg.openTelegramLink === 'function') tgTry(() => tg.openTelegramLink(url));
      else window.open(url, '_blank', 'noopener');
    });
  }

  function txRow(t) {
    const row = el('div', 'row tx');
    const name = el('span', 'name');
    name.append(el('span', null, i18n.has('tx.' + t.type) ? tt('tx.' + t.type) : t.type), el('small', 'tx-date', new Date(t.createdAt).toLocaleString(i18n.locale, DATE_FMT)));
    row.append(name, el('span', 'val ' + (t.amount > 0 ? 'pos' : 'neg'), (t.amount > 0 ? '+' : '') + nf.format(t.amount)));
    return row;
  }

  async function loadCoinHistory(more) {
    if (coinHist.loading) return;
    if (!more && coinHist.loadedAt && Date.now() - coinHist.loadedAt < 15000) return;
    coinHist.loading = true;
    try {
      const q = '/api/coins/history?limit=20' + (more && coinHist.cursor ? '&cursor=' + encodeURIComponent(coinHist.cursor) : '');
      const res = await api('GET', q);
      const box = $('coinHist');
      if (!ok(res)) {
        if (!coinHist.loadedAt && !state.gated) box.replaceChildren(stateNode('📡', 'coinhist.fail', null, 'common.retry', () => loadCoinHistory(false)));
        return;
      }
      if (!more) { box.replaceChildren(); coinHist.loadedAt = Date.now(); state.coinItems = []; }
      coinHist.cursor = res.data.nextCursor || null;
      $('coinHistMore').hidden = !coinHist.cursor;
      if (Number.isInteger(res.data.rushCoins)) { state.coins = res.data.rushCoins; setCoinBal(res.data.rushCoins, false); setNum($('pCoins'), res.data.rushCoins, false); }
      if (!more && !res.data.items.length) { box.appendChild(stateNode('💰', 'coinhist.empty', 'coinhist.empty_hint')); return; }
      for (const t of res.data.items) { state.coinItems.push(t); box.appendChild(txRow(t)); }
    } finally {
      coinHist.loading = false;
    }
  }

  // ---------- Avto-yangilanish ----------
  // Sahifa ko'rinib turganda; yashirin bo'lsa to'xtaydi. Har 4-davrda competition/sovrinlar ham yangilanadi.
  function schedule() {
    clearTimeout(state.pollId);
    state.pollId = setTimeout(async () => {
      if (!document.hidden && !state.busy && !state.gated) {
        state.ticks += 1;
        try {
          await refresh();
          if (state.ticks % 4 === 0) await loadMeta();
        } catch (_e) { /* keyingi urinish */ }
      }
      schedule();
    }, state.refreshSec * 1000);
  }

  function everySecond() {
    if (document.hidden || state.gated) return;
    if (state.competition) updateCountTarget();
    renderTimer();
    tickChamps();
    updateWatchState();
    // Vaqt tugagan bo'lsa (server auto-end qiladi) holatni yangilab turamiz
    if (state.endAt && Date.now() > state.endAt + 2000 && Date.now() - state.metaReloadAt > 20000) loadMeta().catch(() => {});
  }

  async function init() {
    tgSetup();
    initTheme();
    initLang();
    initChampTabs();
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $('watch').addEventListener('click', () => watchAd(false));
    $('quickAd').addEventListener('click', () => watchAd(true));
    initRush();
    initBet();
    initReferral();
    initSend();
    initSubGate();
    $('coinHistMore').addEventListener('click', () => loadCoinHistory(true).catch(() => {}));
    $('homeRetry').addEventListener('click', retryAll);
    document.addEventListener('visibilitychange', () => {
      root.classList.toggle('paused', document.hidden);
      if (!document.hidden && state.gated && state.gateKind === 'subscribe') checkSubscription().catch(() => {}); // kanaldan qaytganda avto-tekshirish
      if (!document.hidden && state.loaded && !state.gated) { refresh().catch(() => {}); loadMeta().catch(() => {}); }
    });
    initNavDrag();
    window.addEventListener('resize', syncNav);
    if (window.ResizeObserver && $('nav')) new ResizeObserver(() => syncNav()).observe($('nav')); // Admin tab paydo bo'lganda ham to'g'rilanadi
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncNav);
    setInterval(everySecond, 1000);
    renderProfile();
    requestAnimationFrame(syncNav);
    enterView('home');

    if (!(await waitForTelegram(4000))) { gate('open'); return; }
    try { if (tg) { tg.ready(); tg.expand(); } } catch (_e) {}

    // Til: server — haqiqat manbai. /me javobi kelishi bilan setLang() chaqiriladi (?lang= / localStorage faqat birinchi chizish uchun).
    const meRes = api('GET', '/api/users/me').then((r) => {
      applyServerLanguage(r);
      if (ok(r) && r.data.user && /^\d{1,15}$/.test(String(r.data.user.telegramId))) { state.tgId = String(r.data.user.telegramId); renderMyId(); }
      return r;
    });
    // Majburiy obuna: status /me bilan birga so'raladi; tarmoq xatosida ilova oddiy ochiladi (server baribir to'sadi)
    const [meR, subR] = await Promise.all([meRes, api('GET', '/api/subscription/status')]);
    if (!state.gated && ok(subR) && subR.data.required && !subR.data.subscribed) gate('subscribe', subR.data.channel);
    if (state.gated && state.gateKind === 'subscribe') return; // ilovaning qolgan yuklanishi boshlanmaydi
    await Promise.all([loadMeta(), refresh()]);
    state.loaded = true;
    updateWatchState();
    if (!state.gated) { schedule(); loadRole(meR).catch(() => {}); }
  }

  /** /api/users/me javobidagi language bo'yicha tilni o'rnatadi (null bo'lsa — aniqlangan til qoladi). */
  function applyServerLanguage(res) {
    if (!ok(res)) return;
    const l = res.data.language;
    if (typeof l !== 'string' || i18n.supported.indexOf(l) === -1) return; // null — aniqlangan til qoladi
    langSave.server = l;
    // Foydalanuvchi shu orada o'zi til tanlagan va u hali yozilmagan bo'lsa — uning tanlovi buzilmasin
    if (langSave.want && langSave.want !== l) return;
    // Server tili HAR DOIM ustun: eski xabardagi tugma (?lang=eski) bilan ochilsa ham ilova bir lahzada to'g'ri tilga o'tadi
    i18n.setLang(l);
  }

  // ---------- Til almashtirgich (profil -> 🌐) ----------
  // Tanlanganda til DARHOL almashadi (setLang, sahifa yangilanmaydi); serverga fon rejimida yoziladi.
  // Tez-tez bosilsa faqat oxirgi tanlov yuboriladi (debounce + bir vaqtda bitta so'rov).
  const langSave = { server: null, want: null, timer: 0, busy: false };
  const LANG_OPTIONS = [['uz', '🇺🇿', 'O‘zbekcha'], ['en', '🇬🇧', 'English'], ['ru', '🇷🇺', 'Русский']]; // o'z tilida — tarjima qilinmaydi

  async function flushLang() {
    clearTimeout(langSave.timer);
    langSave.timer = 0;
    if (langSave.busy) return; // joriy so'rov tugagach o'zi qayta chaqiradi
    const want = langSave.want;
    if (!want || want === langSave.server) { langSave.want = null; return; }
    langSave.busy = true;
    const res = await api('POST', '/api/users/me/language', { language: want });
    langSave.busy = false;
    const saved = ok(res) && res.data.language === want;
    if (saved) langSave.server = want;
    if (langSave.want !== want) { flushLang(); return; } // kutish paytida yana o'zgartirgan — oxirgisini yozamiz
    langSave.want = null;
    if (saved) return;
    // Xato jim yutilmaydi: server tili ma'lum bo'lsa UI shunga qaytariladi, ogohlantirish shu tilda chiqadi
    if (langSave.server) i18n.setLang(langSave.server);
    toast(tt('lang.save_failed'), true);
  }

  function chooseLang(l) {
    if (i18n.supported.indexOf(l) === -1) return;
    if (l !== i18n.lang) haptic('select');
    i18n.setLang(l);
    langSave.want = l;
    clearTimeout(langSave.timer);
    langSave.timer = setTimeout(flushLang, 400);
  }

  function openLangSheet() {
    if (document.querySelector('.lsheet')) return;
    const opener = $('langBtn');
    const bg = el('div', 'sheet-bg');
    const sh = el('div', 'sheet lsheet');
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');
    sh.setAttribute('aria-labelledby', 'langTitle');
    const head = el('div', 'csheet-head');
    const h = ti('h3', null, 'lang.title');
    h.id = 'langTitle';
    const x = el('button', 'csheet-x', '✕');
    x.type = 'button';
    x.dataset.i18nAria = 'championship.close';
    x.setAttribute('aria-label', tt('championship.close'));
    head.append(h, x);
    const list = el('div', 'lang-list');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-labelledby', 'langTitle');
    const opts = LANG_OPTIONS.map(([code, flag, name]) => {
      const b = el('button', 'lang-opt');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', code === i18n.lang ? 'true' : 'false');
      b.tabIndex = code === i18n.lang ? 0 : -1;
      b.lang = code;
      b.dataset.lang = code;
      b.append(el('span', 'lf', flag), el('span', 'ln', name), el('span', 'lcode', code.toUpperCase()), el('span', 'lc', '✓'));
      b.firstChild.setAttribute('aria-hidden', 'true');
      b.lastChild.setAttribute('aria-hidden', 'true');
      return b;
    });
    list.append(...opts);
    sh.append(head, list);
    bg.appendChild(sh);

    const close = () => {
      bg.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
    const focusables = () => [x, ...opts];
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      const i = opts.indexOf(document.activeElement);
      if (i !== -1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        const next = opts[(i + step + opts.length) % opts.length];
        opts.forEach((o) => { o.tabIndex = o === next ? 0 : -1; });
        next.focus();
      } else if (e.key === 'Tab') { // fokus oyna ichida qoladi
        const f = focusables();
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    x.addEventListener('click', close);
    opts.forEach((b) => b.addEventListener('click', () => { chooseLang(b.dataset.lang); close(); }));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    (opts.find((o) => o.dataset.lang === i18n.lang) || opts[0]).focus();
  }

  function initLang() {
    const btn = $('langBtn');
    if (btn) btn.addEventListener('click', openLangSheet);
    // Ilova yopilayotganda kutilayotgan tanlov yo'qolmasin
    document.addEventListener('visibilitychange', () => { if (document.hidden && langSave.timer) flushLang(); });
    window.addEventListener('pagehide', () => { if (langSave.timer) flushLang(); });
  }

  // ---------- Til o'zgarganda qayta chizish ----------
  // data-i18n / tx() matnlarini AdRushI18n.apply() o'zi yangilaydi. Bu yerda: locale'ga bog'liq (sana, raqam) va
  // JS yig'adigan bo'limlar qayta chiziladi — sahifa yangilanmaydi.
  function onLangChange() {
    document.querySelectorAll('[data-v]').forEach((n) => { n.textContent = nf.format(Number(n.dataset.v)); });
    document.querySelectorAll('.lightbox, .csheet').forEach((n) => { (n.closest('.sheet-bg') || n).remove(); }); // ochiq oyna eski tilda qolmasin
    if (state.metaOk) { renderCompetition(state.competition, state.participants); renderChamps(); }
    renderCoinHint();
    renderChampDetail();
    if (state.chOk && state.lbData) renderChampBoard(state.lbData.list, state.lbData.me);
    if (state.me) renderMe(state.me);
    if (state.lbData) { state.lbSig = ''; renderBoard(state.lbData.list, state.lbData.me, state.lbData.hasCompetition); }
    renderProfile();
    if (state.histLoaded) renderHistory();
    if (champ.loadedAt) renderChampHistory();
    if (coinHist.loadedAt) {
      const box = $('coinHist');
      box.replaceChildren();
      if (!state.coinItems.length) box.appendChild(stateNode('💰', 'coinhist.empty', 'coinhist.empty_hint'));
      for (const t of state.coinItems) box.appendChild(txRow(t));
    }
    updateWatchState();
    updateBetState();
  }
  window.addEventListener('adrush:langchange', onLangChange);

  // Admin bo'limi: faqat server isAdmin:true desa admin.js yuklanadi (oddiy userga na tugma, na kod yuklanadi)
  async function loadRole(res) {
    if (!ok(res) || !res.data.isAdmin) return;
    state.isAdmin = true;
    $('pRole').hidden = false;
    $('pRole').textContent = res.data.role === 'SUPER_ADMIN' ? 'SUPER ADMIN' : 'ADMIN';
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'admin.js?v=6';
      sc.onload = resolve;
      sc.onerror = reject;
      document.body.appendChild(sc);
    });
    if (window.AdRushAdmin) window.AdRushAdmin.mount();
    syncNav();
  }

  window.AdRush = { api, el, nf: nfFixed, tg, state, toast, confirmBox, prizeThumb, placeLabel, who, go, stateNode, skeleton, haptic, setBack, syncNav, reduceMotion, setNum, currentTheme };

  init();
})();