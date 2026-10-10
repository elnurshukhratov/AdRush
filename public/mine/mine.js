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
    view: 'home', refreshSec: 15, busy: false, busyLabel: '',
    coolUntil: 0, cooldownMs: 10000, noAdUntil: 0, blockId: null, pollId: null,
    loaded: false, statsOk: false, isAdmin: false, backFn: null, gated: false, gateKind: null, subChannel: null, subBusy: false,
    coinItems: [], shopItems: [],
    // Olmos / Rush Coin: hammasi serverdan keladi (faqat ko'rsatish uchun saqlanadi)
    tgId: '', diamonds: 0, coins: 0, adsWatched: 0, diamondPerAd: 1, diamondToRush: 12, referralDiamondReward: 5,
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
  function say(key, kind, vars) {
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
  function who(r) { return r.username ? '@' + r.username : (r.firstName || tt('common.user')); }
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

  /** Balanslar barcha joyda (yuqori panel, Home, Vazifalar, Profil) bir vaqtda yangilanadi. Qiymat faqat serverdan. */
  function setBalances(d, bump) {
    if (!d) return;
    if (Number.isInteger(d.diamonds)) {
      state.diamonds = d.diamonds;
      ['topDiamonds', 'homeDiamonds', 'tasksDiamonds', 'pDiamonds'].forEach((id) => { const n = $(id); if (n) setNum(n, d.diamonds, bump && id === 'tasksDiamonds'); });
      const chip = $('topDiamondChip');
      if (bump && chip && !reduceMotion) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
    if (Number.isInteger(d.rushCoins)) {
      state.coins = d.rushCoins;
      ['topCoins', 'homeCoins', 'tasksCoins', 'pCoins', 'sendBal'].forEach((id) => { const n = $(id); if (n) setNum(n, d.rushCoins, false); });
      const chip = $('topCoinChip');
      if (bump && chip && !reduceMotion) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
  }
  /** Faqat Rush Coin yangilanadigan joylar (tanga yuborish) uchun qisqa yo'l. */
  function setCoinBal(value, bump) { setBalances({ rushCoins: value }, bump); }

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
    Array.from(v.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
    v.classList.remove('stag');
    void v.offsetWidth;
    v.classList.add('stag');
    clearTimeout(v._stagT);
    v._stagT = setTimeout(() => v.classList.remove('stag'), 900);
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
    if (view === 'send') state.backFn = () => go('profile'); // Tanga yuborish — Profilning ichki sahifasi
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    const tabView = view === 'send' ? 'profile' : view; // yuborish sahifasi "Profil" bo'limining ichki sahifasi
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
    if (view === 'profile') { loadOrders(false, false).catch(() => {}); loadReferrals().catch(() => {}); loadCoinHistory(false).catch(() => {}); }
    if (view === 'shop') loadShop().catch(() => {});
    if (state.loaded && view !== 'admin') refresh().catch(() => {});
    if (view === 'admin' && window.AdRushAdmin) window.AdRushAdmin.onShow();
  }

  // ---------- Reklama tugmasi holati ----------
  function updateWatchState() {
    const cd = Math.max(0, Math.ceil((state.coolUntil - Date.now()) / 1000));
    const noAd = Math.max(0, Math.ceil((state.noAdUntil - Date.now()) / 1000)); // AdsGram reklama bermadi -> tugma vaqtincha o'chiq
    const btn = $('watch');
    btn.disabled = state.busy || !state.loaded || cd > 0 || noAd > 0;
    btn.classList.toggle('busy', state.busy);
    if (state.busy) tx($('watchLabel'), state.busyLabel || 'watch.loading');
    else if (!state.loaded) tx($('watchLabel'), 'watch.loading');
    else if (cd > 0) tx($('watchLabel'), 'watch.cooldown', { n: cd });
    else if (noAd > 0) tx($('watchLabel'), 'watch.no_ad', { n: noAd });
    else tx($('watchLabel'), 'watch.label', { n: state.diamondPerAd });
    updateConvertState();
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




  // ---------- Reklama oqimi ----------
  // Server tasdig'i (AdsGram Reward URL) kutilayotgan bo'lsa sessiya holatini so'rab turadi
  /** Balanslar va kurslar: faqat serverdan (/api/users/me/stats). Klient hech narsani hisoblamaydi. */
  async function refresh() {
    const res = await api('GET', '/api/users/me/stats');
    if (!ok(res)) {
      if (!state.statsOk && !state.gated) showHomeError(res);
      return false;
    }
    state.statsOk = true;
    $('homeError').hidden = true;
    const d = res.data;
    if (Number.isInteger(d.diamondPerAd) && d.diamondPerAd > 0) state.diamondPerAd = d.diamondPerAd;
    if (Number.isInteger(d.diamondToRush) && d.diamondToRush > 0) state.diamondToRush = d.diamondToRush;
    if (Number.isInteger(d.referralDiamondReward) && d.referralDiamondReward > 0) state.referralDiamondReward = d.referralDiamondReward;
    if (Number.isInteger(d.adsWatched)) { state.adsWatched = d.adsWatched; setNum($('pAdsWatched'), d.adsWatched, false); }
    setBalances(d, false);
    renderRates();
    renderShopList();
    return true;
  }

  async function retryAll() {
    $('homeError').hidden = true;
    haptic('light');
    await Promise.all([refresh(), loadShopPreview()]);
    state.loaded = true;
    updateWatchState();
    if (!state.pollId) schedule();
  }

  /** Kurslar va mukofotlar (qiymatlar serverdan: config). */
  function renderRates() {
    const rate = tt('home.rate', { n: nf.format(state.diamondToRush) });
    plain($('homeRate'), rate);
    plain($('convRate'), rate);
    tx($('homeTasksHint'), 'home.tasks_hint', { n: nf.format(state.diamondPerAd) });
    tx($('homeRef'), 'home.ref', { n: nf.format(state.referralDiamondReward) });
    $('adReward').textContent = '+' + nf.format(state.diamondPerAd) + ' 💎';
    $('taskRefReward').textContent = '+' + nf.format(state.referralDiamondReward) + ' 💎';
    $('refReward').textContent = '+' + nf.format(state.referralDiamondReward) + ' 💎';
    if (!state.busy) $('plusOne').textContent = '+' + nf.format(state.diamondPerAd) + ' 💎';
    updateConvertState();
  }

  // ---------- Do'kon: Home preview (to'liq do'kon sahifasi keyingi qismda) ----------
  function shopMiniRow(p) {
    const row = el('div', 'shop-mini');
    row.append(el('span', 'name', p.title), el('span', 'val', '🪙 ' + nf.format(p.priceRush)));
    return row;
  }

  function renderShopPreview() {
    const card = $('homeShop');
    const items = state.shopItems.slice(0, 3);
    card.hidden = items.length === 0; // do'kon bo'sh bo'lsa Home da ko'rinmaydi
    $('homeShopList').replaceChildren(...items.map(shopMiniRow));
  }

  async function loadShopPreview() {
    const res = await api('GET', '/api/shop/products');
    if (!ok(res) || !Array.isArray(res.data.items)) return false;
    state.shopItems = res.data.items;
    renderShopPreview();
    renderShopList();
    return true;
  }

  const SHOP_IMG_RE = /^\/uploads\/[a-z]+\/[\w.-]+\.(jpg|jpeg|png|webp)$/i;
  const shopBuy = { busy: false, reqIds: {} };
  const orders = { items: [], cursor: null, loading: false, loaded: false, failed: false };

  function shopThumb(url, cls) {
    const box = el('div', cls);
    if (url && SHOP_IMG_RE.test(url)) {
      const img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = url;
      img.onerror = () => box.replaceChildren(document.createTextNode('🎁'));
      box.appendChild(img);
    } else box.textContent = '🎁';
    return box;
  }

  function productCard(p) {
    const c = el('div', 'card shop-card');
    const info = el('div', 'shop-info');
    info.append(el('b', null, p.title));
    if (p.description) info.append(el('div', 'muted', p.description));
    if (Number.isInteger(p.stock)) { const st = el('div', 'muted'); tx(st, 'shop.stock', { n: nf.format(p.stock) }); info.append(st); }
    const foot = el('div', 'shop-foot');
    const short = p.priceRush - state.coins;
    const btn = el('button', 'btn sm', '');
    btn.type = 'button';
    if (short > 0) { tx(btn, 'shop.short', { n: nf.format(short) }); btn.classList.add('sec'); } else tx(btn, 'shop.buy');
    btn.addEventListener('click', () => buyProduct(p));
    foot.append(el('span', 'shop-price', '🪙 ' + nf.format(p.priceRush)), btn);
    info.append(foot);
    c.append(shopThumb(p.imageUrl, 'shop-img'), info);
    return c;
  }

  function renderShopList() {
    const box = $('shopList');
    if (!box) return;
    if (!state.shopItems.length) { box.replaceChildren(stateNode('🛍', 'shop.empty', 'shop.empty_hint')); return; }
    box.replaceChildren(...state.shopItems.map(productCard));
  }

  async function buyProduct(p) {
    if (shopBuy.busy || state.gated) return;
    if (p.priceRush > state.coins) { toast(tt('reason.INSUFFICIENT_FUNDS'), true); haptic('error'); return; } // tezkor xabar; haqiqiy tekshiruv serverda
    if (!(await confirmBox(tt('shop.confirm', { t: p.title, n: nf.format(p.priceRush) })))) return;
    shopBuy.busy = true;
    if (!shopBuy.reqIds[p.id]) shopBuy.reqIds[p.id] = uuid(); // tarmoq xatosidan keyin shu id bilan qayta uriniladi
    try {
      const r = await api('POST', '/api/shop/buy', { productId: p.id, requestId: shopBuy.reqIds[p.id] }, { retry: false });
      if (ok(r)) {
        delete shopBuy.reqIds[p.id];
        setBalances(r.data, false);
        coinHist.loadedAt = 0;
        toast(tt('shop.bought'), false);
        haptic('success');
      } else if (r.status === 0) {
        toast(tt('err.network'), true); haptic('error');
      } else {
        if (r.status < 500) delete shopBuy.reqIds[p.id];
        const d = r.data || {};
        setBalances(d, false);
        toast(tt(reasonKey(d.reason, 'shop.buy_failed')), true);
        haptic('error');
      }
      await Promise.all([loadShopPreview(), loadOrders(false, true)]);
    } catch (_e) {
      toast(tt('err.unexpected'), true);
    } finally {
      shopBuy.busy = false;
    }
  }

  function orderRow(o) {
    const row = el('div', 'row');
    const name = el('span', 'name');
    name.append(el('span', null, o.productTitle), el('small', 'tx-date', new Date(o.createdAt).toLocaleString(i18n.locale, DATE_FMT)));
    const st = ti('small', 'ord-status ' + o.status, 'order.' + o.status);
    name.append(st);
    if (o.adminNote) name.append(el('small', 'muted', tt('shop.admin_note', { t: o.adminNote })));
    if (o.proofImage && SHOP_IMG_RE.test(o.proofImage)) {
      const img = document.createElement('img');
      img.className = 'ord-proof'; img.alt = tt('shop.proof'); img.loading = 'lazy'; img.src = o.proofImage;
      name.append(img);
    }
    row.append(name, el('span', 'val', '🪙 ' + nf.format(o.priceRush)));
    return row;
  }

  function renderOrders() {
    for (const id of ['shopOrders', 'profOrders']) {
      const box = $(id);
      if (!box) continue;
      if (orders.failed && !orders.items.length) { box.replaceChildren(stateNode('📡', 'shop.orders_fail', null, 'common.retry', () => loadOrders(false, true).catch(() => {}))); continue; }
      if (!orders.loaded) { box.replaceChildren(skeleton(2)); continue; }
      if (!orders.items.length) { box.replaceChildren(stateNode('📦', 'shop.orders_empty', 'shop.orders_empty_hint')); continue; }
      box.replaceChildren(...(id === 'profOrders' ? orders.items.slice(0, 3) : orders.items).map(orderRow));
    }
    $('shopOrdersMore').hidden = !orders.cursor;
  }

  async function loadOrders(more, force) {
    if (orders.loading) return;
    if (!more && !force && orders.loaded && Date.now() - orders.at < 15000) return;
    orders.loading = true;
    try {
      const q = '/api/shop/orders?limit=20' + (more && orders.cursor ? '&cursor=' + encodeURIComponent(orders.cursor) : '');
      const res = await api('GET', q);
      if (!ok(res) || !Array.isArray(res.data.items)) { orders.failed = true; return; }
      orders.failed = false; orders.loaded = true; orders.at = Date.now();
      orders.items = more ? orders.items.concat(res.data.items) : res.data.items;
      orders.cursor = res.data.nextCursor || null;
    } finally {
      orders.loading = false;
      renderOrders();
    }
  }

  async function loadShop() {
    const ok1 = await loadShopPreview();
    if (!ok1 && !state.shopItems.length) $('shopList').replaceChildren(stateNode('📡', 'shop.fail', 'err.check_network', 'common.retry', () => loadShop().catch(() => {})));
    await loadOrders(false, false);
  }

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

  /** Server reklamani hisoblagandan keyin: animatsiya + haptic. Olmos va balans serverdan kelgan javobdan olinadi. */
  function celebrate(data) {
    const gained = (data && Number.isInteger(data.reward) && data.reward) || state.diamondPerAd;
    say('watch.credited', 'good', { n: gained });
    coinHist.loadedAt = 0;
    $('plusOne').textContent = '+' + nf.format(gained) + ' 💎';
    haptic('success');
    const btn = $('watch');
    btn.classList.add('ok');
    setTimeout(() => btn.classList.remove('ok'), 1400);
    const plus = $('plusOne');
    plus.classList.remove('go');
    void plus.offsetWidth;
    plus.classList.add('go');
    burstSparks();
    if (data && Number.isInteger(data.diamonds)) setBalances({ diamonds: data.diamonds }, true);
    if (state.cooldownMs) startCooldown(state.cooldownMs);
  }

  /** AdsGram SDK (defer) tayyor bo'lguncha kutadi; ms ichida chiqmasa null. */
  async function waitAdsgram(ms) {
    const t0 = Date.now();
    while (!window.Adsgram && Date.now() - t0 < ms) await sleep(100);
    return window.Adsgram || null;
  }

  async function watchAd() {
    if (state.busy || state.gated) return;
    setBusy(true, 'watch.preparing');
    say('');
    haptic('light');
    if (atLeast('6.2')) tgTry(() => tg.enableClosingConfirmation());
    try {
      const s = await api('POST', '/api/ads/session', undefined, { retry: false });
      if (!ok(s)) { say(failKey(s), 'bad'); haptic('error'); return; }

      const cfg = s.data.adsgram || {};
      const blockId = cfg.blockId || state.blockId;
      if (blockId) state.blockId = blockId;
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
    }
  }


  // ---------- Olmos / Rush Coin: almashtirish, referal, tarix ----------
  const coinHist = { cursor: null, loadedAt: 0, loading: false };
  const ref = { loadedAt: 0, link: null, loading: false };
  const conv = { busy: false, reqId: null };
  // Tanga yuborish: reqId — joriy urinishning UUID'si (tarmoq xatosidan keyingi qayta urinishda o'zgarmaydi)
  const send = { busy: false, reqId: null };


  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }







  // ---------- Olmos -> Rush Coin almashtirish (Vazifalar) ----------
  // Klient faqat olmos miqdori va requestId yuboradi; kurs, balans va natija serverda. "≈ N 🪙" faqat ko'rsatish uchun.
  function convAmount() {
    const v = $('convAmount').value.trim();
    return /^\d{1,9}$/.test(v) ? Number(v) : 0;
  }

  function convSay(key, kind, vars) {
    const m = $('convMsg');
    if (key) tx(m, key, vars); else plain(m, '');
    m.className = 'msg center' + (kind ? ' ' + kind : '');
  }

  function updateConvertState() {
    const b = $('convBtn');
    if (!b) return;
    const n = convAmount();
    b.disabled = conv.busy || !state.loaded || n <= 0;
    b.classList.toggle('busy', conv.busy);
    if (n > 0) tx($('convPreview'), 'tasks.conv_get', { n: nf.format(n * state.diamondToRush) }); else plain($('convPreview'), '');
  }

  async function convertDiamonds() {
    if (conv.busy || state.gated) return;
    const n = convAmount();
    convSay('');
    if (!n) { convSay('tasks.conv_bad', 'bad'); haptic('error'); return; }
    if (n > state.diamonds) { convSay('reason.INSUFFICIENT_FUNDS', 'bad'); haptic('error'); return; } // tezkor xabar; haqiqiy tekshiruv serverda
    if (!(await confirmBox(tt('tasks.conv_confirm', { d: nf.format(n), r: nf.format(n * state.diamondToRush) })))) return;

    conv.busy = true;
    updateConvertState();
    if (!conv.reqId) conv.reqId = uuid(); // tarmoq xatosidan keyin shu id bilan qayta uriniladi (idempotent)
    try {
      const r = await api('POST', '/api/coins/convert', { diamonds: n, requestId: conv.reqId }, { retry: false });
      if (ok(r)) {
        conv.reqId = null;
        setBalances(r.data, true);
        coinHist.loadedAt = 0;
        const got = r.data.converted && Number.isInteger(r.data.converted.rush) ? r.data.converted.rush : n * state.diamondToRush;
        $('convAmount').value = '';
        convSay('');
        toast(tt('tasks.conv_done', { d: nf.format(n), r: nf.format(got) }), false);
        haptic('success');
      } else if (r.status === 0) {
        convSay('err.network', 'bad'); // reqId saqlanadi
        haptic('error');
      } else {
        const d = r.data || {};
        if (r.status < 500) conv.reqId = null; // server aniq rad etdi — keyingi urinish yangi so'rov
        setBalances(d, false);
        if (d.reason === 'DUPLICATE_REQUEST') { coinHist.loadedAt = 0; convSay('tasks.conv_duplicate', 'bad'); }
        else convSay(reasonKey(d.reason, 'tasks.conv_failed'), 'bad');
        haptic('error');
        refresh().catch(() => {});
      }
    } catch (_e) {
      convSay('err.unexpected', 'bad');
    } finally {
      conv.busy = false;
      updateConvertState();
    }
  }

  function initConvert() {
    const input = $('convAmount');
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
      if (clean !== input.value) input.value = clean;
      conv.reqId = null; // miqdor o'zgardi — yangi so'rov
      convSay('');
      updateConvertState();
    });
    $('convMax').addEventListener('click', () => {
      input.value = state.diamonds > 0 ? String(state.diamonds) : '';
      conv.reqId = null;
      haptic('select');
      convSay('');
      updateConvertState();
    });
    $('convBtn').addEventListener('click', convertDiamonds);
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
      if (Number.isInteger(d.rewardDiamonds) && d.rewardDiamonds > 0) { state.referralDiamondReward = d.rewardDiamonds; renderRates(); }
      setNum($('refInvited'), d.invited, false);
      $('refEarned').textContent = '+' + nf.format(d.earnedDiamonds || 0) + ' 💎';
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

  /** Olib tashlangan eski turdagi ledger yozuvlari bazada qoladi (balans mosligi uchun), ilova ularni ko'rsatmaydi. */
  const HIDDEN_TX = new Set(['COMPETITION_BET', 'LOSS_REFUND', 'COMPETITION_WIN']);

  function txRow(t) {
    const diamond = t.currency === 'DIAMOND';
    const row = el('div', 'row tx');
    const name = el('span', 'name');
    name.append(el('span', null, i18n.has('tx.' + t.type) ? tt('tx.' + t.type) : t.type), el('small', 'tx-date', new Date(t.createdAt).toLocaleString(i18n.locale, DATE_FMT)));
    row.append(name, el('span', 'val ' + (t.amount > 0 ? 'pos' : 'neg'), (t.amount > 0 ? '+' : '') + nf.format(t.amount) + (diamond ? ' 💎' : ' 🪙')));
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
      setBalances(res.data, false);
      if (!more && !res.data.items.length) { box.appendChild(stateNode('💰', 'coinhist.empty', 'coinhist.empty_hint')); return; }
      for (const t of res.data.items) { if (HIDDEN_TX.has(t.type)) continue; state.coinItems.push(t); box.appendChild(txRow(t)); }
    } finally {
      coinHist.loading = false;
    }
  }

  // ---------- Avto-yangilanish ----------
  // Sahifa ko'rinib turganda balanslar yangilanadi; yashirin bo'lsa to'xtaydi.
  function schedule() {
    clearTimeout(state.pollId);
    state.pollId = setTimeout(async () => {
      if (!document.hidden && !state.busy && !state.gated) {
        try { await refresh(); } catch (_e) { /* keyingi urinish */ }
      }
      schedule();
    }, state.refreshSec * 1000);
  }

  function everySecond() {
    if (document.hidden || state.gated) return;
    updateWatchState();
  }

  async function init() {
    tgSetup();
    initTheme();
    initLang();
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $('watch').addEventListener('click', () => watchAd());
    initConvert();
    $('shopOrdersMore').addEventListener('click', () => loadOrders(true).catch(() => {}));
    initReferral();
    initSend();
    initSubGate();
    $('coinHistMore').addEventListener('click', () => loadCoinHistory(true).catch(() => {}));
    $('homeRetry').addEventListener('click', retryAll);
    document.addEventListener('visibilitychange', () => {
      root.classList.toggle('paused', document.hidden);
      if (!document.hidden && state.gated && state.gateKind === 'subscribe') checkSubscription().catch(() => {}); // kanaldan qaytganda avto-tekshirish
      if (!document.hidden && state.loaded && !state.gated) { refresh().catch(() => {}); loadShopPreview().catch(() => {}); }
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
    await Promise.all([refresh(), loadShopPreview()]);
    state.loaded = true;
    renderRates();
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
    x.dataset.i18nAria = 'common.close';
    x.setAttribute('aria-label', tt('common.close'));
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
    document.querySelectorAll('.csheet').forEach((n) => { (n.closest('.sheet-bg') || n).remove(); }); // ochiq oyna eski tilda qolmasin
    renderRates();
    renderShopPreview();
    renderShopList();
    renderOrders();
    renderProfile();
    if (coinHist.loadedAt) {
      const box = $('coinHist');
      box.replaceChildren();
      if (!state.coinItems.length) box.appendChild(stateNode('💰', 'coinhist.empty', 'coinhist.empty_hint'));
      for (const t of state.coinItems) box.appendChild(txRow(t));
    }
    updateWatchState();
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
      sc.src = 'admin.js?v=7';
      sc.onload = resolve;
      sc.onerror = reject;
      document.body.appendChild(sc);
    });
    if (window.AdRushAdmin) window.AdRushAdmin.mount();
    syncNav();
  }

  window.AdRush = { api, el, nf: nfFixed, tg, state, toast, confirmBox, who, go, stateNode, skeleton, haptic, setBack, syncNav, reduceMotion, setNum, currentTheme };

  init();
})();