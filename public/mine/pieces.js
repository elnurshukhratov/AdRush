'use strict';

/**
 * AdRush — shaxmat va shashka donalari (v7: "Kristall" to'plami).
 * chess.js dan OLDIN yuklanadi, window.AdRushPieces orqali ulanadi (API o'zgarmagan: make / small / mount).
 *
 * Shahmat: har bir dona qirrali kristall (gem-cut) shaklida — chap yarmi yorug', o'ng yarmi soyada.
 * Qirralar yarim shakldan avtomatik akslantiriladi, shuning uchun hamma dona simmetrik va aniq.
 * Oq to'plam — muz / marvarid + oltin zumrad, qora to'plam — safir + moviy nur.
 * Shashka: dumaloq "kesilgan tosh" (8 qirrali konus + sakkizburchak jilvali markaz); damka — nurli toj.
 * Ranglar CSS o'zgaruvchilaridan (--pz-*), pastdagi STYLE ichida; tashqi rasm / shrift yo'q.
 * Shashka donalari checkers.js dagi mavjud sinflarga (.ckp, .ckp.w / .b / .k) faqat CSS orqali ulanadi.
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const AX = 22.5; // simmetriya o'qi (viewBox 45x45)

  const TONE = { a: 'var(--pz-a)', b: 'var(--pz-b)', c: 'var(--pz-c)' };
  const mx = (x) => +(45 - x).toFixed(2);
  const pstr = (arr, mirror) => arr.map((p) => (mirror ? mx(p[0]) : p[0]) + ',' + p[1]).join(' ');

  // Chap yarim qirralar: p — nuqtalar (o'qdagi nuqtalar x=22.5), l / r — chap / o'ng ton (a — yorug', b — o'rta, c — soya)
  const BASE = [
    { p: [[AX, 36], [12.8, 36], [10.2, 40.8], [AX, 40.8]], l: 'b', r: 'c' },
    { p: [[AX, 33.6], [14, 33.6], [12.8, 36], [AX, 36]], l: 'a', r: 'b' },
  ];

  const SPEC = {
    p: {
      bands: [
        { p: [[AX, 20.8], [20.4, 20.8], [19.4, 33.6], [AX, 33.6]], l: 'a', r: 'b' },
        { p: [[20.4, 20.8], [18, 20.8], [15.8, 33.6], [19.4, 33.6]], l: 'b', r: 'c' },
        { p: [[AX, 18.2], [17.2, 18.2], [15.4, 21], [AX, 21]], l: 'a', r: 'b' },
        { p: [[AX, 4.8], [18, 7.8], [AX, 11.4]], l: 'a', r: 'b' },
        { p: [[18, 7.8], [17.2, 12.6], [AX, 11.4]], l: 'b', r: 'c' },
        { p: [[17.2, 12.6], [19.8, 17.6], [AX, 18.6], [AX, 11.4]], l: 'c', r: 'c' },
      ],
      sparks: [[20.6, 8.4, 1.5]],
    },
    r: {
      bands: [
        { p: [[AX, 19.4], [20.2, 19.4], [19.6, 33.6], [AX, 33.6]], l: 'a', r: 'b' },
        { p: [[20.2, 19.4], [17.2, 19.4], [15.6, 33.6], [19.6, 33.6]], l: 'b', r: 'c' },
        { p: [[AX, 15.4], [13.8, 15.4], [16, 19.6], [AX, 19.6]], l: 'a', r: 'b' },
        { p: [[17.4, 11.6], [20.6, 11.6], [20.6, 15.4], [17.4, 15.4]], l: 'c', r: 'c' },
        { p: [[20.6, 7.6], [AX, 7.6], [AX, 15.4], [20.6, 15.4]], l: 'a', r: 'b' },
        { p: [[13.8, 7.6], [17.4, 7.6], [17.4, 15.4], [13.8, 15.4]], l: 'a', r: 'b' },
      ],
      sparks: [[15.4, 10.4, 1.4]],
    },
    b: {
      bands: [
        { p: [[AX, 22], [20.4, 22], [19.6, 33.6], [AX, 33.6]], l: 'a', r: 'b' },
        { p: [[20.4, 22], [17.6, 22], [15.8, 33.6], [19.6, 33.6]], l: 'b', r: 'c' },
        { p: [[AX, 19.6], [17, 19.6], [15.6, 22.8], [AX, 22.8]], l: 'a', r: 'b' },
        { p: [[AX, 6.2], [18.2, 12.4], [AX, 14.4]], l: 'a', r: 'b' },
        { p: [[18.2, 12.4], [17.4, 16.4], [20, 19.8], [AX, 19.8], [AX, 14.4]], l: 'b', r: 'c' },
        { p: [[AX, 2.8], [20.8, 5], [AX, 7.2]], l: 'a', r: 'b' },
      ],
      lines: ['M23.4 12.8L26.4 9.8'],
      sparks: [[19.6, 11.8, 1.4]],
    },
    q: {
      bands: [
        { p: [[AX, 22.4], [20.4, 22.4], [19.4, 33.6], [AX, 33.6]], l: 'a', r: 'b' },
        { p: [[20.4, 22.4], [16.2, 22.4], [14.8, 33.6], [19.4, 33.6]], l: 'b', r: 'c' },
        { p: [[AX, 19.4], [11.2, 19.4], [13.4, 22.6], [AX, 22.6]], l: 'a', r: 'b' },
        { p: [[9.4, 7], [13.4, 14.6], [AX, 19.6], [11.2, 19.6]], l: 'b', r: 'c' },
        { p: [[16.8, 6], [19.6, 13.2], [AX, 19.6], [13.4, 14.6]], l: 'a', r: 'b' },
        { p: [[AX, 4.4], [19.6, 13.2], [AX, 19.6]], l: 'a', r: 'b' },
      ],
      gems: [[AX, 3.8, 1.5], [16.8, 5.2, 1.5], [9.4, 6.2, 1.5]],
      sparks: [[18.2, 10.6, 1.4]],
    },
    k: {
      bands: [
        { p: [[AX, 22.6], [20.4, 22.6], [19.4, 33.6], [AX, 33.6]], l: 'a', r: 'b' },
        { p: [[20.4, 22.6], [16.4, 22.6], [15, 33.6], [19.4, 33.6]], l: 'b', r: 'c' },
        { p: [[AX, 19.6], [12.4, 19.6], [14, 22.8], [AX, 22.8]], l: 'a', r: 'b' },
        { p: [[AX, 12.6], [19.8, 13.2], [20.4, 19.8], [AX, 19.8]], l: 'a', r: 'b' },
        { p: [[19.8, 13.2], [16, 15.2], [15.6, 19.8], [20.4, 19.8]], l: 'b', r: 'c' },
        { p: [[16, 15.2], [12.4, 18.6], [12.4, 19.8], [15.6, 19.8]], l: 'c', r: 'c' },
        { p: [[AX, 2.2], [21.1, 2.2], [21.1, 4.8], [18.6, 4.8], [18.6, 7], [21.1, 7], [21.1, 12.8], [AX, 12.8]], l: 'a', r: 'b' },
      ],
      sparks: [[17.6, 16.2, 1.3]],
    },
  };

  // Ot — nosimmetrik (chapga qaragan), tayyor qirralar
  const KNIGHT = {
    facets: [
      { p: [[28.6, 9], [33, 17], [33.8, 26], [33.6, 33.6], [25, 33.6], [27, 22], [26.4, 12]], t: 'c' },
      { p: [[26.4, 12], [27, 22], [25, 33.6], [14.6, 33.6], [17.4, 26], [20, 20.4], [24.4, 14]], t: 'b' },
      { p: [[25.4, 4.8], [28.6, 9], [26.4, 12], [21.8, 8.6]], t: 'b' },
      { p: [[21.8, 8.6], [26.4, 12], [24.4, 14], [18.4, 16.4], [15.4, 12.2]], t: 'a' },
      { p: [[15.4, 12.2], [18.4, 16.4], [16.8, 22.2], [12.4, 22.6], [11, 19]], t: 'b' },
      { p: [[18.4, 16.4], [24.4, 14], [20, 20.4], [16.8, 22.2]], t: 'c' },
    ],
    dots: [[21.2, 13.6, 1.15, 'line'], [12.9, 19.6, 0.75, 'line']],
    lines: ['M29.6 11.6L27.4 22.4', 'M31.6 17L29 27'],
    sparks: [[18.6, 11.4, 1.5]],
  };

  const EDGE = 'stroke:var(--pz-edge);stroke-width:.35;stroke-linejoin:round';
  const OUT = 'fill:var(--pz-line);stroke:var(--pz-line);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round';

  function poly(points, style) {
    return '<polygon points="' + points + '" style="' + style + '"/>';
  }

  function diamond(x, y, s, mirror) {
    const cx = mirror ? mx(x) : x;
    return '<path d="M' + cx + ' ' + (y - s * 1.5) + 'L' + (cx + s * 0.8) + ' ' + y + 'L' + cx + ' ' + (y + s * 1.5)
      + 'L' + (cx - s * 0.8) + ' ' + y + 'z" style="fill:var(--pz-hl);stroke:none"/>';
  }

  function gem(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" style="fill:var(--pz-gem);stroke:var(--pz-line);stroke-width:.8"/>'
      + '<circle cx="' + (x - r * 0.3) + '" cy="' + (y - r * 0.35) + '" r="' + (r * 0.3) + '" style="fill:var(--pz-hl);stroke:none"/>';
  }

  function lineP(d) {
    return '<path d="' + d + '" style="fill:none;stroke:var(--pz-line);stroke-width:1.2;stroke-linecap:round"/>';
  }

  /** Bir donaning ichki SVG belgilari (symbol ichiga) */
  function build(key) {
    const out = [];
    if (key === 'n') {
      const f = KNIGHT.facets.map((x) => [pstr(x.p, false), x.t]);
      const base = BASE.map((b) => [pstr(b.p, false), b.l, pstr(b.p, true), b.r]);
      // 1) tashqi kontur (barcha qirralar qalin chiziq bilan)
      base.forEach((b) => { out.push(poly(b[0], OUT)); out.push(poly(b[2], OUT)); });
      f.forEach((x) => out.push(poly(x[0], OUT)));
      // 2) rangli qirralar
      base.forEach((b) => {
        out.push(poly(b[0], 'fill:' + TONE[b[1]] + ';' + EDGE));
        out.push(poly(b[2], 'fill:' + TONE[b[3]] + ';' + EDGE));
      });
      f.forEach((x) => out.push(poly(x[0], 'fill:' + TONE[x[1]] + ';' + EDGE)));
      KNIGHT.lines.forEach((d) => out.push('<path d="' + d + '" style="fill:none;stroke:var(--pz-edge);stroke-width:.9;stroke-linecap:round"/>'));
      KNIGHT.dots.forEach((d) => out.push('<circle cx="' + d[0] + '" cy="' + d[1] + '" r="' + d[2] + '" style="fill:var(--pz-line);stroke:none"/>'));
      KNIGHT.sparks.forEach((s) => out.push(diamond(s[0], s[1], s[2], false)));
      return out.join('');
    }
    const spec = SPEC[key];
    const list = BASE.concat(spec.bands); // asosdagi poydevor + dona qirralari (pastdan yuqoriga chiziladi)
    list.forEach((b) => { out.push(poly(pstr(b.p, false), OUT)); out.push(poly(pstr(b.p, true), OUT)); });
    list.forEach((b) => {
      out.push(poly(pstr(b.p, false), 'fill:' + TONE[b.l] + ';' + EDGE));
      out.push(poly(pstr(b.p, true), 'fill:' + TONE[b.r] + ';' + EDGE));
    });
    (spec.lines || []).forEach((d) => out.push(lineP(d)));
    (spec.gems || []).forEach((g) => {
      out.push(gem(g[0], g[1], g[2]));
      if (Math.abs(g[0] - AX) > 0.01) out.push(gem(mx(g[0]), g[1], g[2]));
    });
    (spec.sparks || []).forEach((s) => out.push(diamond(s[0], s[1], s[2], false)));
    return out.join('');
  }

  const SYMBOLS = {};
  ['p', 'r', 'n', 'b', 'q', 'k'].forEach((k) => { SYMBOLS[k] = build(k); });

  // ---- CSS (donalar rangi + shashka): chess.css dan keyin qo'shiladi, shuning uchun u yerdagi eski qoidalarni bosib o'tadi ----
  const STYLE = [
    /* Shahmat: oq — muz / marvarid + oltin zumrad; qora — safir + moviy nur */
    '.pc.w, .cp.w { --pz-a: #FFFFFF; --pz-b: #D3E4F7; --pz-c: #97B2D6; --pz-line: #10203D; --pz-edge: rgba(16, 32, 61, .38); --pz-hl: rgba(255, 255, 255, .98); --pz-gem: #F6B73C; }',
    '.pc.b, .cp.b { --pz-a: #6A93D8; --pz-b: #3A5FA8; --pz-c: #1B2F66; --pz-line: #040916; --pz-edge: rgba(4, 9, 22, .6); --pz-hl: rgba(196, 244, 255, .92); --pz-gem: #67E8F9; }',
    '.pc.w { filter: drop-shadow(0 2px 1.6px rgba(0, 0, 0, .42)); }',
    '.pc.b { filter: drop-shadow(0 0 .9px rgba(103, 232, 249, .8)) drop-shadow(0 2px 1.6px rgba(0, 0, 0, .5)); }',
    '.cpromo-row .pc.w { --pz-a: #FFFFFF; --pz-b: #D3E4F7; --pz-c: #97B2D6; }',

    /* Shashka: kesilgan tosh — 8 qirrali konus + sakkizburchak markaz */
    '.ckp.w { border: 2px solid #10203D;',
    '  background: conic-gradient(from 22.5deg, #FFFFFF 0 12.5%, #D3E4F7 12.5% 25%, #F2F8FF 25% 37.5%, #B4CBEA 37.5% 50%, #E4EFFC 50% 62.5%, #9DB6D8 62.5% 75%, #F7FBFF 75% 87.5%, #C2D6F0 87.5% 100%);',
    '  box-shadow: 0 3px 0 rgba(4, 9, 22, .45), 0 6px 9px rgba(0, 0, 0, .4), inset 0 -3px 4px rgba(16, 32, 61, .22), inset 0 2px 2px rgba(255, 255, 255, .7); }',
    '.ckp.b { border: 2px solid #040916;',
    '  background: conic-gradient(from 22.5deg, #5F88CF 0 12.5%, #2E4E92 12.5% 25%, #4A74BE 25% 37.5%, #1B3270 37.5% 50%, #3C63AE 50% 62.5%, #14275C 62.5% 75%, #5380C8 75% 87.5%, #213A7A 87.5% 100%);',
    '  box-shadow: 0 0 0 1px rgba(103, 232, 249, .6), 0 3px 0 rgba(0, 0, 0, .5), 0 6px 9px rgba(0, 0, 0, .45), inset 0 -3px 4px rgba(0, 0, 0, .3), inset 0 2px 2px rgba(196, 244, 255, .35); }',
    '.ckp::before { inset: 22%; border: 0; border-radius: 0; clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); box-shadow: none; }',
    '.ckp.w::before { background: conic-gradient(from 0deg, #FFFFFF 0 25%, #E6F0FC 25% 50%, #CADBF1 50% 75%, #F4F9FF 75% 100%); }',
    '.ckp.b::before { background: conic-gradient(from 0deg, #7FA6E6 0 25%, #4D78C4 25% 50%, #2C4C92 50% 75%, #6C97DC 75% 100%); }',
    '.ckp.ckmini::before { display: none; }',
    '.ckp.ckmini { border-width: 1.5px; }',

    /* Damka: nurli toj */
    '.ckp.k { outline: 2px solid rgba(246, 183, 60, .75); outline-offset: -5px; }',
    '.ckp.b.k { outline-color: rgba(103, 232, 249, .8); }',
    '.ckp.w .ckcrown { fill: #F6B73C; stroke: #7A4E00; stroke-width: .9; stroke-linejoin: round; filter: drop-shadow(0 1px 0 rgba(255, 255, 255, .8)); }',
    '.ckp.b .ckcrown { fill: #67E8F9; stroke: #0A3550; stroke-width: .9; stroke-linejoin: round; filter: drop-shadow(0 0 3px rgba(103, 232, 249, .85)); }',
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || !document.head || document.getElementById('pz-style')) return;
    const st = document.createElement('style');
    st.id = 'pz-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  injectStyle();

  let ready = false;

  function mount() {
    if (ready || !document.body) return;
    ready = true;
    injectStyle();
    const defs = Object.keys(SYMBOLS).map((k) => '<symbol id="pcs-' + k + '" viewBox="0 0 45 45">' + SYMBOLS[k] + '</symbol>').join('');
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    holder.insertAdjacentHTML('afterbegin', '<svg xmlns="' + NS + '" width="0" height="0" focusable="false">' + defs + '</svg>');
    document.body.insertBefore(holder, document.body.firstChild);
  }

  /** ch: 'K','q' ... (katta harf — oq, kichik — qora). Qaytaradi: <span class="pc w|b"><svg class="pcs"><use/></svg></span> */
  function make(ch, cls) {
    mount();
    const white = ch === ch.toUpperCase();
    const key = ch.toLowerCase();
    const wrap = document.createElement('span');
    wrap.className = 'pc ' + (white ? 'w' : 'b') + (cls ? ' ' + cls : '');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pcs');
    svg.setAttribute('viewBox', '0 0 45 45');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#pcs-' + key);
    use.setAttributeNS(XLINK, 'xlink:href', '#pcs-' + key);
    svg.appendChild(use);
    wrap.appendChild(svg);
    return wrap;
  }

  /** Olingan figuralar qatori uchun kichik dona. */
  function small(key, white) {
    const n = make(white ? key.toUpperCase() : key);
    n.className = 'cp ' + (white ? 'w' : 'b');
    return n;
  }

  window.AdRushPieces = { make, small, mount, _symbols: SYMBOLS };
})();