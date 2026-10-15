'use strict';

/**
 * AdRush — Admin bo'limi (Mine App ichida). Bu fayl FAQAT server /api/users/me da isAdmin:true qaytarsa yuklanadi.
 * Bu UI qulayligi uchun xolos: har bir /api/admin/* so'rovi serverda qayta tekshiriladi (oddiy userga 403).
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q).
 */
(function () {
  const A = window.AdRush;
  if (!A) return;
  const { api, nf, tg, toast, confirmBox, stateNode, skeleton, setBack, setNum } = A;

  const STATUS_UZ = {
    PENDING: 'Kutilmoqda', PROCESSING: 'Jarayonda', DELIVERED: 'Yetkazildi', CANCELLED: 'Bekor',
    ACTIVE: 'Faol', INACTIVE: 'Yashirin', OUT: 'Tugagan',
  };
  // Badge ranglari mavjud CSS klasslariga ulanadi (yangi CSS shart emas)
  const BADGE_CLS = { PROCESSING: 'CONTACTED', OUT: 'CANCELLED' };
  const ORDER_STATUSES = ['PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED'];
  const ORDER_ICON = { PENDING: '⏳', PROCESSING: '🔧', DELIVERED: '✅', CANCELLED: '❌' };
  const KIND_UZ = { GIFT: '🎁 Sovg‘a', STARS: '⭐ Stars', PREMIUM: '💎 Premium', CUSTOM: '📦 Boshqa' };
  // Faqat UI uchun (server o'zi ham tekshiradi). DELIVERED / CANCELLED dan keyin holat o'zgarmaydi.
  const NEXT_ORDER = {
    PENDING: ['PROCESSING', 'DELIVERED', 'CANCELLED'],
    PROCESSING: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  const st = { tab: 'dash', root: null, body: null, token: 0, secMode: 'audit', auditKind: 'all', userQ: '', orderStatus: 'ALL' };

  // ---------- Kichik DOM yordamchilari ----------
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return n;
  }
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const badge = (status, label) => h('span', { class: 'badge ' + (BADGE_CLS[status] || status), text: label || STATUS_UZ[status] || status });
  /** Raqam 0 dan qiymatgacha sanab chiqadi (500 ms); reduced-motion da darhol qo'yiladi. */
  function counter(tag, cls, value, compact) {
    const n = h(tag, { class: cls, text: '0' });
    n.dataset.v = '0';
    if (compact) n.dataset.compact = '1'; // 1000 → 1k (to'liq qiymat: ustiga bosib turing)
    setNum(n, value, false);
    return n;
  }
  const nameOf = (u) => (u.username ? '@' + u.username : u.firstName || 'Foydalanuvchi');
  /** Ism, @username va Telegram ID bitta qatorda. */
  const userLine = (u) => [u.firstName, u.username ? '@' + u.username : null].filter(Boolean).join(' ') + ` • ID ${u.telegramId}`;
  /** Mahsulot rasmi (yoki 🛍). */
  const thumb = (url, large) => h('div', { class: 'thumb' + (large ? ' lg' : '') }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : '🛍');

  function msgOf(res, fallback) {
    return (res && res.data && res.data.message) || fallback || 'Xatolik. Qayta urinib ko‘ring.';
  }
  async function call(method, path, body) {
    try {
      return await api(method, '/api/admin' + path, body);
    } catch (_e) {
      return { status: 0, data: null };
    }
  }
  const ok = (res) => res.status >= 200 && res.status < 300 && res.data && res.data.success;

  // ---------- Bottom sheet (forma/dialog) ----------
  function openSheet(title, build) {
    const bg = h('div', { class: 'sheet-bg', role: 'dialog', 'aria-modal': 'true' });
    const sheet = h('div', { class: 'sheet' }, h('h3', { text: title }));
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    sheet.appendChild(build(close));
    bg.appendChild(sheet);
    document.body.appendChild(bg);
    return close;
  }
  function field(label, input) {
    return h('div', { class: 'field' }, h('label', { text: label }), input);
  }

  // ---------- Shell ----------
  /** Menyu ikonkasi: boshqa tablar kabi SVG (stroke: currentColor), emoji emas. */
  function gearIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ]) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '3');
    svg.appendChild(c);
    return svg;
  }

  function mount() {
    if (st.root) return;
    const wrap = document.querySelector('.wrap');
    const nav = document.querySelector('.nav');
    if (!wrap || !nav) return;

    st.root = h('section', { class: 'view', id: 'view-admin', 'data-view': 'admin', hidden: true });
    st.body = h('div', { id: 'admBody' });
    const seg = h('div', { class: 'seg', id: 'admSeg' },
      ...[['dash', '📊 Dashboard'], ['products', '🛍 Mahsulotlar'], ['orders', '📦 Buyurtmalar'], ['coins', '🪙 Tanga'], ['ads', '📺 Reklama'], ['sec', '🛡️ Xavfsizlik'], ['sub', '📢 Kanal']].map(([key, label]) =>
        h('button', { type: 'button', 'data-tab': key, class: key === st.tab ? 'active' : '', text: label, onclick: () => setTab(key) })));
    st.root.append(h('h2', { text: '⚙️ Admin' }), seg, st.body);
    wrap.appendChild(st.root);

    const tab = h('button', { type: 'button', class: 'tab', 'data-go': 'admin', onclick: () => A.go('admin') },
      h('i', null, gearIcon()), h('span', { text: 'Admin' }));
    nav.appendChild(tab);
    A.syncNav();
  }

  function setTab(key) {
    st.tab = key;
    document.querySelectorAll('#admSeg button').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    render();
  }

  function onShow() { render(); }

  function loading() {
    st.body.replaceChildren(skeleton(3, 'tall'));
  }
  function failed(res, retry) {
    const forbidden = res && res.status === 403;
    st.body.replaceChildren(stateNode(forbidden ? '🔒' : '📡', forbidden ? 'Ruxsat yo‘q' : 'Yuklab bo‘lmadi', msgOf(res), forbidden ? null : 'Qayta urinish', retry));
  }

  async function render() {
    if (!st.body) return;
    const my = ++st.token; // eski javob yangisini bosib ketmasin
    const guard = () => my === st.token;
    setBack(null);
    if (st.tab === 'dash') return renderDash(guard);
    if (st.tab === 'ads') return renderAds(guard);
    if (st.tab === 'sec') return renderSecurity(guard);
    if (st.tab === 'sub') return renderSubscription(guard);
    if (st.tab === 'products') return renderProducts(guard);
    if (st.tab === 'coins') return renderCoins(guard);
    return renderOrders(guard);
  }

  // ---------- Dashboard ----------
  function goOrders(status) {
    st.orderStatus = status;
    setTab('orders');
  }

  async function renderDash(guard) {
    loading();
    const res = await call('GET', '/overview');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const d = res.data;
    const by = d.ordersByStatus || {};

    const frag = document.createDocumentFragment();

    // Diqqat talab qiladigan narsalar
    if (by.PENDING) {
      frag.appendChild(h('div', { class: 'alert' }, h('span', { text: '⏳' }),
        h('span', { style: 'flex:1', text: `${nf.format(by.PENDING)} ta buyurtma kutilmoqda` }),
        h('button', { class: 'btn sm sec', type: 'button', text: 'Ko‘rish', onclick: () => goOrders('PENDING') })));
    }
    if (d.suspicious24h) {
      frag.appendChild(h('div', { class: 'alert bad' }, h('span', { text: '🚨' }),
        h('span', { style: 'flex:1', text: `Oxirgi 24 soatda ${nf.format(d.suspicious24h)} ta shubhali hodisa` }),
        h('button', { class: 'btn sm sec', type: 'button', text: 'Ko‘rish', onclick: () => { st.secMode = 'audit'; st.auditKind = 'suspicious'; setTab('sec'); } })));
    }

    const tile = (ico, label, value, tone) => h('div', { class: 'tile pop' + (tone ? ' ' + tone : '') },
      h('div', { class: 'ico', text: ico }), counter('b', '', value, true), h('span', { text: label }));
    frag.appendChild(h('div', { class: 'tiles' },
      tile('👥', 'Jami foydalanuvchilar', d.totalUsers),
      tile('📺', 'Jami valid reklamalar', d.lifetimeValidAds, 'good'),
      tile('💎', 'Jami olmos (balanslarda)', d.totalDiamonds),
      tile('🪙', 'Jami Rush Coin (balanslarda)', d.totalRushCoins),
      tile('⏳', 'Kutilayotgan buyurtmalar', by.PENDING || 0, by.PENDING ? 'warn' : ''),
      tile('🚫', 'Bloklanganlar', d.blocked, d.blocked ? 'bad' : '')));

    const orders = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: '📦 Buyurtmalar holat bo‘yicha' })));
    for (const s of ORDER_STATUSES) {
      orders.appendChild(h('div', { class: 'row', style: 'cursor:pointer', onclick: () => goOrders(s) },
        h('span', { class: 'rk', text: ORDER_ICON[s] }),
        h('span', { class: 'name', text: STATUS_UZ[s] }),
        h('span', { class: 'val', text: nf.format(by[s] || 0) })));
    }
    frag.appendChild(orders);
    st.body.replaceChildren(frag);
  }

  // ---------- Majburiy kanalga obuna ----------
  const SUB_ERR_UZ = {
    BOT_NOT_ADMIN: 'Bot kanalda admin emas',
    CHANNEL_NOT_FOUND: 'Kanal topilmadi',
    INVITE_REQUIRED: 'Maxfiy kanal uchun taklif havolasini kiriting',
    BAD_CHANNEL: 'Manzil noto‘g‘ri',
    CHANNEL_EXISTS: 'Bu kanal allaqachon qo‘shilgan',
    CHANNEL_LIMIT: 'Kanallar soni chegarasiga yetildi (50 ta)',
  };
  /** Backend `reason` (yoki `code`) kodini tushunarli o'zbekcha matnga o'giradi. */
  function subErr(res, fallback) {
    const code = res && res.data && (res.data.reason || res.data.code);
    return SUB_ERR_UZ[code] || fallback;
  }
  function openLink(url) {
    if (tg && typeof tg.openTelegramLink === 'function') { try { tg.openTelegramLink(url); return; } catch (_e) { /* keyingisi */ } }
    if (tg && typeof tg.openLink === 'function') { try { tg.openLink(url); return; } catch (_e) { /* keyingisi */ } }
    window.open(url, '_blank', 'noopener');
  }

  async function renderSubscription(guard) {
    loading();
    const res = await call('GET', '/subscription');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const list = Array.isArray(res.data.channels) ? res.data.channels : (res.data.channel ? [res.data.channel] : []);
    const max = res.data.max || 50;

    const cur = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: '📢 Majburiy obuna (' + list.length + '/' + max + ')' })));
    if (list.length) {
      list.forEach((ch) => {
        const url = ch.inviteUrl || (ch.username ? 'https://t.me/' + ch.username : '');
        const del = h('button', { class: 'btn sm danger', type: 'button', text: '🗑', 'aria-label': 'Kanalni o‘chirish' });
        del.addEventListener('click', async () => {
          if (!(await confirmBox('«' + (ch.title || ch.username || 'Kanal') + '» majburiy obunadan o‘chirilsinmi?'))) return;
          del.disabled = true;
          const r = await call('DELETE', '/subscription/' + encodeURIComponent(ch.id));
          if (!ok(r)) { del.disabled = false; return toast(subErr(r, msgOf(r, 'O‘chirib bo‘lmadi')), true); }
          toast('O‘chirildi');
          render();
        });
        cur.appendChild(h('div', { class: 'prow' },
          h('div', { class: 'thumb', text: '📢' }),
          h('div', { class: 'pb' },
            h('div', { class: 'pt', text: ch.title || (ch.username ? '@' + ch.username : 'Kanal') }),
            h('div', { class: 'ps', text: ch.username ? '@' + ch.username : 'Maxfiy kanal' }),
            url ? h('div', { class: 'ps', text: url }) : null),
          url ? h('button', { class: 'btn sm sec', type: 'button', text: '↗', 'aria-label': 'Kanalni ochish', onclick: () => openLink(url) }) : null,
          del));
      });
    } else {
      cur.appendChild(h('p', { class: 'muted', text: 'Majburiy obuna o‘chiq' }));
    }

    const channel = h('input', { type: 'text', maxlength: '200', placeholder: '@kanal yoki -100...', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const invite = h('input', { type: 'url', maxlength: '300', placeholder: 'https://t.me/+...', autocomplete: 'off' });
    const err = h('p', { class: 'errtxt', role: 'alert' });
    const save = h('button', { class: 'btn block', type: 'button', text: 'Qo‘shish' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      const body = { channel: channel.value.trim() };
      if (!body.channel) { err.textContent = 'Kanal manzilini kiriting.'; return; }
      if (invite.value.trim()) body.inviteUrl = invite.value.trim();
      save.disabled = true;
      const r = await call('POST', '/subscription', body);
      save.disabled = false;
      if (!ok(r)) { err.textContent = subErr(r, 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.'); return; }
      toast('Kanal qo‘shildi');
      render();
    });

    const frag = document.createDocumentFragment();
    frag.appendChild(cur);
    if (list.length < max) {
      frag.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('b', { text: '➕ Kanal qo‘shish' })),
        h('p', { class: 'muted', text: 'Avval botni kanalga admin qiling. Foydalanuvchi qo‘shilgan HAMMA kanalga obuna bo‘lishi kerak.' }),
        field('Kanal (@username yoki -100... id)', channel),
        field('Maxfiy kanal uchun taklif havolasi (ixtiyoriy)', invite),
        err, save));
    } else {
      frag.appendChild(h('p', { class: 'muted', text: 'Kanallar soni chegarasiga yetildi (' + max + ' ta). Yangisini qo‘shish uchun avval birortasini o‘chiring.' }));
    }
    if (list.length > 1) {
      const delAll = h('button', { class: 'btn danger block', type: 'button', text: '🗑 Hammasini o‘chirish' });
      delAll.addEventListener('click', async () => {
        if (!(await confirmBox('Barcha ' + list.length + ' ta kanal o‘chirilsinmi? Foydalanuvchilar obunasiz ham kira oladi.'))) return;
        delAll.disabled = true;
        const r = await call('DELETE', '/subscription');
        if (!ok(r)) { delAll.disabled = false; return toast(subErr(r, msgOf(r, 'O‘chirib bo‘lmadi')), true); }
        toast('O‘chirildi');
        render();
      });
      frag.appendChild(delAll);
    }
    st.body.replaceChildren(frag);
  }

  // ---------- Reklama provayderlari: AdsGram / Monetag / OnClickA ----------
  // Bu yerda FAQAT ommaviy identifikatorlar tahrirlanadi. Maxfiy tokenlar (.env) hech qachon ko'rsatilmaydi — faqat "o'rnatilgan / yo'q".
  const AD_REASON_UZ = {
    NOT_CONFIGURED: 'sozlanmagan',
    SAME_BLOCK_ID: 'block ID vazifa blokiga teng',
    CALLBACK_TOKEN_MISSING: '.env da token yo‘q',
  };
  const AD_FIELDS = [
    { group: 'adsgram', title: 'AdsGram', logo: 'A', stateKey: 'adsgramTask', fields: [
      ['adsgramTaskBlockId', 'Vazifalar kartasi — block ID', 'masalan 12345'],
      ['adsgramQuickBlockId', 'Tepadagi +1 olmos — ALOHIDA block ID', 'vazifa blokidan farqli bo‘lsin'],
    ], tokenKey: 'adsgram', tokenName: 'ADSGRAM_REWARD_TOKEN', tpl: ['adsgramTask', 'adsgramQuick'] },
    { group: 'monetag', title: 'Monetag', logo: 'M', stateKey: 'monetag', fields: [
      ['monetagZoneId', 'Asosiy (main SDK) zone ID', 'faqat raqam'],
      ['monetagSdkUrl', 'SDK skript manzili (https)', 'Monetag kabinetidagi SDK tegidan'],
    ], tokenKey: 'monetag', tokenName: 'MONETAG_POSTBACK_TOKEN', tpl: ['monetag'] },
    { group: 'onclicka', title: 'OnClickA', logo: 'O', stateKey: 'onclicka', fields: [
      ['onclickaSpotId', 'SPOT-ID', 'faqat raqam'],
      ['onclickaSdkUrl', 'TMA video SDK manzili (https)', 'bo‘sh qoldirsangiz reklama o‘chadi'],
    ], tokenKey: 'onclicka', tokenName: 'ONCLICKA_CALLBACK_TOKEN', tpl: ['onclicka'] },
  ];
  const TPL_UZ = { adsgramTask: 'Reward URL (Vazifalar bloki)', adsgramQuick: 'Reward URL (tepadagi +1 bloki)', monetag: 'Postback URL', onclicka: 'Tasdiq (handler) URL' };

  function adStateBadge(sv) {
    if (!sv) return null;
    return h('span', { class: 'badge ' + (sv.enabled ? 'ACTIVE' : 'CANCELLED'), text: sv.enabled ? 'Yoqilgan' : 'O‘chiq' + (sv.reason ? ' — ' + (AD_REASON_UZ[sv.reason] || sv.reason) : '') });
  }

  async function renderAds(guard) {
    loading();
    const res = await call('GET', '/ads/settings');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const d = res.data;
    const inputs = {};
    const errs = {};
    const frag = document.createDocumentFragment();
    frag.appendChild(h('p', { class: 'muted', text: 'Har bir provayder mustaqil: biri sozlanmasa yoki xato bersa, faqat o‘sha karta “Mavjud emas” bo‘ladi. Maxfiy tokenlar faqat serverdagi .env faylida saqlanadi.' }));

    for (const g of AD_FIELDS) {
      const card = h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('b', { text: `${g.logo} ${g.title}` }), adStateBadge(d.state[g.stateKey])));
      if (g.group === 'adsgram') {
        card.appendChild(h('div', { class: 'ps', text: 'Tepadagi +1 holati: ' + (d.state.adsgramQuick.enabled ? 'yoqilgan' : 'o‘chiq' + (d.state.adsgramQuick.reason ? ' — ' + (AD_REASON_UZ[d.state.adsgramQuick.reason] || d.state.adsgramQuick.reason) : '')) }));
      }
      for (const [key, label, ph] of g.fields) {
        inputs[key] = h('input', { type: 'text', maxlength: key.endsWith('Url') ? '300' : '40', placeholder: ph, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: d.values[key] || '' });
        card.appendChild(field(label, inputs[key]));
      }
      card.appendChild(h('div', { class: 'ps', text: `${g.tokenName}: ${d.tokens[g.tokenKey] ? '✅ .env da o‘rnatilgan' : '❌ .env da yo‘q'}` }));
      for (const t of g.tpl) {
        const url = d.callbackTemplates[t];
        card.appendChild(h('div', { class: 'ps', text: TPL_UZ[t] + ':' }));
        card.appendChild(h('div', { class: 'ps', style: 'user-select:all;word-break:break-all', text: url }));
      }
      errs[g.group] = h('p', { class: 'errtxt', role: 'alert' });
      card.appendChild(errs[g.group]);
      frag.appendChild(card);
    }

    const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
    const err = h('p', { class: 'errtxt', role: 'alert' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      const patch = {};
      for (const [key, input] of Object.entries(inputs)) {
        const v = input.value.trim();
        if (v !== (d.values[key] || '')) patch[key] = v; // faqat o'zgargan maydonlar (bo'sh = o'chirish)
      }
      if (Object.keys(patch).length === 0) { toast('O‘zgarish yo‘q'); return; }
      save.disabled = true;
      const r = await call('PUT', '/ads/settings', patch);
      save.disabled = false;
      if (!ok(r)) {
        const f = r.data && r.data.details && r.data.details.field;
        err.textContent = (f ? `${f}: ` : '') + msgOf(r, 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.');
        return;
      }
      toast('Saqlandi');
      render();
    });
    frag.append(err, save);
    st.body.replaceChildren(frag);
  }

  // ---------- Xavfsizlik: audit feed + foydalanuvchilar ----------
  const AUDIT_UZ = {
    ADMIN_SHOP_PRODUCT_CREATE: ['🛍', 'Mahsulot qo‘shildi'], ADMIN_SHOP_PRODUCT_UPDATE: ['✏️', 'Mahsulot tahrirlandi'],
    ADMIN_SHOP_PRODUCT_DEACTIVATE: ['🙈', 'Mahsulot yashirildi'], ADMIN_SHOP_PRODUCT_DELETE: ['🗑', 'Mahsulot o‘chirildi'],
    ADMIN_SHOP_ORDER_UPDATE: ['📦', 'Buyurtma yangilandi'], ADMIN_SHOP_ORDER_PROOF: ['🖼️', 'Isbot rasmi yuklandi'],
    ADMIN_AD_SETTINGS_UPDATED: ['📺', 'Reklama sozlamalari yangilandi'],
    ADMIN_COIN_GRANT: ['🪙', 'Tanga yuborildi'],
    USER_BLOCKED: ['🚫', 'Foydalanuvchi bloklandi'], USER_UNBLOCKED: ['✅', 'Foydalanuvchi blokdan chiqarildi'],
  };

  function auditRow(a) {
    const sus = a.action.startsWith('SUSPICIOUS:');
    const [ico, label] = sus ? ['🚨', 'Shubhali: ' + a.action.slice(11)] : (AUDIT_UZ[a.action] || ['📝', a.action]);
    const dt = a.details || {};
    const extra = dt.from && dt.to
      ? ` • ${STATUS_UZ[dt.from] || dt.from} → ${STATUS_UZ[dt.to] || dt.to}`
      : dt.amount && dt.toTelegramId
        ? ` • +${nf.format(dt.amount)} 🪙 → ID ${dt.toTelegramId}`
        : (dt.reason || dt.path || dt.title ? ` • ${dt.reason || dt.path || dt.title}` : '');
    const who = a.actorTelegramId ? 'ID ' + a.actorTelegramId : 'tizim';
    return h('div', { class: 'frow' },
      h('div', { class: 'fico' + (sus ? ' sus' : ''), text: ico }),
      h('div', { class: 'fb' },
        h('div', { class: 'ft', text: label }),
        h('div', { class: 'fs', text: `${fmt(a.createdAt)} • ${who}${a.entityType && !sus ? ' • ' + a.entityType + (a.entityId ? ' #' + a.entityId : '') : ''}${extra}` })));
  }

  function userRow(u, reload) {
    const act = h('button', { class: 'btn sm ' + (u.isBlocked ? 'ok' : 'danger'), type: 'button', text: u.isBlocked ? 'Ochish' : 'Bloklash' });
    act.addEventListener('click', async () => {
      const name = nameOf(u);
      if (!u.isBlocked && !(await confirmBox(`${name} bloklansinmi? U ilovaga kira olmaydi.`))) return;
      act.disabled = true;
      const res = await call('POST', `/users/${u.telegramId}/${u.isBlocked ? 'unblock' : 'block'}`);
      if (!ok(res)) { act.disabled = false; return toast(msgOf(res), true); }
      toast(u.isBlocked ? 'Blokdan chiqarildi' : 'Bloklandi');
      reload();
    });
    return h('div', { class: 'prow' },
      h('div', { class: 'thumb', text: (u.firstName || u.username || '?').slice(0, 1).toUpperCase() }),
      h('div', { class: 'pb' },
        h('div', { class: 'pt', text: nameOf(u) }),
        h('div', { class: 'ps', text: `ID ${u.telegramId} • ${fmt(u.createdAt)}` })),
      u.isBlocked ? badge('CANCELLED') : null,
      act);
  }

  async function renderSecurity(guard) {
    const modeChips = h('div', { class: 'chips' },
      ...[['audit', '📜 Audit jurnali'], ['users', '👥 Foydalanuvchilar']].map(([k, label]) =>
        h('button', { type: 'button', class: st.secMode === k ? 'active' : '', text: label, onclick: () => { st.secMode = k; render(); } })));
    const content = h('div', {}, skeleton(3, 'tall'));
    st.body.replaceChildren(modeChips, content);

    if (st.secMode === 'users') {
      const input = h('input', { type: 'search', placeholder: 'Username, ism yoki Telegram ID', maxlength: '64', value: st.userQ });
      const go = () => { st.userQ = input.value.trim(); render(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      const res = await call('GET', '/users?q=' + encodeURIComponent(st.userQ));
      if (!guard()) return;
      const list = h('div', { class: 'card' });
      if (!ok(res)) list.appendChild(stateNode('📡', 'Yuklab bo‘lmadi', msgOf(res), 'Qayta urinish', render));
      else if (!res.data.users.length) list.appendChild(stateNode('🔎', 'Hech narsa topilmadi', 'Boshqa so‘z bilan qidirib ko‘ring.'));
      else for (const u of res.data.users) list.appendChild(userRow(u, render));
      content.replaceChildren(
        h('div', { class: 'search' }, input, h('button', { class: 'btn', type: 'button', text: 'Qidirish', onclick: go })),
        h('div', { class: 'muted', text: st.userQ ? 'Qidiruv natijalari' : 'Bloklanganlar va eng yangi foydalanuvchilar' }),
        list);
      return;
    }

    // Audit jurnali
    const kinds = h('div', { class: 'chips' },
      ...[['all', 'Hammasi'], ['suspicious', '🚨 Shubhali'], ['admin', '⚙️ Admin amallari']].map(([k, label]) =>
        h('button', { type: 'button', class: st.auditKind === k ? 'active' : '', text: label, onclick: () => { st.auditKind = k; render(); } })));
    const res = await call('GET', `/audit?kind=${st.auditKind}&limit=30`);
    if (!guard()) return;
    const card = h('div', { class: 'card feed' });
    if (!ok(res)) {
      card.appendChild(stateNode('📡', 'Yuklab bo‘lmadi', msgOf(res), 'Qayta urinish', render));
    } else if (!res.data.items.length) {
      card.appendChild(stateNode('✅', 'Hozircha yozuv yo‘q', st.auditKind === 'suspicious' ? 'Shubhali faollik aniqlanmagan.' : 'Admin amallari shu yerda ko‘rinadi.'));
    } else {
      for (const a of res.data.items) card.appendChild(auditRow(a));
      let cursor = res.data.nextCursor;
      const more = h('button', { class: 'btn sec block', type: 'button', text: 'Yana yuklash' });
      more.hidden = !cursor;
      more.addEventListener('click', async () => {
        more.disabled = true;
        const r = await call('GET', `/audit?kind=${st.auditKind}&limit=30&before=${cursor}`);
        more.disabled = false;
        if (!ok(r)) return toast(msgOf(r), true);
        for (const a of r.data.items) card.insertBefore(auditRow(a), more);
        cursor = r.data.nextCursor;
        more.hidden = !cursor;
      });
      card.appendChild(more);
    }
    content.replaceChildren(kinds, card);
  }

  // ---------- Mahsulotlar ----------
  async function renderProducts(guard) {
    loading();
    const res = await call('GET', '/shop/products');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const items = res.data.items || [];

    const frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'hrow' },
      h('span', { class: 'muted', text: `Jami: ${items.length}` }),
      h('button', { class: 'btn sm', type: 'button', text: '+ Yangi', onclick: () => productForm(null) })));

    if (!items.length) {
      frag.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty-inline' },
        h('div', { class: 'big', text: '🛍' }),
        h('b', { text: 'Do‘konda hali mahsulot yo‘q' }),
        h('span', { class: 'muted', text: 'Birinchi mahsulotni qo‘shing: nomi, rasmi, narxi (Rush Coin) va zaxirasi.' }),
        h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', text: '+ Mahsulot qo‘shish', onclick: () => productForm(null) })))));
      st.body.replaceChildren(frag);
      return;
    }

    const card = h('div', { class: 'card' });
    for (const p of items) card.appendChild(productRow(p));
    frag.appendChild(card);
    st.body.replaceChildren(frag);
  }

  function productRow(p) {
    const stockTxt = p.stock === null ? '∞' : nf.format(p.stock);
    return h('div', { class: 'prow' },
      thumb(p.imageUrl),
      h('div', { class: 'pb' },
        h('div', { class: 'pt', text: p.title }),
        h('div', { class: 'ps', text: `${nf.format(p.priceRush)} 🪙 • ${KIND_UZ[p.kind] || p.kind} • zaxira: ${stockTxt}` }),
        h('div', { class: 'ps', text: `${nf.format(p.ordersCount || 0)} buyurtma • tartib: ${p.sortOrder}` }),
        !p.isActive || p.stock === 0
          ? h('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap' },
            !p.isActive ? badge('INACTIVE') : null,
            p.stock === 0 ? badge('OUT') : null)
          : null),
      h('div', { class: 'acts' },
        h('button', { class: 'btn sm sec', type: 'button', text: '✏️', 'aria-label': 'Tahrirlash', onclick: () => productForm(p) }),
        h('button', { class: 'btn sm sec', type: 'button', text: p.isActive ? '🙈' : '👁', 'aria-label': p.isActive ? 'Yashirish' : 'Ko‘rsatish', onclick: () => toggleProduct(p) }),
        h('button', { class: 'btn sm danger', type: 'button', text: '🗑', 'aria-label': 'O‘chirish', onclick: () => deleteProduct(p) })));
  }

  function productForm(p) {
    const title = h('input', { type: 'text', maxlength: '120', placeholder: 'Masalan: Telegram Premium 1 oy', value: p ? p.title : '' });
    const desc = h('textarea', { maxlength: '1000', placeholder: 'Qisqa tavsif (ixtiyoriy)' });
    desc.value = p && p.description ? p.description : '';
    const price = h('input', { type: 'number', min: '1', max: '100000000', inputmode: 'numeric', placeholder: 'Rush Coin', value: p ? String(p.priceRush) : '' });
    const kind = h('select', {}, ...Object.entries(KIND_UZ).map(([v, t]) => h('option', { value: v, text: t })));
    kind.value = p ? p.kind : 'CUSTOM';
    const unlimited = h('input', { type: 'checkbox' });
    unlimited.checked = p ? p.stock === null : true;
    const stock = h('input', { type: 'number', min: '0', max: '1000000', inputmode: 'numeric', placeholder: 'Zaxira soni', value: p && p.stock !== null ? String(p.stock) : '' });
    const syncStock = () => { stock.disabled = unlimited.checked; };
    unlimited.addEventListener('change', syncStock);
    syncStock();
    const active = h('select', {}, h('option', { value: '1', text: 'Faol (ko‘rinadi)' }), h('option', { value: '0', text: 'Yashirin' }));
    active.value = p && !p.isActive ? '0' : '1';
    const sort = h('input', { type: 'number', min: '-10000', max: '10000', inputmode: 'numeric', value: String(p ? p.sortOrder : 0) });
    const err = h('p', { class: 'errtxt', role: 'alert' });

    let imageUrl = p ? p.imageUrl : null;
    const preview = h('div', { class: 'thumb lg' });
    const drawPreview = () => preview.replaceChildren(...(imageUrl ? [h('img', { src: imageUrl, alt: '' })] : [document.createTextNode('🖼️')]));
    drawPreview();
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const pick = h('button', { class: 'btn sm sec', type: 'button', text: 'Rasm tanlash', onclick: () => file.click() });
    const drop = h('button', { class: 'btn sm danger', type: 'button', text: 'Olib tashlash', onclick: () => { imageUrl = null; drawPreview(); } });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      err.textContent = '';
      pick.disabled = true; pick.textContent = 'Yuklanmoqda…';
      try {
        const blob = await shrinkImage(f);
        const up = await uploadBlob('/api/admin/uploads/shop-image', blob);
        if (!up.ok) err.textContent = up.message;
        else { imageUrl = up.data.imageUrl; drawPreview(); }
      } catch (_e) {
        err.textContent = 'Rasmni o‘qib bo‘lmadi.';
      } finally {
        pick.disabled = false; pick.textContent = 'Rasm tanlash';
      }
    });

    openSheet(p ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot', (close) => {
      const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const t = title.value.trim();
        const pr = Number(price.value);
        const so = Number(sort.value === '' ? 0 : sort.value);
        const sk = Number(stock.value);
        if (!t) { err.textContent = 'Mahsulot nomini kiriting.'; return; }
        if (!Number.isInteger(pr) || pr < 1 || pr > 100000000) { err.textContent = 'Narx 1 dan 100 000 000 gacha butun son bo‘lsin.'; return; }
        if (!unlimited.checked && (stock.value === '' || !Number.isInteger(sk) || sk < 0 || sk > 1000000)) { err.textContent = 'Zaxira 0 dan 1 000 000 gacha butun son bo‘lsin yoki “Cheksiz” ni belgilang.'; return; }
        if (!Number.isInteger(so) || so < -10000 || so > 10000) { err.textContent = 'Tartib -10000 dan 10000 gacha butun son bo‘lsin.'; return; }
        const body = {
          title: t, description: desc.value.trim(), imageUrl, priceRush: pr, kind: kind.value,
          stock: unlimited.checked ? null : sk, isActive: active.value === '1', sortOrder: so,
        };
        save.disabled = true;
        const res = p ? await call('PATCH', '/shop/products/' + p.id, body) : await call('POST', '/shop/products', body);
        save.disabled = false;
        if (!ok(res)) { err.textContent = msgOf(res, 'Saqlab bo‘lmadi'); return; }
        close();
        toast(p ? 'Saqlandi' : 'Mahsulot qo‘shildi');
        render();
      });
      return h('div', {},
        h('div', { class: 'upl field' }, preview, h('div', { class: 'btns', style: 'margin:0' }, pick, drop), file),
        field('Nomi', title), field('Tavsif', desc),
        h('div', { class: 'two' }, field('Narx (🪙 Rush Coin)', price), field('Turi', kind)),
        field('Zaxira', h('div', {}, stock, h('label', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px' }, unlimited, 'Cheksiz'))),
        h('div', { class: 'two' }, field('Holat', active), field('Tartib', sort)),
        err, save);
    });
  }

  async function toggleProduct(p) {
    const res = await call('PATCH', '/shop/products/' + p.id, { isActive: !p.isActive });
    if (!ok(res)) return toast(msgOf(res), true);
    toast(p.isActive ? 'Yashirildi' : 'Ko‘rinadigan qilindi');
    render();
  }

  async function deleteProduct(p) {
    const text = p.ordersCount > 0
      ? `“${p.title}” bo‘yicha buyurtmalar bor, shuning uchun mahsulot o‘chirilmaydi — yashiriladi (buyurtmalar tarixi saqlanadi). Davom etasizmi?`
      : `“${p.title}” mahsuloti butunlay o‘chirilsinmi?`;
    if (!(await confirmBox(text))) return;
    const res = await call('DELETE', '/shop/products/' + p.id);
    if (!ok(res)) return toast(msgOf(res), true);
    toast(res.data.deactivated ? 'Yashirildi (buyurtmalar tarixi saqlandi)' : 'O‘chirildi');
    render();
  }

  // ---------- Buyurtmalar ----------
  /** Ommaviy Tarix holati: faqat DELIVERED + isbot rasmi bo'lsa ko'rinadi (server confirmedAt ni shunda yozadi). */
  function historyLine(o) {
    if (o.status === 'DELIVERED') {
      return h('div', { class: 'ps', text: o.inHistory ? `📜 Ommaviy Tarixda ko‘rinadi • ${fmt(o.confirmedAt)}` : '⚠️ Tarixda ko‘rinmaydi — isbot rasmini yuklang' });
    }
    if (o.status !== 'CANCELLED' && o.proofImage) return h('div', { class: 'ps', text: '🖼️ Isbot bor — «Yetkazildi» qilingach Tarixda chiqadi' });
    return null;
  }

  function orderRow(o) {
    return h('div', { class: 'prow' },
      thumb(o.imageUrl),
      h('div', { class: 'pb' },
        h('div', { class: 'pt', text: `#${o.id} ${o.productTitle}` }),
        h('div', { class: 'ps', text: userLine(o.user) }),
        h('div', { class: 'ps', text: `${nf.format(o.priceRush)} 🪙 • ${KIND_UZ[o.productKind] || o.productKind} • ${fmt(o.createdAt)}` }),
        historyLine(o),
        o.adminNote ? h('div', { class: 'note', text: o.adminNote }) : null,
        o.proofImage ? h('img', { src: o.proofImage, alt: '', loading: 'lazy', style: 'display:block;max-width:100%;max-height:120px;border-radius:12px;margin-top:6px' }) : null),
      h('div', { class: 'acts', style: 'flex-direction:column;align-items:flex-end;gap:6px' },
        badge(o.status),
        h('button', { class: 'btn sm sec', type: 'button', text: 'Boshqarish', onclick: () => orderForm(o) })));
  }

  async function renderOrders(guard) {
    const chips = h('div', { class: 'chips' },
      ...[['ALL', 'Hammasi'], ...ORDER_STATUSES.map((s) => [s, `${ORDER_ICON[s]} ${STATUS_UZ[s]}`])].map(([k, label]) =>
        h('button', { type: 'button', class: st.orderStatus === k ? 'active' : '', text: label, onclick: () => { st.orderStatus = k; render(); } })));
    const content = h('div', {}, skeleton(3, 'tall'));
    st.body.replaceChildren(chips, content);

    const filter = st.orderStatus !== 'ALL' ? '&status=' + st.orderStatus : '';
    const res = await call('GET', `/shop/orders?limit=30${filter}`);
    if (!guard()) return;
    const card = h('div', { class: 'card' });
    if (!ok(res)) {
      card.appendChild(stateNode('📡', 'Yuklab bo‘lmadi', msgOf(res), 'Qayta urinish', render));
    } else if (!res.data.items.length) {
      card.appendChild(stateNode('📭', 'Buyurtmalar yo‘q', st.orderStatus === 'ALL' ? 'Foydalanuvchilar sotib olgach shu yerda paydo bo‘ladi.' : 'Bu holatda buyurtma yo‘q.'));
    } else {
      for (const o of res.data.items) card.appendChild(orderRow(o));
      let cursor = res.data.nextCursor;
      const more = h('button', { class: 'btn sec block', type: 'button', text: 'Yana yuklash' });
      more.hidden = !cursor;
      more.addEventListener('click', async () => {
        more.disabled = true;
        const r = await call('GET', `/shop/orders?limit=30${filter}&cursor=${cursor}`);
        more.disabled = false;
        if (!ok(r)) return toast(msgOf(r), true);
        for (const o of r.data.items) card.insertBefore(orderRow(o), more);
        cursor = r.data.nextCursor;
        more.hidden = !cursor;
      });
      card.appendChild(more);
    }
    content.replaceChildren(card);
  }

  function orderForm(o) {
    const allowed = NEXT_ORDER[o.status] || [];
    const sel = h('select', {}, h('option', { value: o.status, text: STATUS_UZ[o.status] + ' (hozirgi)' }),
      ...allowed.map((s) => h('option', { value: s, text: `${ORDER_ICON[s]} ${STATUS_UZ[s]}` })));
    sel.value = o.status;
    sel.disabled = !allowed.length;
    const note = h('textarea', { maxlength: '1000', placeholder: 'Izoh (foydalanuvchiga ko‘rinadi)' });
    note.value = o.adminNote || '';
    let proof = o.proofImage || null; // Isbot rasmi (yetkazilganini tasdiqlovchi); hint ham unga bog'liq
    const hint = h('p', { class: 'muted', style: 'font-size:12.5px' });
    const syncHint = () => {
      if (sel.value === 'CANCELLED' && o.status !== 'CANCELLED') hint.textContent = `Bekor qilinsa ${nf.format(o.priceRush)} 🪙 foydalanuvchiga bir marta qaytariladi (zaxira bo‘lsa +1). Holatni keyin o‘zgartirib bo‘lmaydi.`;
      else if (sel.value === 'DELIVERED' && o.status !== 'DELIVERED') hint.textContent = 'Yetkazildi holatidan keyin o‘zgartirib bo‘lmaydi. Foydalanuvchiga bot orqali xabar boradi. ' + (proof ? 'Buyurtma ommaviy Tarixda ko‘rinadi.' : 'Isbot rasmi yuklanmaguncha Tarixda ko‘rinmaydi.');
      else if (o.status === 'DELIVERED' && !allowed.length && !proof) hint.textContent = 'Buyurtma yetkazilgan, lekin isbot rasmi yo‘q — rasm yuklangach Tarixda ko‘rinadi.';
      else if (!allowed.length) hint.textContent = 'Buyurtma yakunlangan — holatni o‘zgartirib bo‘lmaydi (izohni tahrirlash mumkin).';
      else hint.textContent = '';
    };
    sel.addEventListener('change', syncHint);
    syncHint();
    const err = h('p', { class: 'errtxt', role: 'alert' });

    // Isbot rasmi yuklash. Bekor qilingan buyurtmaga yuklanmaydi.
    const proofPrev = h('div', { class: 'thumb lg' });
    const drawProof = () => proofPrev.replaceChildren(...(proof ? [h('img', { src: proof, alt: '' })] : [document.createTextNode('🧾')]));
    drawProof();
    const pfile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const ppick = h('button', { class: 'btn sm sec', type: 'button', text: proof ? 'Isbotni almashtirish' : 'Isbot rasmi yuklash', onclick: () => pfile.click() });
    pfile.addEventListener('change', async () => {
      const f = pfile.files && pfile.files[0];
      pfile.value = '';
      if (!f) return;
      err.textContent = '';
      ppick.disabled = true; ppick.textContent = 'Yuklanmoqda…';
      try {
        const blob = await shrinkImage(f, 1600);
        const up = await uploadBlob(`/api/admin/shop/orders/${o.id}/proof`, blob);
        if (!up.ok) err.textContent = up.message;
        else {
          proof = up.data.order.proofImage;
          drawProof();
          syncHint();
          toast(up.data.order.inHistory ? 'Isbot yuklandi — buyurtma Tarixda ko‘rinadi' : 'Isbot rasmi yuklandi');
          render();
        }
      } catch (_e) {
        err.textContent = 'Rasmni o‘qib bo‘lmadi.';
      } finally {
        ppick.disabled = false; ppick.textContent = 'Isbotni almashtirish';
      }
    });

    openSheet(`#${o.id} • ${o.productTitle}`, (close) => {
      const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const body = {};
        if (sel.value !== o.status) body.status = sel.value;
        if ((note.value.trim() || null) !== (o.adminNote || null)) body.adminNote = note.value.trim();
        if (!Object.keys(body).length) { close(); return; }
        if (body.status === 'CANCELLED' && !(await confirmBox(`Buyurtma #${o.id} bekor qilinsinmi? ${nf.format(o.priceRush)} 🪙 foydalanuvchiga qaytariladi.`))) return;
        if (body.status === 'DELIVERED' && !(await confirmBox(`Buyurtma #${o.id} yetkazildi deb belgilansinmi? Buni qaytarib bo‘lmaydi.`))) return;
        save.disabled = true;
        const res = await call('PATCH', '/shop/orders/' + o.id, body);
        save.disabled = false;
        if (!ok(res)) { err.textContent = msgOf(res, 'Saqlab bo‘lmadi'); return; }
        close();
        toast(body.status === 'CANCELLED' ? 'Bekor qilindi, Rush qaytarildi' : 'Yangilandi');
        render();
      });
      return h('div', {},
        h('div', { class: 'muted' }, userLine(o.user)),
        h('div', { class: 'muted' }, `${nf.format(o.priceRush)} 🪙 • ${KIND_UZ[o.productKind] || o.productKind} • ${fmt(o.createdAt)}`),
        field('Holat', sel), hint, field('Izoh', note),
        o.status !== 'CANCELLED' ? h('div', { class: 'upl field' }, proofPrev, h('div', { class: 'btns', style: 'margin:0' }, ppick), pfile) : null,
        err, save);
    });
  }

  // ---------- Tanga (Rush Coin) yuborish ----------
  // "Tanga" = Rush Coin (User.rushCoins). Olmos va so'm balanslariga tegilmaydi. Qidiruv, tekshiruvlar va balans faqat serverda:
  // klient Telegram ID, miqdor, requestId va tasdiqlash paytida ko'rgan username'ni yuboradi.
  const COIN_MAX = 1000000;
  // Joriy urinishning holati. reqId — tarmoq xatosidan keyingi qayta urinishda o'zgarmaydi (server takroriy yuborishni rad etadi).
  const coinSt = { q: '', user: null, amount: '', reqId: null };

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const x = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }

  function grantRow(g) {
    const who = g.toUsername ? '@' + g.toUsername : g.toFirstName || 'Foydalanuvchi';
    return h('div', { class: 'frow' },
      h('div', { class: 'fico', text: '🪙' }),
      h('div', { class: 'fb' },
        h('div', { class: 'ft', text: `+${nf.format(g.amount)} 🪙 → ${who}` }),
        h('div', { class: 'fs', text: `${fmt(g.createdAt)} • Qabul qiluvchi ID ${g.toTelegramId} • Admin ID ${g.adminTelegramId}` })));
  }

  async function renderCoins(guard) {
    const searchCard = h('div', { class: 'card' });
    const targetBox = h('div', {});
    const feed = h('div', { class: 'card feed' });
    const moreBtn = h('button', { class: 'btn sec block', type: 'button', text: 'Yana yuklash', hidden: true });
    st.body.replaceChildren(searchCard, targetBox,
      h('div', { class: 'card-head' }, h('b', { text: '📜 Yuborish tarixi' })), feed, moreBtn);

    const input = h('input', { type: 'search', placeholder: '@username yoki Telegram ID', maxlength: '64', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: coinSt.q });
    const err = h('p', { class: 'errtxt', role: 'alert' });
    const findBtn = h('button', { class: 'btn', type: 'button', text: 'Topish' });

    // ----- Yuborish tarixi -----
    let cursor = null;
    async function loadHistory(reset) {
      if (reset) { cursor = null; feed.replaceChildren(skeleton(2, 'tall')); }
      moreBtn.disabled = true;
      const res = await call('GET', `/coins/history?limit=20${cursor ? '&before=' + cursor : ''}`);
      moreBtn.disabled = false;
      if (!guard()) return;
      if (reset) feed.replaceChildren();
      if (!ok(res)) {
        if (reset) feed.appendChild(stateNode('📡', 'Yuklab bo‘lmadi', msgOf(res), 'Qayta urinish', () => loadHistory(true)));
        else toast(msgOf(res), true);
        moreBtn.hidden = reset; // "Yana yuklash" xatosida tugma qoladi (qayta bosish mumkin)
        return;
      }
      if (reset && !res.data.items.length) feed.appendChild(stateNode('🪙', 'Hali yuborilmagan', 'Yuborilgan tangalar shu yerda ko‘rinadi.'));
      for (const g of res.data.items) feed.appendChild(grantRow(g));
      cursor = res.data.nextCursor;
      moreBtn.hidden = !cursor;
    }
    moreBtn.addEventListener('click', () => loadHistory(false));

    // ----- Topilgan foydalanuvchi + miqdor + tasdiqlash -----
    function drawTarget() {
      const u = coinSt.user;
      if (!u) { targetBox.replaceChildren(); return; }
      const tgErr = h('p', { class: 'errtxt', role: 'alert' });
      const amount = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '7', placeholder: 'Rush Coin miqdori', value: coinSt.amount });
      const preview = h('p', { class: 'muted' });
      const send = h('button', { class: 'btn block', type: 'button', text: 'Yuborish' });
      const blockedMsg = u.isBlocked ? 'Foydalanuvchi bloklangan — tanga yuborib bo‘lmaydi.' : (u.isSelf ? 'O‘zingizga tanga yuborib bo‘lmaydi.' : '');
      const parse = () => (/^\d{1,7}$/.test(amount.value) ? Number(amount.value) : NaN);
      const valid = (n) => Number.isInteger(n) && n >= 1 && n <= COIN_MAX;
      const sync = () => {
        coinSt.amount = amount.value;
        const n = parse();
        preview.textContent = valid(n) ? `Yuboriladi: +${nf.format(n)} 🪙 • Yangi balans: ${nf.format(u.rushCoins + n)} 🪙` : '';
      };
      amount.addEventListener('input', () => { amount.value = amount.value.replace(/\D/g, ''); tgErr.textContent = ''; sync(); });
      send.disabled = Boolean(blockedMsg);
      if (blockedMsg) tgErr.textContent = blockedMsg;

      send.addEventListener('click', async () => {
        tgErr.textContent = '';
        const n = parse();
        if (!valid(n)) { tgErr.textContent = `Miqdor 1 dan ${nf.format(COIN_MAX)} gacha butun son bo‘lishi kerak.`; return; }
        const who = u.username ? '@' + u.username : u.firstName || 'Foydalanuvchi';
        if (!(await confirmBox(`${who} (ID ${u.telegramId}) hozirgi balansi ${nf.format(u.rushCoins)} 🪙. +${nf.format(n)} 🪙 yuborilsinmi? Buni qaytarib bo‘lmaydi.`))) return;
        send.disabled = true;
        const res = await call('POST', '/coins/grant', { telegramId: u.telegramId, amount: n, requestId: coinSt.reqId, expectedUsername: u.username || null });

        // Holat (reqId, foydalanuvchi) DOM dan oldin yangilanadi — tab almashgan bo'lsa ham eski reqId qayta ishlatilmaydi
        const reason = res.data && res.data.reason;
        if (ok(res)) {
          coinSt.user = res.data.user; coinSt.amount = ''; coinSt.reqId = uuid();
        } else if (reason === 'USER_CHANGED' && res.data.user) {
          coinSt.user = res.data.user; coinSt.reqId = uuid();
        }
        if (!guard()) return;

        if (ok(res)) {
          toast(`+${nf.format(n)} 🪙 yuborildi`);
          err.textContent = '';
          drawTarget();
          loadHistory(true);
          return;
        }
        if (reason === 'USER_CHANGED') {
          err.textContent = msgOf(res);
          drawTarget();
          return;
        }
        if (reason === 'DUPLICATE_REQUEST') {
          err.textContent = msgOf(res);
          await lookup(String(u.telegramId), false);
          loadHistory(true);
          return;
        }
        send.disabled = Boolean(blockedMsg);
        tgErr.textContent = res.status === 0
          ? 'Tarmoq xatosi. Natija noma‘lum — qayta bossangiz ham takroran yuborilmaydi.'
          : msgOf(res, 'Yuborib bo‘lmadi');
      });

      targetBox.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'prow' },
          h('div', { class: 'thumb', text: (u.firstName || u.username || '?').slice(0, 1).toUpperCase() }),
          h('div', { class: 'pb' },
            h('div', { class: 'pt', text: u.username ? '@' + u.username : u.firstName || 'Foydalanuvchi' }),
            h('div', { class: 'ps', text: `${u.firstName ? u.firstName + ' • ' : ''}ID ${u.telegramId}` })),
          u.isBlocked ? badge('CANCELLED', 'Bloklangan') : null),
        h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('div', { class: 'ico', text: '🪙' }), h('b', { text: nf.format(u.rushCoins) }), h('span', { text: 'Hozirgi balans (Rush Coin)' }))),
        field('Yuboriladigan miqdor', amount), preview, tgErr, send));
      sync();
    }

    // ----- Qidirish -----
    async function lookup(q, resetAmount = true) {
      err.textContent = '';
      const query = q.trim();
      if (!query) { err.textContent = 'Telegram ID yoki @username kiriting.'; return false; }
      findBtn.disabled = true;
      const res = await call('GET', '/coins/lookup?q=' + encodeURIComponent(query));
      findBtn.disabled = false;
      if (!guard()) return false;
      if (!ok(res)) {
        coinSt.user = null; coinSt.reqId = null;
        drawTarget();
        err.textContent = msgOf(res, 'Qidirib bo‘lmadi');
        return false;
      }
      coinSt.q = query;
      coinSt.user = res.data.user;
      coinSt.reqId = uuid(); // har bir yangi tanlov — yangi so'rov
      if (resetAmount) coinSt.amount = '';
      drawTarget();
      return true;
    }
    const go = () => lookup(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    findBtn.addEventListener('click', go);

    searchCard.append(
      h('div', { class: 'muted', text: 'Foydalanuvchini Telegram ID yoki @username orqali toping. Rush Coin balansiga qo‘shiladi (olmos va so‘m balanslariga tegilmaydi).' }),
      h('div', { class: 'search' }, input, findBtn), err);

    drawTarget();
    loadHistory(true);
  }

  // ---------- Rasm: brauzerda kichraytirish + yuklash ----------
  function shrinkImage(file, max = 1024) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k));
        cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob((webp) => {
          if (webp && webp.type === 'image/webp') return resolve(webp);
          cv.toBlob((jpg) => (jpg ? resolve(jpg) : reject(new Error('encode'))), 'image/jpeg', 0.88);
        }, 'image/webp', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  /** Xom bayt yuboradi (Content-Type = rasm turi). Muvaffaqiyatda { ok:true, data } (data — server javobi). */
  async function uploadBlob(path, blob) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: 'tma ' + ((tg && tg.initData) || ''), 'Content-Type': blob.type },
        body: blob,
      });
      let data = null;
      try { data = await res.json(); } catch (_e) { /* bo'sh */ }
      if (res.ok && data && data.success) return { ok: true, data };
      return { ok: false, message: (data && data.message) || 'Rasm yuklanmadi.' };
    } catch (_e) {
      return { ok: false, message: 'Tarmoq xatosi.' };
    }
  }

  window.AdRushAdmin = { mount, onShow };
})();