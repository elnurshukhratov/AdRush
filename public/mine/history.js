'use strict';

/**
 * AdRush — Do'kon > «Tarix» (ommaviy). Faqat admin topshirilganini tasdiqlagan VA isbot rasmini yuklagan sovg'alarning
 * eng so'nggi 10 tasi (server GET /api/shop/history shuni ta'minlaydi; klient hech narsani filtrlamaydi, faqat ko'rsatadi).
 * mine.js dan keyin yuklanadi va window.AdRush / window.AdRushI18n orqali ishlaydi (admin.js kabi alohida modul).
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q); rasm faqat bizning /uploads/proofs/... yo'li bo'lsa chiqadi.
 */
(function () {
  const A = window.AdRush;
  const I = window.AdRushI18n;
  if (!A || !I) return;

  const $ = (id) => document.getElementById(id);
  const { api, el, skeleton } = A;

  const DICT = {
    uz: {
      tab_store: '🛍 Do‘kon',
      tab_history: '📜 Tarix',
      aria: 'Do‘kon bo‘limlari',
      title: '📜 Sovg‘alar tarixi',
      hint: 'Admin tomonidan topshirilgani tasdiqlangan oxirgi 10 ta sovg‘a.',
      empty: 'Tarix hozircha bo‘sh',
      empty_hint: 'Topshirilgan va tasdiqlangan sovg‘alar shu yerda ko‘rinadi.',
      fail: 'Tarixni yuklab bo‘lmadi',
      check: 'Internet aloqasini tekshiring.',
      retry: 'Qayta urinish',
      to: '👤 Oluvchi: {u}',
      date: '✅ Tasdiqlangan: {d}',
      proof: 'Topshirilganini tasdiqlovchi rasm',
    },
    ru: {
      tab_store: '🛍 Магазин',
      tab_history: '📜 История',
      aria: 'Разделы магазина',
      title: '📜 История подарков',
      hint: 'Последние 10 подарков, выдача которых подтверждена администратором.',
      empty: 'История пока пуста',
      empty_hint: 'Выданные и подтверждённые подарки появятся здесь.',
      fail: 'Не удалось загрузить историю',
      check: 'Проверьте подключение к интернету.',
      retry: 'Повторить',
      to: '👤 Получатель: {u}',
      date: '✅ Подтверждено: {d}',
      proof: 'Фото подтверждения выдачи',
    },
    en: {
      tab_store: '🛍 Shop',
      tab_history: '📜 History',
      aria: 'Shop sections',
      title: '📜 Gift history',
      hint: 'The 10 latest gifts whose delivery was confirmed by an admin.',
      empty: 'No history yet',
      empty_hint: 'Delivered and confirmed gifts will appear here.',
      fail: 'Could not load the history',
      check: 'Check your internet connection.',
      retry: 'Retry',
      to: '👤 Recipient: {u}',
      date: '✅ Confirmed: {d}',
      proof: 'Delivery proof photo',
    },
  };

  function t(key, vars) {
    let s = (DICT[I.lang] && DICT[I.lang][key]) || DICT.uz[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  // Server faqat shu ko'rinishdagi yo'lni qaytaradi; klient ham qayta tekshiradi
  const PROOF_RE = /^\/uploads\/proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
  const DATE_FMT = { dateStyle: 'medium', timeStyle: 'short' };
  const MAX_ITEMS = 10; // server ham 10 tadan ortiq qaytarmaydi; klient ham ortig'ini ko'rsatmaydi

  const hist = { items: [], loading: false, loaded: false, failed: false, at: 0, tab: 'store' };

  const ok = (r) => r.status >= 200 && r.status < 300 && r.data && r.data.success;

  function stateBox(ico, title, text, btnText, onClick) {
    const n = el('div', 'state');
    n.append(el('div', 'state-ico', ico), el('b', null, title));
    if (text) n.appendChild(el('span', 'muted', text));
    if (btnText) {
      const b = el('button', 'btn', btnText);
      b.type = 'button';
      b.addEventListener('click', onClick);
      n.appendChild(b);
    }
    return n;
  }

  function itemNode(o) {
    const c = el('div', 'hist-item');
    c.append(el('b', null, '🎁 ' + o.productTitle));
    c.append(el('div', 'muted', t('to', { u: o.recipient })));
    c.append(el('div', 'muted', t('date', { d: new Date(o.confirmedAt).toLocaleString(I.locale, DATE_FMT) })));
    if (PROOF_RE.test(o.proofImage)) {
      const img = document.createElement('img');
      img.className = 'hist-proof';
      img.alt = t('proof');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = o.proofImage;
      img.onerror = () => img.remove(); // fayl topilmasa singan rasm ko'rinmasin
      c.append(img);
    }
    return c;
  }

  function renderStatic() {
    $('shopTabStore').textContent = t('tab_store');
    $('shopTabHistory').textContent = t('tab_history');
    $('shopSeg').setAttribute('aria-label', t('aria'));
    $('histTitle').textContent = t('title');
    $('histHint').textContent = t('hint');
  }

  function render() {
    renderStatic();
    const box = $('histList');
    if (hist.failed && !hist.items.length) { box.replaceChildren(stateBox('📡', t('fail'), t('check'), t('retry'), () => load(true))); }
    else if (!hist.loaded) { box.replaceChildren(skeleton(3)); }
    else if (!hist.items.length) { box.replaceChildren(stateBox('📜', t('empty'), t('empty_hint'))); }
    else { box.replaceChildren(...hist.items.map(itemNode)); }
    const more = $('histMore');
    if (more) more.hidden = true; // sahifalash yo'q: Tarixda doimo faqat oxirgi 10 ta
  }

  async function load(force) {
    if (hist.loading || (A.state && A.state.gated)) return;
    if (!force && hist.loaded && Date.now() - hist.at < 15000) return;
    hist.loading = true;
    try {
      const res = await api('GET', '/api/shop/history');
      if (!ok(res) || !Array.isArray(res.data.items)) { hist.failed = true; return; }
      hist.failed = false;
      hist.loaded = true;
      hist.at = Date.now();
      // Ro'yxat har safar serverdagi so'nggi 10 ta bilan to'liq almashadi (eski yozuv chiqib ketadi, takror qo'shilmaydi)
      const seen = new Set();
      hist.items = [];
      for (const o of res.data.items) {
        if (seen.has(o.id)) continue; // takroriy yozuv (id bo'yicha) qo'shilmaydi
        seen.add(o.id);
        hist.items.push(o);
        if (hist.items.length >= MAX_ITEMS) break;
      }
    } finally {
      hist.loading = false;
      render();
    }
  }

  function selectTab(tab) {
    hist.tab = tab;
    const isHist = tab === 'history';
    $('shopPaneStore').hidden = isHist;
    $('shopPaneHistory').hidden = !isHist;
    for (const [id, on] of [['shopTabStore', !isHist], ['shopTabHistory', isHist]]) {
      const b = $(id);
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (isHist) { render(); load(false).catch(() => {}); }
    A.haptic('select');
  }

  function init() {
    if (!$('shopSeg') || !$('shopPaneHistory')) return;
    $('shopTabStore').addEventListener('click', () => selectTab('store'));
    $('shopTabHistory').addEventListener('click', () => selectTab('history'));
    window.addEventListener('adrush:langchange', render);

    // Do'kon sahifasi qayta ochilganda (va Tarix tanlangan bo'lsa) ro'yxat yangilanadi
    const view = $('view-shop');
    if (view && window.MutationObserver) {
      new MutationObserver(() => { if (!view.hidden && hist.tab === 'history') load(false).catch(() => {}); })
        .observe(view, { attributes: true, attributeFilter: ['hidden'] });
    }
    render();
  }

  init();
})();