'use strict';

/**
 * AdRush — Admin bo'limi (Mine App ichida). Bu fayl FAQAT server /api/users/me da isAdmin:true qaytarsa yuklanadi.
 * Bu UI qulayligi uchun xolos: har bir /api/admin/* so'rovi serverda qayta tekshiriladi (oddiy userga 403).
 * Matnlar faqat textContent orqali qo'yiladi (XSS yo'q).
 */
(function () {
  const A = window.AdRush;
  if (!A) return;
  const { api, nf, tg, toast, confirmBox, prizeThumb, placeLabel, stateNode, skeleton, setBack, setNum } = A;

  const STATUS_UZ = {
    DRAFT: 'Qoralama', ACTIVE: 'Faol', ENDED: 'Tugagan', ARCHIVED: 'Arxiv',
    PENDING: 'Kutilmoqda', CONTACTED: 'Bog‘lanildi', DELIVERED: 'Topshirildi', CANCELLED: 'Bekor',
    INACTIVE: 'Yashirin',
  };
  // Faqat UI uchun (server o'zi ham tekshiradi)
  const NEXT_WINNER = {
    PENDING: ['CONTACTED', 'CANCELLED'],
    CONTACTED: ['DELIVERED', 'CANCELLED', 'PENDING'],
    DELIVERED: [],
    CANCELLED: ['PENDING'],
  };

  const st = { tab: 'dash', detailId: null, winnersCompId: null, root: null, body: null, token: 0, secMode: 'audit', auditKind: 'all', userQ: '' };

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
  const pad = (n) => String(n).padStart(2, '0');
  function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const fromLocalInput = (v) => new Date(v).toISOString();
  const badge = (status) => h('span', { class: 'badge ' + status, text: STATUS_UZ[status] || status });
  /** Raqam 0 dan qiymatgacha sanab chiqadi (500 ms); reduced-motion da darhol qo'yiladi. */
  function counter(tag, cls, value) {
    const n = h(tag, { class: cls, text: '0' });
    n.dataset.v = '0';
    setNum(n, value, false);
    return n;
  }
  const nameOf = (u) => (u.username ? '@' + u.username : u.firstName || 'Foydalanuvchi');

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
      ...[['dash', '📊 Dashboard'], ['comps', '🏁 Chempionat'], ['wins', '🏅 G‘oliblar'], ['sec', '🛡️ Xavfsizlik'], ['sub', '📢 Kanal']].map(([key, label]) =>
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
    st.detailId = null;
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
    if (!(st.tab === 'comps' && st.detailId)) setBack(null);
    if (st.tab === 'dash') return renderDash(guard);
    if (st.tab === 'sec') return renderSecurity(guard);
    if (st.tab === 'sub') return renderSubscription(guard);
    if (st.tab === 'comps') return st.detailId ? renderDetail(st.detailId, guard) : renderList(guard);
    return renderWinners(guard);
  }

  // ---------- Dashboard ----------
  function weekday(day) {
    return new Date(day + 'T00:00:00Z').toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
  }

  function barChart(daily) {
    const max = Math.max(1, ...daily.map((x) => x.validAds));
    const todayKey = new Date().toISOString().slice(0, 10);
    const wrap = h('div', { class: 'bars', role: 'img', 'aria-label': 'Oxirgi 7 kunlik valid reklamalar' });
    daily.forEach((x, i) => {
      const pct = Math.max(4, Math.round((x.validAds / max) * 100));
      const fill = h('div', { class: 'bfill', style: `height:${pct}%;animation-delay:${i * 40}ms`, title: `${x.day}: ${x.validAds}` });
      wrap.appendChild(h('div', { class: 'bcol' + (x.day === todayKey ? ' today' : '') },
        h('div', { class: 'btrack' }, fill), h('div', { class: 'bl', text: weekday(x.day) })));
    });
    return wrap;
  }

  async function renderDash(guard) {
    loading();
    const res = await call('GET', '/overview');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const d = res.data;
    const cur = d.current;

    const frag = document.createDocumentFragment();

    // Hero: faol chempionat + 7 kunlik faollik
    if (cur) {
      const c = cur.competition;
      frag.appendChild(h('div', { class: 'card adm-hero' },
        h('div', { class: 'hrow' }, h('span', { class: 'muted', text: 'Faol chempionat' }), h('span', { class: 'live' }, h('i'), 'LIVE')),
        h('div', { class: 'pt', style: 'font-size:17px;font-weight:700;margin-top:6px', text: c.title }),
        counter('div', 'kpi', cur.validAds),
        h('div', { class: 'sub', text: `valid reklama • bugun +${nf.format(cur.rewardsToday)} • ${nf.format(cur.participants)} ishtirokchi` }),
        barChart(d.daily || []),
        h('div', { class: 'sub', style: 'margin-top:8px', text: `${fmt(c.startAt)} → ${fmt(c.endAt)}` }),
        h('div', { class: 'btns' },
          h('button', { class: 'btn sec', type: 'button', text: 'Ochish', onclick: () => openDetail(c.id) }),
          h('button', { class: 'btn danger', type: 'button', text: 'Tugatish', onclick: () => endCompetition(c) }))));
    } else {
      frag.appendChild(h('div', { class: 'card adm-hero' },
        h('div', { class: 'empty-inline' },
          h('div', { class: 'big', text: '🏁' }),
          h('b', { text: 'Faol chempionat yo‘q' }),
          h('span', { class: 'muted', text: 'Yangi chempionat yarating va faollashtiring.' }),
          h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', text: '+ Chempionat yaratish', onclick: () => { setTab('comps'); competitionForm(); } }))),
        d.daily && d.daily.some((x) => x.validAds) ? barChart(d.daily) : null));
    }

    // Diqqat talab qiladigan narsalar
    if (d.pendingWinners) {
      frag.appendChild(h('div', { class: 'alert' }, h('span', { text: '⏳' }),
        h('span', { style: 'flex:1', text: `${nf.format(d.pendingWinners)} ta g‘olib bilan bog‘lanish kutilmoqda` }),
        h('button', { class: 'btn sm sec', type: 'button', text: 'Ko‘rish', onclick: () => setTab('wins') })));
    }
    if (d.suspicious24h) {
      frag.appendChild(h('div', { class: 'alert bad' }, h('span', { text: '🚨' }),
        h('span', { style: 'flex:1', text: `Oxirgi 24 soatda ${nf.format(d.suspicious24h)} ta shubhali hodisa` }),
        h('button', { class: 'btn sm sec', type: 'button', text: 'Ko‘rish', onclick: () => { st.secMode = 'audit'; st.auditKind = 'suspicious'; setTab('sec'); } })));
    }

    const tile = (ico, label, value, tone) => h('div', { class: 'tile pop' + (tone ? ' ' + tone : '') },
      h('div', { class: 'ico', text: ico }), counter('b', '', value), h('span', { text: label }));
    frag.appendChild(h('div', { class: 'tiles' },
      tile('👥', 'Jami foydalanuvchilar', d.totalUsers),
      tile('📺', 'Jami valid reklamalar', d.lifetimeValidAds, 'good'),
      tile('🏃', 'Joriy ishtirokchilar', cur ? cur.participants : 0),
      tile('🎁', 'Sovrinlar soni', cur ? cur.prizeCount : 0),
      tile('⏳', 'Kutayotgan g‘oliblar', d.pendingWinners, d.pendingWinners ? 'warn' : ''),
      tile('🚫', 'Bloklanganlar', d.blocked, d.blocked ? 'bad' : '')));

    const top = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: '🔥 Top o‘yinchilar' })));
    if (cur && cur.topPlayers.length) {
      for (const p of cur.topPlayers) {
        top.appendChild(h('div', { class: 'row' },
          h('span', { class: 'rk', text: p.rank <= 3 ? placeLabel(p.rank) : '#' + p.rank }),
          h('span', { class: 'name', text: nameOf(p) }),
          h('span', { class: 'val', text: nf.format(p.validAds) })));
      }
    } else {
      top.appendChild(stateNode('🏁', 'Hozircha ishtirokchilar yo‘q'));
    }
    frag.appendChild(top);
    st.body.replaceChildren(frag);
  }

  // ---------- Majburiy kanalga obuna ----------
  const SUB_ERR_UZ = {
    BOT_NOT_ADMIN: 'Bot kanalda admin emas',
    CHANNEL_NOT_FOUND: 'Kanal topilmadi',
    INVITE_REQUIRED: 'Maxfiy kanal uchun taklif havolasini kiriting',
    BAD_CHANNEL: 'Manzil noto‘g‘ri',
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
    const ch = res.data.channel;
    const url = ch ? (ch.inviteUrl || (ch.username ? 'https://t.me/' + ch.username : '')) : '';

    const cur = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: '📢 Majburiy obuna' })));
    if (ch) {
      cur.appendChild(h('div', { class: 'prow' },
        h('div', { class: 'thumb', text: '📢' }),
        h('div', { class: 'pb' },
          h('div', { class: 'pt', text: ch.title || (ch.username ? '@' + ch.username : 'Kanal') }),
          h('div', { class: 'ps', text: ch.username ? '@' + ch.username : 'Maxfiy kanal' }),
          url ? h('div', { class: 'ps', text: url }) : null),
        url ? h('button', { class: 'btn sm sec', type: 'button', text: '↗', 'aria-label': 'Kanalni ochish', onclick: () => openLink(url) }) : null));
    } else {
      cur.appendChild(h('p', { class: 'muted', text: 'Majburiy obuna o‘chiq' }));
    }

    const channel = h('input', { type: 'text', maxlength: '200', placeholder: '@kanal yoki -100...', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: ch && ch.username ? '@' + ch.username : '' });
    const invite = h('input', { type: 'url', maxlength: '300', placeholder: 'https://t.me/+...', autocomplete: 'off', value: ch && !ch.username && ch.inviteUrl ? ch.inviteUrl : '' });
    const err = h('p', { class: 'errtxt', role: 'alert' });
    const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      const body = { channel: channel.value.trim() };
      if (!body.channel) { err.textContent = 'Kanal manzilini kiriting.'; return; }
      if (invite.value.trim()) body.inviteUrl = invite.value.trim();
      save.disabled = true;
      const r = await call('PUT', '/subscription', body);
      save.disabled = false;
      if (!ok(r)) { err.textContent = subErr(r, 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.'); return; }
      toast('Saqlandi');
      render();
    });

    const form = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('b', { text: ch ? '✏️ Kanalni almashtirish' : '➕ Kanal ulash' })),
      h('p', { class: 'muted', text: 'Avval botni kanalga admin qiling.' }),
      field('Kanal (@username yoki -100... id)', channel),
      field('Maxfiy kanal uchun taklif havolasi (ixtiyoriy)', invite),
      err, save);

    const frag = document.createDocumentFragment();
    frag.append(cur, form);
    if (ch) {
      const del = h('button', { class: 'btn danger block', type: 'button', text: '🗑 O‘chirish' });
      del.addEventListener('click', async () => {
        if (!(await confirmBox('Majburiy obuna o‘chirilsinmi? Foydalanuvchilar kanalga obuna bo‘lmasdan ham kira oladi.'))) return;
        del.disabled = true;
        const r = await call('DELETE', '/subscription');
        if (!ok(r)) { del.disabled = false; return toast(subErr(r, msgOf(r, 'O‘chirib bo‘lmadi')), true); }
        toast('O‘chirildi');
        render();
      });
      frag.appendChild(del);
    }
    st.body.replaceChildren(frag);
  }

  // ---------- Xavfsizlik: audit feed + foydalanuvchilar ----------
  const AUDIT_UZ = {
    COMPETITION_CREATED: ['🏁', 'Chempionat yaratildi'], COMPETITION_UPDATED: ['✏️', 'Chempionat tahrirlandi'],
    COMPETITION_ACTIVATED: ['▶️', 'Chempionat faollashtirildi'], COMPETITION_CLOSED: ['⏹', 'Chempionat tugatildi'],
    COMPETITION_ARCHIVED: ['📦', 'Chempionat arxivlandi'], COMPETITION_DELETED: ['🗑', 'Qoralama o‘chirildi'],
    PRIZE_CREATED: ['🎁', 'Sovrin qo‘shildi'], PRIZE_UPDATED: ['✏️', 'Sovrin tahrirlandi'], PRIZE_DELETED: ['🗑', 'Sovrin o‘chirildi'],
    PRIZE_IMAGE_UPLOADED: ['🖼️', 'Sovrin rasmi yuklandi'], WINNER_STATUS_CHANGED: ['🏅', 'G‘olib holati o‘zgardi'],
    USER_BLOCKED: ['🚫', 'Foydalanuvchi bloklandi'], USER_UNBLOCKED: ['✅', 'Foydalanuvchi blokdan chiqarildi'],
  };

  function auditRow(a) {
    const sus = a.action.startsWith('SUSPICIOUS:');
    const [ico, label] = sus ? ['🚨', 'Shubhali: ' + a.action.slice(11)] : (AUDIT_UZ[a.action] || ['📝', a.action]);
    const extra = a.details && (a.details.reason || a.details.path || a.details.title) ? ` • ${a.details.reason || a.details.path || a.details.title}` : '';
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
      if (!u.isBlocked && !(await confirmBox(`${name} bloklansinmi? U reytingdan chiqadi va ilovaga kira olmaydi.`))) return;
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

  // ---------- Competitions ----------
  async function renderList(guard) {
    loading();
    const res = await call('GET', '/competitions');
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);

    const frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'hrow' },
      h('span', { class: 'muted', text: `Jami: ${res.data.competitions.length}` }),
      h('button', { class: 'btn sm', type: 'button', text: '+ Yangi', onclick: () => competitionForm() })));

    if (!res.data.competitions.length) {
      frag.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty-inline' },
        h('div', { class: 'big', text: '📭' }), h('b', { text: 'Hali chempionat yo‘q' }),
        h('span', { class: 'muted', text: 'Birinchi chempionatni yarating.' }))));
    }
    for (const c of res.data.competitions) {
      frag.appendChild(h('div', { class: 'card ccard', onclick: () => openDetail(c.id) },
        h('div', { class: 'top2' }, h('div', { class: 't', text: c.title }), badge(c.status)),
        h('div', { class: 'muted', text: `${fmt(c.startAt)} → ${fmt(c.endAt)}` }),
        h('div', { class: 'meta' },
          h('span', {}, '👥 ', h('b', { text: nf.format(c.participants) })),
          h('span', {}, '📺 ', h('b', { text: nf.format(c.validAds) })),
          h('span', {}, '🎁 ', h('b', { text: nf.format(c.prizeCount) })),
          c.winnerCount ? h('span', {}, '🏅 ', h('b', { text: nf.format(c.winnerCount) })) : null)));
    }
    st.body.replaceChildren(frag);
  }

  function openDetail(id) {
    st.tab = 'comps';
    st.detailId = id;
    document.querySelectorAll('#admSeg button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'comps'));
    A.go('admin'); // go() -> onShow() -> render()
  }

  async function renderDetail(id, guard) {
    loading();
    const res = await call('GET', '/competitions/' + id);
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const { competition: c, prizes, winners } = res.data;
    setBack(() => { st.detailId = null; render(); });
    const editablePrizes = c.status === 'DRAFT' || c.status === 'ACTIVE';

    const frag = document.createDocumentFragment();
    frag.appendChild(h('button', { class: 'back', type: 'button', text: '← Barcha chempionatlar', onclick: () => { st.detailId = null; render(); } }));

    const actions = h('div', { class: 'btns' });
    if (c.status === 'DRAFT' || c.status === 'ACTIVE') actions.appendChild(h('button', { class: 'btn sec', type: 'button', text: '✏️ Tahrirlash', onclick: () => competitionForm(c) }));
    if (c.status === 'DRAFT') {
      actions.appendChild(h('button', { class: 'btn ok', type: 'button', text: '▶️ Faollashtirish', onclick: () => activateCompetition(c) }));
      actions.appendChild(h('button', { class: 'btn danger', type: 'button', text: '🗑 O‘chirish', onclick: () => deleteCompetition(c) }));
    }
    if (c.status === 'ACTIVE') actions.appendChild(h('button', { class: 'btn danger', type: 'button', text: '⏹ Tugatish', onclick: () => endCompetition(c) }));
    if (c.status === 'ENDED') actions.appendChild(h('button', { class: 'btn sec', type: 'button', text: '📦 Arxivlash', onclick: () => archiveCompetition(c) }));

    frag.appendChild(h('div', { class: 'card hero' },
      h('div', { class: 'hrow' }, h('span', { class: 'muted', text: `#${c.id}` }), badge(c.status)),
      h('h1', { text: c.title }),
      c.description ? h('p', { class: 'muted desc', text: c.description }) : null,
      h('div', { class: 'muted', text: `Boshlanish: ${fmt(c.startAt)}` }),
      h('div', { class: 'muted', text: `Tugash: ${fmt(c.endAt)}` }),
      h('div', { class: 'meta', style: 'display:flex;gap:14px;margin-top:10px;font-size:13px' },
        h('span', { text: `👥 ${nf.format(c.participants)}` }), h('span', { text: `📺 ${nf.format(c.validAds)}` })),
      actions));

    // Sovrinlar
    const pcard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('b', { text: '🎁 Sovrinlar' }),
        editablePrizes ? h('button', { class: 'btn sm', type: 'button', text: '+ Sovrin', onclick: () => prizeForm(c, null, prizes) }) : null));
    if (!prizes.length) pcard.appendChild(h('p', { class: 'muted', text: 'Sovrin qo‘shilmagan. G‘oliblar sovrin o‘rni (place) bo‘yicha aniqlanadi.' }));
    for (const p of prizes) {
      pcard.appendChild(h('div', { class: 'prow' },
        prizeThumb(p),
        h('div', { class: 'pb' },
          h('div', { class: 'pt', text: p.title }),
          h('div', { class: 'ps', text: `${p.place}-o‘rin${p.value ? ' • ' + p.value : ''}${p.quantity > 1 ? ' • ' + p.quantity + ' ta' : ''}` })),
        p.status !== 'ACTIVE' ? badge(p.status) : null,
        editablePrizes ? h('div', { class: 'acts' },
          h('button', { class: 'btn sm sec', type: 'button', text: '✏️', 'aria-label': 'Tahrirlash', onclick: () => prizeForm(c, p, prizes) }),
          h('button', { class: 'btn sm danger', type: 'button', text: '🗑', 'aria-label': 'O‘chirish', onclick: () => deletePrize(p) })) : null));
    }
    frag.appendChild(pcard);

    if (c.status === 'ENDED' || c.status === 'ARCHIVED') frag.appendChild(winnersCard(winners, c));
    st.body.replaceChildren(frag);
  }

  function winnersCard(winners, c) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: '🏅 G‘oliblar' })));
    if (!winners.length) {
      card.appendChild(h('p', { class: 'muted', text: 'G‘oliblar yo‘q (ishtirokchi yoki sovrin bo‘lmagan).' }));
      return card;
    }
    for (const w of winners) {
      card.appendChild(h('div', { class: 'prow' },
        h('div', { class: 'thumb', text: placeLabel(w.place) }),
        h('div', { class: 'pb' },
          h('div', { class: 'pt', text: nameOf(w.user) }),
          h('div', { class: 'ps', text: `${w.prize} • ${nf.format(w.validAds)} reklama • ID ${w.user.telegramId}` }),
          w.note ? h('div', { class: 'note', text: w.note }) : null),
        h('div', { class: 'acts', style: 'flex-direction:column;align-items:flex-end;gap:6px' },
          badge(w.status),
          h('button', { class: 'btn sm sec', type: 'button', text: 'Holat', onclick: () => winnerForm(w) }))));
    }
    return card;
  }

  // ---------- G'oliblar tabi ----------
  async function renderWinners(guard) {
    loading();
    const list = await call('GET', '/competitions');
    if (!guard()) return;
    if (!ok(list)) return failed(list, render);
    const ended = list.data.competitions.filter((c) => c.status === 'ENDED' || c.status === 'ARCHIVED');
    if (!ended.length) {
      st.body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty-inline' },
        h('div', { class: 'big', text: '🏅' }), h('b', { text: 'Hali g‘oliblar yo‘q' }),
        h('span', { class: 'muted', text: 'Chempionat tugagach g‘oliblar shu yerda paydo bo‘ladi.' }))));
      return;
    }
    if (!ended.some((c) => c.id === st.winnersCompId)) st.winnersCompId = ended[0].id;

    const sel = h('select', { onchange: (e) => { st.winnersCompId = Number(e.target.value); render(); } },
      ...ended.map((c) => h('option', { value: String(c.id), text: c.title, selected: c.id === st.winnersCompId })));
    sel.value = String(st.winnersCompId);

    const res = await call('GET', `/competitions/${st.winnersCompId}/winners`);
    if (!guard()) return;
    if (!ok(res)) return failed(res, render);
    const comp = ended.find((c) => c.id === st.winnersCompId);
    st.body.replaceChildren(field('Chempionat', sel), winnersCard(res.data.winners, comp));
  }

  // ---------- Formalar ----------
  function competitionForm(c) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const inMonth = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    const title = h('input', { type: 'text', maxlength: '120', placeholder: 'Masalan: Oktyabr chempionati', value: c ? c.title : '' });
    const desc = h('textarea', { maxlength: '1000', placeholder: 'Qisqa tavsif (ixtiyoriy)' });
    desc.value = c && c.description ? c.description : '';
    const start = h('input', { type: 'datetime-local', value: toLocalInput(c ? c.startAt : now.toISOString()) });
    const end = h('input', { type: 'datetime-local', value: toLocalInput(c ? c.endAt : inMonth.toISOString()) });
    const startLocked = c && c.status === 'ACTIVE' && new Date(c.startAt) <= new Date();
    if (startLocked) start.disabled = true;
    const err = h('p', { class: 'errtxt', role: 'alert' });

    openSheet(c ? 'Chempionatni tahrirlash' : 'Yangi chempionat', (close) => {
      const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        if (title.value.trim().length < 3) { err.textContent = 'Nom kamida 3 belgi bo‘lsin.'; return; }
        if (!start.value || !end.value) { err.textContent = 'Sanalarni kiriting.'; return; }
        const body = { title: title.value.trim(), description: desc.value.trim(), endAt: fromLocalInput(end.value) };
        if (!startLocked) body.startAt = fromLocalInput(start.value);
        save.disabled = true;
        const res = c ? await call('PATCH', '/competitions/' + c.id, body) : await call('POST', '/competitions', body);
        save.disabled = false;
        if (!ok(res)) { err.textContent = msgOf(res, 'Saqlab bo‘lmadi'); return; }
        close();
        toast(c ? 'Saqlandi' : 'Qoralama yaratildi');
        if (c) render(); else openDetail(res.data.competition.id);
      });
      return h('div', {}, field('Nomi', title), field('Tavsif', desc),
        h('div', { class: 'two' }, field('Boshlanish', start), field('Tugash', end)), err, save);
    });
  }

  function prizeForm(c, p, existing) {
    const usedPlaces = new Set(existing.filter((x) => !p || x.id !== p.id).map((x) => x.place));
    let nextPlace = 1;
    while (usedPlaces.has(nextPlace)) nextPlace += 1;

    const place = h('input', { type: 'number', min: '1', max: '100', inputmode: 'numeric', value: String(p ? p.place : nextPlace) });
    const qty = h('input', { type: 'number', min: '1', max: '1000', inputmode: 'numeric', value: String(p ? p.quantity : 1) });
    const title = h('input', { type: 'text', maxlength: '120', placeholder: 'Masalan: iPhone 15', value: p ? p.title : '' });
    const value = h('input', { type: 'text', maxlength: '60', placeholder: 'Masalan: 500$', value: p && p.value ? p.value : '' });
    const desc = h('textarea', { maxlength: '500', placeholder: 'Qisqa tavsif (ixtiyoriy)' });
    desc.value = p && p.description ? p.description : '';
    const status = h('select', {}, h('option', { value: 'ACTIVE', text: 'Faol (ko‘rinadi)' }), h('option', { value: 'INACTIVE', text: 'Yashirin' }));
    status.value = p ? p.status : 'ACTIVE';
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
        const up = await uploadImage(blob);
        if (!up.ok) err.textContent = up.message;
        else { imageUrl = up.url; drawPreview(); }
      } catch (_e) {
        err.textContent = 'Rasmni o‘qib bo‘lmadi.';
      } finally {
        pick.disabled = false; pick.textContent = 'Rasm tanlash';
      }
    });

    openSheet(p ? 'Sovrinni tahrirlash' : 'Sovrin qo‘shish', (close) => {
      const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const pl = Number(place.value);
        const q = Number(qty.value);
        if (!title.value.trim()) { err.textContent = 'Sovrin nomini kiriting.'; return; }
        if (!Number.isInteger(pl) || pl < 1 || pl > 100) { err.textContent = 'O‘rin 1 dan 100 gacha bo‘lsin.'; return; }
        if (!Number.isInteger(q) || q < 1 || q > 1000) { err.textContent = 'Soni 1 dan 1000 gacha bo‘lsin.'; return; }
        const body = {
          place: pl, title: title.value.trim(), description: desc.value.trim(), value: value.value.trim(),
          quantity: q, status: status.value, imageUrl,
        };
        save.disabled = true;
        const res = p ? await call('PATCH', '/prizes/' + p.id, body) : await call('POST', `/competitions/${c.id}/prizes`, body);
        save.disabled = false;
        if (!ok(res)) { err.textContent = msgOf(res, 'Saqlab bo‘lmadi'); return; }
        close();
        toast('Sovrin saqlandi');
        render();
      });
      return h('div', {},
        h('div', { class: 'upl field' }, preview, h('div', { class: 'btns', style: 'margin:0' }, pick, drop), file),
        field('Nomi', title),
        h('div', { class: 'two' }, field('O‘rin (place)', place), field('Soni', qty)),
        field('Qiymati', value), field('Tavsif', desc), field('Holat', status), err, save);
    });
  }

  function winnerForm(w) {
    const allowed = NEXT_WINNER[w.status] || [];
    const sel = h('select', {}, h('option', { value: w.status, text: STATUS_UZ[w.status] + ' (hozirgi)' }),
      ...allowed.map((s) => h('option', { value: s, text: STATUS_UZ[s] })));
    sel.value = w.status;
    const note = h('textarea', { maxlength: '500', placeholder: 'Izoh (masalan: bog‘lanish usuli)' });
    note.value = w.note || '';
    const err = h('p', { class: 'errtxt', role: 'alert' });

    openSheet(`${placeLabel(w.place)} ${nameOf(w.user)}`, (close) => {
      const save = h('button', { class: 'btn block', type: 'button', text: 'Saqlash' });
      save.addEventListener('click', async () => {
        err.textContent = '';
        const body = {};
        if (sel.value !== w.status) body.status = sel.value;
        if ((note.value.trim() || null) !== (w.note || null)) body.note = note.value.trim();
        if (!Object.keys(body).length) { close(); return; }
        save.disabled = true;
        const res = await call('PATCH', '/winners/' + w.id, body);
        save.disabled = false;
        if (!ok(res)) { err.textContent = msgOf(res, 'Saqlab bo‘lmadi'); return; }
        close();
        toast('Yangilandi');
        render();
      });
      return h('div', {}, h('div', { class: 'muted', text: `🎁 ${w.prize}` }), field('Holat', sel), field('Izoh', note), err, save);
    });
  }

  // ---------- Amallar ----------
  async function activateCompetition(c) {
    if (!(await confirmBox(`"${c.title}" faollashtirilsinmi? Foydalanuvchilar reklama ko‘rib ball to‘play boshlaydi.`))) return;
    const res = await call('POST', `/competitions/${c.id}/activate`);
    if (!ok(res)) return toast(msgOf(res), true);
    toast('Chempionat faollashtirildi');
    render();
  }
  async function endCompetition(c) {
    if (!(await confirmBox(`"${c.title}" hozir tugatilsinmi? G‘oliblar aniqlanadi, buni qaytarib bo‘lmaydi.`))) return;
    const res = await call('POST', `/competitions/${c.id}/end`);
    if (!ok(res)) return toast(msgOf(res), true);
    toast(`Tugatildi. G‘oliblar: ${res.data.winners}`);
    render();
  }
  async function archiveCompetition(c) {
    if (!(await confirmBox(`"${c.title}" arxivlansinmi? Ma’lumotlar saqlanadi.`))) return;
    const res = await call('POST', `/competitions/${c.id}/archive`);
    if (!ok(res)) return toast(msgOf(res), true);
    toast('Arxivlandi');
    render();
  }
  async function deleteCompetition(c) {
    if (!(await confirmBox(`"${c.title}" qoralamasi o‘chirilsinmi?`))) return;
    const res = await call('DELETE', '/competitions/' + c.id);
    if (!ok(res)) return toast(msgOf(res), true);
    toast('O‘chirildi');
    st.detailId = null;
    render();
  }
  async function deletePrize(p) {
    if (!(await confirmBox(`"${p.title}" sovrini o‘chirilsinmi?`))) return;
    const res = await call('DELETE', '/prizes/' + p.id);
    if (!ok(res)) return toast(msgOf(res), true);
    toast('Sovrin o‘chirildi');
    render();
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

  async function uploadImage(blob) {
    try {
      const res = await fetch('/api/admin/uploads/prize-image', {
        method: 'POST',
        headers: { Authorization: 'tma ' + ((tg && tg.initData) || ''), 'Content-Type': blob.type },
        body: blob,
      });
      let data = null;
      try { data = await res.json(); } catch (_e) { /* bo'sh */ }
      if (res.ok && data && data.success) return { ok: true, url: data.url };
      return { ok: false, message: (data && data.message) || 'Rasm yuklanmadi.' };
    } catch (_e) {
      return { ok: false, message: 'Tarmoq xatosi.' };
    }
  }

  window.AdRushAdmin = { mount, onShow };
})();