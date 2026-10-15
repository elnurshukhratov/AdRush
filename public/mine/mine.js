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
  // Katta raqamlar qisqa ko'rinishda: 1000 → 1k, 1 500 000 → 1.5M (yaxlitlanmaydi, pastga qirqiladi — balans ortiq ko'rinmasin).
  const COMPACT_IDS = new Set(['topDiamonds', 'tasksDiamonds', 'pDiamonds', 'topCoins', 'tasksCoins', 'pCoins', 'pUzs']);
  const cfCache = {};
  function compactFmt(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs < 1000) return nf.format(v);
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    const u = units.find((x) => abs >= x[0]);
    const q = abs / u[0];
    const dec = q < 10 ? 2 : q < 100 ? 1 : 0;
    const k = Math.pow(10, dec);
    const cut = Math.floor(q * k + 1e-9) / k;
    const f = cfCache[i18n.locale + dec] || (cfCache[i18n.locale + dec] = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: dec, useGrouping: false }));
    return (v < 0 ? '-' : '') + f.format(cut) + u[1];
  }
  function numText(node, n) {
    if ((node.id && COMPACT_IDS.has(node.id)) || node.dataset.compact) { node.title = nf.format(n); return compactFmt(n); }
    return nf.format(n);
  }
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
    cooldownMs: 5000, pollId: null, active: null, adsLoaded: false, adsAt: 0, adsBusy: false,
    loaded: false, statsOk: false, isAdmin: false, backFn: null, gated: false, gateKind: null, subChannels: [], subBusy: false,
    coinItems: [], shopItems: [],
    // Olmos / Rush Coin: hammasi serverdan keladi (faqat ko'rsatish uchun saqlanadi)
    tgId: '', diamonds: 0, coins: 0, uzs: 0, adsWatched: 0, diamondPerAd: 1, rate: { d: 12, r: 4, sd: 3, sr: 1 }, referralDiamondReward: 5,
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
    else if (res.status === 403 && res.data && res.data.reason === 'SUBSCRIPTION_REQUIRED') gate('subscribe', channelsOf(res.data));
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
    const u = state.active;
    const m = u && u.msg; // faol reklama kartasining xabari
    if (!m) { // tepadagi +1 tugmada xabar joyi yo'q — qisqa toast
      if (key) toast(tt(key, vars), kind === 'bad');
      return;
    }
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
    if (Number.isNaN(from) || from === to || reduceMotion) { node.textContent = numText(node, to); return; }
    const t0 = performance.now();
    const dur = 450;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      node.textContent = numText(node, Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
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
      ['topDiamonds', 'chessDiamonds', 'tasksDiamonds', 'pDiamonds'].forEach((id) => { const n = $(id); if (n) setNum(n, d.diamonds, bump && id === 'tasksDiamonds'); });
      const chip = $('topDiamondChip');
      if (bump && chip && !reduceMotion) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
    if (Number.isInteger(d.rushCoins)) {
      state.coins = d.rushCoins;
      ['topCoins', 'tasksCoins', 'pCoins', 'sendBal', 'buyCoinsBal'].forEach((id) => { const n = $(id); if (n) setNum(n, d.rushCoins, false); });
      const chip = $('topCoinChip');
      if (bump && chip && !reduceMotion) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
    if (Number.isInteger(d.balanceUzs)) { // so'm balans (faqat Profil hamyoni)
      state.uzs = d.balanceUzs;
      ['pUzs', 'buyUzs'].forEach((id) => { const n = $(id); if (n) setNum(n, d.balanceUzs, bump); });
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
  function burstSparks(wrap) {
    if (reduceMotion || !wrap) return;
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
  /** Serverdan kelgan javobdan kanallar ro'yxati (eski `channel` formatiga ham mos). */
  function channelsOf(data) {
    if (data && Array.isArray(data.channels) && data.channels.length) return data.channels;
    return data && data.channel ? [data.channel] : [];
  }

  function gate(kind, channels) {
    if (kind === 'subscribe' && Array.isArray(channels) && channels.length) state.subChannels = channels;
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

  /** Kanal kartalarini to'ldiradi (matnlar faqat textContent orqali). Har bir karta — alohida kanal. */
  function fillSubGate() {
    const list = $('subList');
    const chans = state.subChannels || [];
    list.replaceChildren();
    chans.forEach((ch) => {
      const url = channelUrl(ch);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;margin:0;text-align:left;font:inherit;color:inherit;cursor:pointer' + (ch.member === true ? ';opacity:.65' : '');
      card.disabled = !url;
      const ico = document.createElement('span');
      ico.className = 'thumb';
      ico.setAttribute('aria-hidden', 'true');
      ico.textContent = ch.member === true ? '✅' : '📢';
      const box = document.createElement('span');
      box.style.cssText = 'flex:1;min-width:0';
      const title = document.createElement('b');
      title.style.cssText = 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      title.textContent = ch.title || (ch.username ? '@' + ch.username : '—');
      const user = document.createElement('small');
      user.className = 'muted';
      user.textContent = ch.username ? '@' + ch.username : '';
      box.append(title, user);
      const arrow = document.createElement('b');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.style.fontSize = '20px';
      arrow.textContent = '↗';
      card.append(ico, box, arrow);
      card.addEventListener('click', () => openChannel(ch));
      list.appendChild(card);
    });
  }

  /** Kanalni ochadi: openTelegramLink -> openLink -> window.open. */
  function openChannel(ch) {
    const url = channelUrl(ch);
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
        const fresh = channelsOf(res.data);
        if (fresh.length) { state.subChannels = fresh; fillSubGate(); } // qaysi kanallar qolganini ✅ bilan ko'rsatadi
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
    if (view === 'send' || view === 'buy') state.backFn = () => go('profile'); // Tanga yuborish / sotib olish — Profilning ichki sahifalari
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    const tabView = view === 'send' || view === 'buy' ? 'profile' : view; // ichki sahifalar "Profil" bo'limining ichki sahifasi
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
    if (view === 'buy') enterBuy();
    if (view === 'profile') { loadOrders(false, false).catch(() => {}); loadReferrals().catch(() => {}); loadCoinHistory(false).catch(() => {}); loadWalletConfig(false).catch(() => {}); }
    if (view === 'shop') loadShop().catch(() => {});
    if (view === 'home' && window.AdRushChess) window.AdRushChess.onShow(); // Home — shahmat ekrani (chess.js)
    if (state.loaded && view !== 'admin') refresh().catch(() => {});
    if (view === 'admin' && window.AdRushAdmin) window.AdRushAdmin.onShow();
  }

  // ---------- Reklama joylari: 3 ta vazifa kartasi + tepadagi +1 tugma ----------
  // Har bir joy (unit) MUSTAQIL: o'z provayderi, o'z holati (yoqilgan / cooldown / "reklama yo'q") va o'z xabari bor.
  // Karta provayderi HTML dagi data-provider dan olinadi. Block/zone/spot ID lari klientda SAQLANMAYDI: ular faqat shu joy
  // uchun ochilgan server sessiyasining javobidan olinadi — shuning uchun biror joyning ID si boshqasida ishlatilmaydi.
  // Tepadagi +1 tugma — FAQAT AdsGram (placement=quick), vazifa kartasidan alohida block ID bilan (serverda belgilanadi).
  const AD_PROVIDERS = ['adsgram', 'monetag', 'onclicka'];
  const adUnits = []; // { key, provider, placement, card, btn, label, plus, msg, reward, enabled, coolUntil, noAdUntil }

  function registerAdUnits() {
    document.querySelectorAll('.ad-slot[data-provider]').forEach((card) => {
      const provider = card.dataset.provider;
      if (!AD_PROVIDERS.includes(provider)) return;
      const unit = {
        key: provider + ':task', provider, placement: 'task', card,
        btn: card.querySelector('.cta'),
        label: card.querySelector('.cta > span'),
        plus: card.querySelector('.plus'),
        msg: card.querySelector('p.msg'),
        reward: card.querySelector('.task-head .chip-sm'),
        enabled: null, // null = hali noma'lum (config yuklanmagan)
        coolUntil: 0, // shu kartadan keyingi reklamagacha (cooldown)
        noAdUntil: 0, // shu karta provayderi reklama bermadi
      };
      adUnits.push(unit);
      unit.btn.addEventListener('click', () => watchAd(unit));
    });
    const tw = $('topWatch');
    if (tw) {
      const unit = {
        key: 'adsgram:quick', provider: 'adsgram', placement: 'quick', card: null,
        btn: tw, label: $('topWatchLabel'), plus: null, msg: null, reward: null,
        enabled: null, coolUntil: 0, noAdUntil: 0,
      };
      adUnits.push(unit);
      tw.addEventListener('click', () => watchAd(unit));
    }
  }

  /**
   * GET /api/ads/config: qaysi joy yoqilgan (provayder sozlangan). Faqat holat olinadi — ID lar sessiya javobidan.
   * Bitta provayder sozlanmagan/xato bo'lsa faqat o'sha karta "Mavjud emas" bo'ladi, qolganlari ishlayveradi.
   */
  async function loadAdConfig(force) {
    if (state.adsBusy) return;
    if (!force && Date.now() - state.adsAt < (state.adsLoaded ? 30000 : 5000)) return;
    state.adsBusy = true;
    try {
      const res = await api('GET', '/api/ads/config');
      state.adsAt = Date.now();
      if (!ok(res)) return;
      const d = res.data;
      adUnits.forEach((u) => {
        const c = u.placement === 'quick' ? d.quick : d.providers && d.providers[u.provider];
        u.enabled = Boolean(c && c.enabled);
      });
      state.adsLoaded = true;
    } finally {
      state.adsBusy = false;
      updateWatchState();
    }
  }

  // ---------- Reklama tugmasi holati ----------
  function updateWatchState() {
    const now = Date.now();
    const secs = (t) => Math.max(0, Math.ceil((t - now) / 1000));
    const ready = state.loaded && state.adsLoaded;
    adUnits.forEach((u) => {
      const cd = secs(u.coolUntil);
      const noAd = secs(u.noAdUntil);
      const mine = state.active === u;
      const off = ready && u.enabled === false;
      // bir vaqtda bitta reklama (server ham bitta PENDING sessiya ushlaydi)
      u.btn.disabled = state.busy || !ready || off || cd > 0 || noAd > 0;
      if (u.placement === 'quick') {
        u.btn.classList.toggle('busy', state.busy);
        u.label.textContent = state.busy ? '…' : cd > 0 ? cd + 's' : noAd > 0 ? noAd + 's' : '+' + nf.format(state.diamondPerAd);
        return;
      }
      u.btn.classList.toggle('busy', state.busy && mine);
      u.card.classList.toggle('off', off);
      if (state.busy && mine) tx(u.label, state.busyLabel || 'watch.loading');
      else if (!ready) tx(u.label, 'watch.loading');
      else if (off) tx(u.label, 'watch.off');
      else if (cd > 0) tx(u.label, 'watch.cooldown', { n: cd });
      else if (noAd > 0) tx(u.label, 'watch.no_ad', { n: noAd });
      else tx(u.label, 'watch.task_btn');
    });
    // Mavjud emas kartalar ro'yxat oxiriga tushadi; tepada nechta video tayyorligi ko'rsatiladi
    const slots = adUnits.filter((u) => u.placement === 'task');
    slots.forEach((u) => { u.card.style.order = ready && u.enabled === false ? '1' : '0'; });
    const rc = $('adReadyCount');
    if (rc) {
      rc.hidden = !ready;
      if (ready) tx(rc, 'tasks.ad_ready', { n: slots.filter((u) => u.enabled !== false).length });
    }
    updateConvertState();
  }

  /** Provayder reklama bermasa (no fill / SDK yo'q) FAQAT shu joyning tugmasi NO_AD_RETRY_MS ga o'chadi, keyin o'zi qayta yoqiladi. */
  const NO_AD_RETRY_MS = 60000;
  function markNoAd() {
    const u = state.active;
    if (u) u.noAdUntil = Date.now() + NO_AD_RETRY_MS;
    updateWatchState();
  }

  function startCooldown(ms) {
    const u = state.active;
    if (u && ms > 0) u.coolUntil = Date.now() + ms; // faqat shu joy kutadi, qolganlari mustaqil
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




  // ---------- Reklama oqimi ----------
  // Server tasdig'i (AdsGram Reward URL) kutilayotgan bo'lsa sessiya holatini so'rab turadi
  /** Balanslar va kurslar: faqat serverdan (/api/users/me/stats). Klient hech narsani hisoblamaydi. */
  async function refresh() {
    const res = await api('GET', '/api/users/me/stats');
    if (!ok(res)) return false;
    state.statsOk = true;
    const d = res.data;
    if (Number.isInteger(d.diamondPerAd) && d.diamondPerAd > 0) state.diamondPerAd = d.diamondPerAd;
    loadAdConfig(false); // karta holatlari (provayder sozlanganmi); o'zi throttle qiladi
    const cr = d.convertRate;
    if (cr && [cr.diamonds, cr.rush, cr.stepDiamonds, cr.stepRush].every((x) => Number.isInteger(x) && x > 0)) {
      state.rate = { d: cr.diamonds, r: cr.rush, sd: cr.stepDiamonds, sr: cr.stepRush };
    }
    if (Number.isInteger(d.referralDiamondReward) && d.referralDiamondReward > 0) state.referralDiamondReward = d.referralDiamondReward;
    if (Number.isInteger(d.adsWatched)) { state.adsWatched = d.adsWatched; setNum($('pAdsWatched'), d.adsWatched, false); }
    setBalances(d, false);
    renderRates();
    renderShopList();
    return true;
  }

  /** Kurslar va mukofotlar (qiymatlar serverdan: config). */
  function renderRates() {
    const rate = tt('home.rate', { d: nf.format(state.rate.d), r: nf.format(state.rate.r) });
    plain($('convRate'), rate);
    adUnits.forEach((u) => { if (u.reward) u.reward.textContent = '+' + nf.format(state.diamondPerAd) + ' 💎'; });
    $('taskRefReward').textContent = '+' + nf.format(state.referralDiamondReward) + ' 💎';
    $('refReward').textContent = '+' + nf.format(state.referralDiamondReward) + ' 💎';
    if (!state.busy) adUnits.forEach((u) => { if (u.plus) u.plus.textContent = '+' + nf.format(state.diamondPerAd) + ' 💎'; });
    updateConvertState();
  }

  // ---------- Do'kon ro'yxatini yuklash (Home'da preview yo'q; Do'kon sahifasi shu ma'lumotdan foydalanadi) ----------
  async function loadShopPreview() {
    const res = await api('GET', '/api/shop/products');
    if (!ok(res) || !Array.isArray(res.data.items)) return false;
    state.shopItems = res.data.items;
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
    renderOrdersCount();
  }

  /** Profildagi «Buyurtmalarim» kartasi: yuklangan buyurtmalar soni (20 tadan ko'p bo'lsa «20+»). */
  function renderOrdersCount() {
    const n = $('pOrdersCount');
    if (!n || !orders.loaded) return;
    if (orders.cursor) { n.dataset.v = String(orders.items.length); n.textContent = nf.format(orders.items.length) + '+'; return; }
    setNum(n, orders.items.length, false);
  }

  /** Karta bosilganda Do'kon sahifasidagi buyurtmalar ro'yxatiga o'tadi. */
  function initOrdersCard() {
    const card = $('profOrdersCard');
    if (!card) return;
    const open = () => {
      go('shop');
      requestAnimationFrame(() => {
        const box = $('shopOrders');
        const target = box && box.closest('.card');
        if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
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
    for (let i = 0; i < 24; i += 1) { // ~60 soniya: Monetag postbacki ba'zan kechikib keladi
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
    haptic('success');
    const u = state.active;
    if (u && u.card) {
      const btn = u.btn;
      btn.classList.add('ok');
      setTimeout(() => btn.classList.remove('ok'), 1400);
      if (u.plus) {
        u.plus.textContent = '+' + nf.format(gained) + ' 💎';
        u.plus.classList.remove('go');
        void u.plus.offsetWidth;
        u.plus.classList.add('go');
      }
      burstSparks(u.card.querySelector('.cta-wrap'));
    }
    if (data && Number.isInteger(data.diamonds)) setBalances({ diamonds: data.diamonds }, true);
    if (state.cooldownMs) startCooldown(state.cooldownMs);
  }

  // ---------- Provayder SDK lari: har biri o'z skripti va o'z ID si bilan, bir-biridan mustaqil ----------
  // Har bir runner natijasi: { status: 'done' | 'closed' | 'error' | 'unavailable', why? }.
  // 'done' — "reklama ko'rsatildi" xolos; olmos FAQAT server tasdig'idan keyin beriladi (POST /api/ads/reward + provayder postbacki).
  const ID_RE = /^\d{1,12}$/;
  const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/i;
  const errWhy = (e) => String((e && (e.message || e.description || e.state)) || e || 'unknown').slice(0, 140);
  const sdkLoads = new Map(); // kalit -> Promise (skript bir marta yuklanadi; xatoda kalit o'chadi, qayta urinish mumkin)

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  async function waitFor(test, ms) {
    const t0 = Date.now();
    while (!test() && Date.now() - t0 < ms) await sleep(100);
    return test();
  }

  /** Provayder skriptini yuklaydi (bitta kalit = bitta skript). attrs.src majburiy. isReady() — global tayyormi. */
  function loadSdk(key, attrs, isReady, ms) {
    if (isReady()) return Promise.resolve();
    const known = sdkLoads.get(key);
    if (known) return known;
    const p = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.async = true;
      Object.keys(attrs).forEach((k) => sc.setAttribute(k, attrs[k]));
      const fail = (msg) => { clearTimeout(timer); sc.remove(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail('SDK timeout'), ms);
      sc.onload = () => { waitFor(isReady, 2000).then((r) => (r ? (clearTimeout(timer), resolve()) : fail('SDK not ready'))); };
      sc.onerror = () => fail('SDK load failed');
      document.head.appendChild(sc);
    });
    sdkLoads.set(key, p);
    p.catch(() => { sdkLoads.delete(key); });
    return p;
  }

  /** AdsGram SDK (defer) tayyor bo'lguncha kutadi; ms ichida chiqmasa null. */
  async function waitAdsgram(ms) {
    const t0 = Date.now();
    while (!window.Adsgram && Date.now() - t0 < ms) await sleep(100);
    return window.Adsgram || null;
  }

  /** AdsGram: window.Adsgram.init({ blockId }).show() — blockId faqat shu joyning sessiya javobidan (task yoki quick). */
  async function runAdsgram(cfg) {
    const blockId = cfg && cfg.blockId ? String(cfg.blockId) : '';
    if (!blockId) return { status: 'unavailable' };
    // sad.min.js "defer" bilan yuklanadi — sekin tarmoqda hali tayyor bo'lmasligi mumkin, biroz kutamiz
    const sdk = await waitAdsgram(4000);
    if (!sdk) return { status: 'unavailable' };
    // Har ko'rsatishda YANGI controller: xatodan/yopilgandan keyin eski controller buzuq holatda qolib, keyingi reklamani yopib yuborishi mumkin edi.
    let ctrl;
    try { ctrl = sdk.init({ blockId }); } catch (e) { console.warn('[AdsGram] init xatosi:', e); return { status: 'unavailable' }; }
    let result;
    try {
      result = await ctrl.show();
    } catch (e) {
      result = e; // AdsGram xatoda ham result obyektini reject qiladi
    }
    if (result && result.done) return { status: 'done' };
    try { if (ctrl && typeof ctrl.destroy === 'function') ctrl.destroy(); } catch (_e) { /* allaqachon yopilgan */ }
    console.warn('[AdsGram] reklama tugallanmadi:', result);
    const why = result ? [result.state, result.description].filter(Boolean).join(': ').slice(0, 140) : '';
    // Haqiqiy AdsGram xatosi (reklama topilmadi / yuklanmadi) yoki foydalanuvchi o'zi yopdi / o'tkazib yubordi
    if (result && result.error === true) return { status: 'error', why: why || 'unknown' };
    return { status: 'closed', why };
  }

  /**
   * Monetag (TMA SDK): <script data-zone="ZONE" data-sdk="show_ZONE"> global show_ZONE({ ymid, requestVar }) yaratadi.
   * ymid = bizning sessiya UUID imiz (server postbackda shu orqali sessiyani topadi). Rewarded Interstitial erta yopilganda ham
   * resolve bo'ladi — shuning uchun natija mukofot uchun ISHLATILMAYDI; mukofotni faqat Monetag server postbacki beradi.
   */
  async function runMonetag(cfg) {
    const zoneId = cfg && cfg.zoneId ? String(cfg.zoneId) : '';
    const sdkUrl = cfg && cfg.sdkUrl ? String(cfg.sdkUrl) : '';
    const ymid = cfg && cfg.ymid ? String(cfg.ymid) : '';
    if (!ID_RE.test(zoneId) || !HTTPS_RE.test(sdkUrl) || !ymid) return { status: 'unavailable' };
    const fn = 'show_' + zoneId;
    try {
      await loadSdk('monetag:' + zoneId + ':' + sdkUrl, { src: sdkUrl, 'data-zone': zoneId, 'data-sdk': fn }, () => typeof window[fn] === 'function', 8000);
    } catch (e) {
      console.warn('[Monetag] SDK yuklanmadi:', e);
      return { status: 'unavailable' };
    }
    let result;
    try {
      result = await window[fn]({ ymid, requestVar: String(cfg.requestVar || '') });
    } catch (e) {
      console.warn('[Monetag] reklama ko\'rsatilmadi:', e);
      return { status: 'error', why: errWhy(e) };
    }
    // Hujjat: foydalanuvchi reklamani erta yopsa ham promise resolve bo'ladi; non_valued = mukofot yo'q (faqat UX, qaror serverda)
    if (result && result.reward_event_type === 'non_valued') return { status: 'closed' };
    return { status: 'done' };
  }

  /**
   * OnClickA (TMA video): window.initCdTma({ id: SPOT-ID }) -> show funksiyasi; show() Promise reklama ko'rsatilganini bildiradi.
   * Hujjatda reward ID/imzo yo'q: tasdiq faqat server tomonidan (?USERID=) keladi — olmos shundan keyin beriladi.
   */
  const onclickaShows = new Map(); // spotId -> Promise<show>
  async function runOnclicka(cfg) {
    const spotId = cfg && cfg.spotId ? String(cfg.spotId) : '';
    const sdkUrl = cfg && cfg.sdkUrl ? String(cfg.sdkUrl) : '';
    if (!ID_RE.test(spotId) || !HTTPS_RE.test(sdkUrl)) return { status: 'unavailable' };
    let show;
    try {
      await loadSdk('onclicka:' + sdkUrl, { src: sdkUrl }, () => typeof window.initCdTma === 'function', 8000);
      let p = onclickaShows.get(spotId);
      if (!p) {
        p = Promise.resolve(window.initCdTma({ id: Number(spotId) }));
        onclickaShows.set(spotId, p);
      }
      try {
        show = await withTimeout(p, 10000);
      } catch (e) {
        onclickaShows.delete(spotId);
        throw e;
      }
      if (typeof show !== 'function') { onclickaShows.delete(spotId); throw new Error('show funksiyasi yo\'q'); }
    } catch (e) {
      console.warn('[OnClickA] SDK tayyor emas:', e);
      return { status: 'unavailable' };
    }
    let result;
    try {
      result = await show();
    } catch (e) {
      console.warn('[OnClickA] reklama ko\'rsatilmadi:', e);
      return { status: 'error', why: errWhy(e) };
    }
    if (result === false) return { status: 'closed' };
    return { status: 'done' };
  }

  const AD_RUNNERS = { adsgram: runAdsgram, monetag: runMonetag, onclicka: runOnclicka };

  async function watchAd(unit) {
    if (state.busy || state.gated || !unit || unit.enabled === false || !AD_RUNNERS[unit.provider]) return;
    state.active = unit; // qaysi joydan bosildi
    adUnits.forEach((u) => { if (u.msg) { u.msg.className = 'msg center'; plain(u.msg, ''); } });
    setBusy(true, 'watch.preparing');
    say('');
    haptic('light');
    if (atLeast('6.2')) tgTry(() => tg.enableClosingConfirmation());
    try {
      // Sessiya shu (provider, placement) uchun ochiladi; javobda FAQAT shu provayderning identifikatorlari qaytadi
      const s = await api('POST', '/api/ads/session', { provider: unit.provider, placement: unit.placement }, { retry: false });
      if (!ok(s)) {
        if (s.data && s.data.reason === 'PROVIDER_UNAVAILABLE') { unit.enabled = false; state.adsAt = 0; } // faqat shu joy "Mavjud emas"
        say(failKey(s), 'bad');
        haptic('error');
        return;
      }
      const sess = s.data;
      if (sess.provider !== unit.provider || sess.placement !== unit.placement) { say('watch.unavailable', 'bad'); markNoAd(); return; }

      setBusy(true, 'watch.showing');
      const out = await AD_RUNNERS[unit.provider](sess[unit.provider]);
      if (out.status === 'unavailable') { say('watch.unavailable', 'bad'); markNoAd(); return; }
      if (out.status === 'error') {
        say('watch.ad_error', 'bad', { d: out.why || 'unknown' });
        markNoAd(); // reklama yo'q/yuklanmadi -> faqat shu tugma bosilmaydigan bo'ladi
        haptic('warning');
        return;
      }
      if (out.status === 'closed') {
        if (out.why) say('watch.not_finished_d', 'bad', { d: out.why }); else say('watch.not_finished', 'bad');
        haptic('warning');
        return;
      }

      // Klient faqat "ko'rdim" deydi — hisoblash qarori serverda (validatsiya + provayder tasdig'i + tranzaksiya)
      setBusy(true, 'watch.checking');
      const r = await api('POST', '/api/ads/reward', { sessionId: sess.sessionId }, { retry: false });
      if (ok(r)) {
        if (r.data.status === 'PENDING_CONFIRMATION') {
          setBusy(true, 'watch.confirming');
          say('watch.wait_confirm');
          if (await waitConfirmation(sess.sessionId)) celebrate(null);
          else { say('watch.no_confirm', 'bad'); haptic('warning'); }
        } else if (r.data.status === 'REWARDED' && r.data.counted === false) {
          celebrate(null); // Monetag: server postbacki claimdan oldin kelib olmosni allaqachon bergan
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

  /** Olmos -> Rush (qadamning karraligida bo'lsa), aks holda 0. Kurs va qadam serverdan keladi. */
  function convRush(n) { return n > 0 && n % state.rate.sd === 0 ? (n / state.rate.sd) * state.rate.sr : 0; }

  function updateConvertState() {
    const b = $('convBtn');
    if (!b) return;
    const n = convAmount();
    b.disabled = conv.busy || !state.loaded || n <= 0 || convRush(n) <= 0;
    b.classList.toggle('busy', conv.busy);
    if (n > 0 && convRush(n) > 0) tx($('convPreview'), 'tasks.conv_get', { n: nf.format(convRush(n)) });
    else if (n > 0) tx($('convPreview'), 'tasks.conv_step', { n: nf.format(state.rate.sd) });
    else plain($('convPreview'), '');
  }

  async function convertDiamonds() {
    if (conv.busy || state.gated) return;
    const n = convAmount();
    convSay('');
    if (!n) { convSay('tasks.conv_bad', 'bad'); haptic('error'); return; }
    if (convRush(n) <= 0) { convSay('tasks.conv_step', 'bad', { n: nf.format(state.rate.sd) }); haptic('error'); return; }
    if (n > state.diamonds) { convSay('reason.INSUFFICIENT_FUNDS', 'bad'); haptic('error'); return; } // tezkor xabar; haqiqiy tekshiruv serverda
    if (!(await confirmBox(tt('tasks.conv_confirm', { d: nf.format(n), r: nf.format(convRush(n)) })))) return;

    conv.busy = true;
    updateConvertState();
    if (!conv.reqId) conv.reqId = uuid(); // tarmoq xatosidan keyin shu id bilan qayta uriniladi (idempotent)
    try {
      const r = await api('POST', '/api/coins/convert', { diamonds: n, requestId: conv.reqId }, { retry: false });
      if (ok(r)) {
        conv.reqId = null;
        setBalances(r.data, true);
        coinHist.loadedAt = 0;
        const got = r.data.converted && Number.isInteger(r.data.converted.rush) ? r.data.converted.rush : convRush(n);
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
      const maxN = Math.floor(state.diamonds / state.rate.sd) * state.rate.sd; // qadamning karraligidagi eng katta miqdor
      input.value = maxN > 0 ? String(maxN) : '';
      conv.reqId = null;
      haptic('select');
      convSay('');
      updateConvertState();
    });
    $('convBtn').addEventListener('click', convertDiamonds);
  }

  // ---------- Hamyon (Profil): so'm balans, to'ldirish va Rush Coin sotib olish ----------
  // Klient faqat so'm miqdori (to'ldirish) yoki tanga miqdori + requestId (sotib olish) yuboradi. Kurs va paketlar serverdan
  // (/api/wallet/config); klientdagi narx faqat ko'rsatish uchun. So'm balans FAQAT serverga Telegram to'lovi yetgach ko'payadi.
  const wallet = { cfg: null, loadedAt: 0, loading: false, busy: false, buyBusy: false, reqId: null, reqCoins: 0 };

  const uzsText = (n) => tt('wallet.uzs', { n: nf.format(n) });
  const digits = (id) => { const v = $(id).value.trim(); return /^\d{1,10}$/.test(v) ? Number(v) : 0; };

  function walletSay(id, key, kind, vars) {
    const m = $(id);
    if (key) tx(m, key, vars); else plain(m, '');
    m.className = 'msg center' + (kind ? ' ' + kind : '');
  }

  async function loadWalletConfig(force) {
    if (wallet.loading || (!force && wallet.cfg && Date.now() - wallet.loadedAt < 60000)) return;
    wallet.loading = true;
    try {
      const res = await api('GET', '/api/wallet/config');
      if (!ok(res)) return;
      const d = res.data;
      const valid = [d.coinPriceUzs, d.topupMinUzs, d.coinBuyMin].every((x) => Number.isInteger(x) && x > 0) && Array.isArray(d.packages);
      wallet.cfg = valid ? {
        enabled: Boolean(d.enabled), price: d.coinPriceUzs, topupMin: d.topupMinUzs, coinMin: d.coinBuyMin,
        packages: d.packages.filter((x) => Number.isInteger(x) && x > 0),
      } : null;
      wallet.loadedAt = Date.now();
      renderWallet();
    } finally {
      wallet.loading = false;
    }
  }

  function renderPacks() {
    const box = $('coinPacks');
    const cur = digits('coinAmount');
    box.replaceChildren();
    if (!wallet.cfg) return;
    for (const c of wallet.cfg.packages) {
      const b = el('button', 'btn sm' + (c === cur ? '' : ' sec'), '🪙 ' + nf.format(c));
      b.type = 'button';
      b.disabled = wallet.busy || wallet.buyBusy;
      b.addEventListener('click', () => {
        $('coinAmount').value = String(c);
        $('buyTopup').hidden = true;
        walletSay('buyMsg', '');
        haptic('select');
        renderPacks();
        updateWalletState();
      });
      box.appendChild(b);
    }
  }

  function updateWalletState() {
    const cfg = wallet.cfg;
    if (!cfg || !$('buyBtn')) return;
    const busy = wallet.busy || wallet.buyBusy;
    $('walletPlus').disabled = busy;
    $('topupGo').disabled = busy || digits('topupAmount') < cfg.topupMin;
    $('topupGo').classList.toggle('busy', wallet.busy);
    const n = digits('coinAmount');
    $('buyBtn').disabled = busy || n < cfg.coinMin;
    $('buyBtn').classList.toggle('busy', wallet.buyBusy);
    if (n >= cfg.coinMin) tx($('buyPreview'), 'wallet.buy_cost', { n: nf.format(n), p: uzsText(n * cfg.price) });
    else if (n > 0) tx($('buyPreview'), 'wallet.buy_min', { n: nf.format(cfg.coinMin) });
    else plain($('buyPreview'), '');
    $('coinPacks').querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  }

  /** Karta faqat wallet yoqilgan bo'lsa ko'rinadi; til o'zgarganda ham shu yerdan qayta chiziladi. */
  function renderWallet() {
    const cfg = wallet.cfg;
    const card = $('walletCard');
    if (!card) return;
    card.hidden = !(cfg && cfg.enabled);
    if (card.hidden) { if (state.view === 'buy') go('profile'); return; }
    plain($('walletRate'), tt('wallet.rate', { p: uzsText(cfg.price) }));
    tx($('topupLabel'), 'wallet.topup_label', { n: nf.format(cfg.topupMin) });
    tx($('coinLabel'), 'wallet.coin_label', { n: nf.format(cfg.coinMin) });
    renderPacks();
    updateWalletState();
  }

  /** Sotib olish sahifasiga kirganda: xabarlar tozalanadi, balanslar ko'rsatiladi, config yangilanadi. */
  function enterBuy() {
    if (wallet.buyBusy) return;
    walletSay('buyMsg', '');
    $('buyTopup').hidden = true;
    setBalances({ rushCoins: state.coins, balanceUzs: state.uzs }, false);
    loadWalletConfig(false).catch(() => {});
    updateWalletState();
  }

  function openTopup(show) {
    $('topupPanel').hidden = !show;
    if (show) {
      $('topupAmount').value = '';
      walletSay('topupMsg', '');
      updateWalletState();
      tgTry(() => $('topupAmount').focus());
    }
  }

  function openInvoice(url) {
    return new Promise((resolve) => {
      try { tg.openInvoice(url, (s) => resolve(String(s))); } catch (_e) { resolve('failed'); }
    });
  }

  /** To'lov PAID bo'lguncha ~15 soniya (1.5s oralig'ida) so'raydi. Holat faqat serverdan. */
  async function waitPayment(id) {
    const until = Date.now() + 15000;
    for (;;) {
      const r = await api('GET', '/api/wallet/payments/' + encodeURIComponent(id), null, { retry: false });
      const st = ok(r) ? r.data.status : null;
      if (st === 'PAID' || st === 'FAILED' || st === 'CANCELLED') return { status: st, amountUzs: r.data.amountUzs };
      if (Date.now() >= until) return { status: 'PENDING', amountUzs: 0 };
      await sleep(1500);
    }
  }

  async function startTopup() {
    if (wallet.busy || wallet.buyBusy || state.gated || !wallet.cfg) return;
    const amount = digits('topupAmount');
    walletSay('topupMsg', '');
    if (amount < wallet.cfg.topupMin) { walletSay('topupMsg', 'wallet.topup_min', 'bad', { n: nf.format(wallet.cfg.topupMin) }); haptic('error'); return; }
    if (!(tg && typeof tg.openInvoice === 'function' && atLeast('6.1'))) { walletSay('topupMsg', 'wallet.no_invoice', 'bad'); haptic('error'); return; }
    wallet.busy = true;
    updateWalletState();
    try {
      const r = await api('POST', '/api/wallet/topup', { amountUzs: amount }, { retry: false });
      if (!ok(r) || typeof r.data.invoiceUrl !== 'string' || !r.data.paymentId) {
        walletSay('topupMsg', r.status === 0 ? 'err.network' : reasonKey(r.data && r.data.reason, 'wallet.topup_failed'), 'bad');
        haptic('error');
        return;
      }
      const status = await openInvoice(r.data.invoiceUrl);
      if (status === 'cancelled') { walletSay('topupMsg', 'wallet.topup_cancelled', ''); return; }
      if (status !== 'paid' && status !== 'pending') { walletSay('topupMsg', 'wallet.topup_failed', 'bad'); haptic('error'); return; }
      walletSay('topupMsg', 'wallet.topup_wait', '');
      const p = await waitPayment(r.data.paymentId);
      await refresh().catch(() => {}); // balans serverdan
      coinHist.loadedAt = 0;
      if (p.status === 'PAID') {
        openTopup(false);
        toast(tt('wallet.topup_done', { n: uzsText(p.amountUzs || amount) }), false);
        haptic('success');
        loadCoinHistory(false).catch(() => {});
      } else if (p.status === 'PENDING') {
        walletSay('topupMsg', 'wallet.topup_pending', '');
      } else {
        walletSay('topupMsg', p.status === 'CANCELLED' ? 'wallet.topup_cancelled' : 'wallet.topup_failed', p.status === 'FAILED' ? 'bad' : '');
      }
    } catch (_e) {
      walletSay('topupMsg', 'err.unexpected', 'bad');
    } finally {
      wallet.busy = false;
      updateWalletState();
    }
  }

  async function buyCoins() {
    if (wallet.buyBusy || wallet.busy || state.gated || !wallet.cfg) return;
    const n = digits('coinAmount');
    walletSay('buyMsg', '');
    $('buyTopup').hidden = true;
    if (n < wallet.cfg.coinMin) { walletSay('buyMsg', 'wallet.buy_min', 'bad', { n: nf.format(wallet.cfg.coinMin) }); haptic('error'); return; }
    if (!(await confirmBox(tt('wallet.buy_confirm', { n: nf.format(n), p: uzsText(n * wallet.cfg.price) })))) return; // narx faqat ko'rsatish uchun
    wallet.buyBusy = true;
    updateWalletState();
    if (!wallet.reqId || wallet.reqCoins !== n) { wallet.reqId = uuid(); wallet.reqCoins = n; } // tarmoq xatosidan keyin shu id bilan qayta uriniladi
    try {
      const r = await api('POST', '/api/wallet/buy-coins', { coins: n, requestId: wallet.reqId }, { retry: false });
      if (ok(r)) {
        wallet.reqId = null;
        setBalances(r.data, true);
        coinHist.loadedAt = 0;
        $('coinAmount').value = '';
        renderPacks();
        const got = r.data.bought && Number.isInteger(r.data.bought.coins) ? r.data.bought.coins : n;
        toast(tt('wallet.buy_done', { n: nf.format(got) }), false);
        haptic('success');
        loadCoinHistory(false).catch(() => {});
      } else if (r.status === 0) {
        walletSay('buyMsg', 'err.network', 'bad'); // reqId saqlanadi
        haptic('error');
      } else {
        const d = r.data || {};
        if (r.status < 500) wallet.reqId = null; // server aniq javob berdi — keyingi urinish yangi so'rov
        setBalances(d, false);
        if (d.reason === 'INSUFFICIENT_FUNDS') { walletSay('buyMsg', 'reason.INSUFFICIENT_FUNDS', 'bad'); $('buyTopup').hidden = false; }
        else if (d.reason === 'DUPLICATE_REQUEST') { coinHist.loadedAt = 0; walletSay('buyMsg', 'wallet.buy_duplicate', 'bad'); }
        else walletSay('buyMsg', reasonKey(d.reason, 'wallet.buy_failed'), 'bad');
        haptic('error');
        refresh().catch(() => {});
      }
    } catch (_e) {
      walletSay('buyMsg', 'err.unexpected', 'bad');
    } finally {
      wallet.buyBusy = false;
      updateWalletState();
    }
  }

  function initWallet() {
    $('walletPlus').addEventListener('click', (e) => { e.stopPropagation(); haptic('light'); openTopup($('topupPanel').hidden); });
    const stat = $('walletStat'); // so'm kartasini bosish — tanga sotib olish sahifasi
    stat.addEventListener('click', () => go('buy'));
    stat.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('buy'); } });
    $('topupCancel').addEventListener('click', () => openTopup(false));
    $('topupGo').addEventListener('click', startTopup);
    $('topupAmount').addEventListener('input', () => {
      const input = $('topupAmount');
      const clean = input.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
      if (clean !== input.value) input.value = clean;
      walletSay('topupMsg', '');
      updateWalletState();
    });
    $('coinAmount').addEventListener('input', () => {
      const input = $('coinAmount');
      const clean = input.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
      if (clean !== input.value) input.value = clean;
      walletSay('buyMsg', '');
      $('buyTopup').hidden = true;
      renderPacks();
      updateWalletState();
    });
    $('buyBtn').addEventListener('click', buyCoins);
    $('buyTopup').addEventListener('click', () => {
      haptic('light');
      openTopup(true); // so'm to'ldirish — shu sahifada
      $('topupPanel').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
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

  // Yuborish chegarasi (server bilan bir xil: min 100, max 1 000 000). Haqiqiy tekshiruv serverda; server boshqa chegara qaytarsa shu yerda yangilanadi.
  const sendLimits = { min: 100, max: 1000000 };
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
    if (amount < sendLimits.min || amount > sendLimits.max) { sendSay('send.range', 'bad', { min: nf.format(sendLimits.min), max: nf.format(sendLimits.max) }); haptic('error'); return; }
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
          sendLimits.min = d.min; sendLimits.max = d.max;
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
        const a = sendAmount();
        if (id === 'sendAmount' && a > 0 && (a < sendLimits.min || a > sendLimits.max)) sendSay('send.range', 'bad', { min: nf.format(sendLimits.min), max: nf.format(sendLimits.max) });
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
    const uzs = t.currency === 'UZS';
    const diamond = t.currency === 'DIAMOND';
    const row = el('div', 'row tx');
    const name = el('span', 'name');
    name.append(el('span', null, i18n.has('tx.' + t.type) ? tt('tx.' + t.type) : t.type), el('small', 'tx-date', new Date(t.createdAt).toLocaleString(i18n.locale, DATE_FMT)));
    row.append(name, el('span', 'val ' + (t.amount > 0 ? 'pos' : 'neg'), (t.amount > 0 ? '+' : '') + (uzs ? uzsText(t.amount) : nf.format(t.amount) + (diamond ? ' 💎' : ' 🪙'))));
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
    registerAdUnits();
    initLang();
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    initConvert();
    $('shopOrdersMore').addEventListener('click', () => loadOrders(true).catch(() => {}));
    initReferral();
    initOrdersCard();
    initSend();
    initWallet();
    initSubGate();
    $('coinHistMore').addEventListener('click', () => loadCoinHistory(true).catch(() => {}));
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
    if (!state.gated && ok(subR) && subR.data.required && !subR.data.subscribed) gate('subscribe', channelsOf(subR.data));
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
    document.querySelectorAll('[data-v]').forEach((n) => { n.textContent = numText(n, Number(n.dataset.v)); });
    document.querySelectorAll('.csheet').forEach((n) => { (n.closest('.sheet-bg') || n).remove(); }); // ochiq oyna eski tilda qolmasin
    renderRates();
    renderShopList();
    renderOrders();
    renderProfile();
    renderWallet();
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

  window.AdRush = { api, el, nf: nfFixed, tg, state, toast, confirmBox, who, go, stateNode, skeleton, haptic, setBack, syncNav, reduceMotion, setNum, currentTheme, refresh, setBalances };

  init();
})();