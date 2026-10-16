'use strict';

/**
 * AdRush — shaxmat donalari (SVG). chess.js dan OLDIN yuklanadi, window.AdRushPieces orqali ulanadi.
 * Sabab: ♞ ♜ kabi matn belgilari har qurilmada (iOS / Android / Windows) boshqa shriftda chiziladi va ba'zan emoji bo'lib ketadi.
 * SVG esa hamma joyda bir xil, aniq va har qanday taxta o'lchamida o'tkir ko'rinadi.
 * Ranglar CSS o'zgaruvchilaridan (--pcs-fill, --pcs-line) olinadi, shuning uchun Kun / Tun mavzusiga o'zi moslashadi.
 * Tashqi rasm / shrift yo'q; matn faqat o'zimizning statik SVG satrlari (foydalanuvchi ma'lumoti kirmaydi).
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';

  // Umumiy uslublar: hammasi style atributida (use-ichidagi daraxtga CSS o'zgaruvchilar meros bo'lib o'tadi)
  const B = 'style="fill:var(--pcs-fill);stroke:var(--pcs-line);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round"';
  const D = 'style="fill:none;stroke:var(--pcs-line);stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round"';
  const L = 'style="fill:var(--pcs-shine);stroke:none"'; // yorug' dog'
  const S = 'style="fill:var(--pcs-shade);stroke:none"'; // soya

  // Poydevor (barcha donalarda bir xil, faqat piyodada kichikroq)
  const BASE = '<path ' + B + ' d="M10.5 39.5c0-3 2.2-4.8 5-4.8h14c2.8 0 5 1.8 5 4.8z"/><path ' + S + ' d="M11 38.4h23l.3 1.1H10.7z"/>';

  const SYMBOLS = {
    p: '<circle ' + B + ' cx="22.5" cy="13.2" r="5.6"/><path ' + B + ' d="M17.5 35c0-6.5 1.6-11 5-14.2 3.4 3.2 5 7.7 5 14.2z"/>'
      + '<path ' + B + ' d="M13.5 39.5c0-2.8 1.8-4.5 4.4-4.5h9.2c2.6 0 4.4 1.7 4.5 4.5z"/>'
      + '<ellipse ' + L + ' cx="20.6" cy="11.4" rx="1.8" ry="2.4"/>',
    r: '<path ' + B + ' d="M12 9.5h5v3.2h3.5V9.5h4V12.7H28V9.5h5V18l-3 3v11l3 3v4.5H12V35l3-3V21l-3-3z"/>'
      + '<path ' + D + ' d="M12.5 18h20M15 21.5h15M15 32h15"/><path ' + L + ' d="M16 22.5h2.2v9H16z"/>',
    n: '<path ' + B + ' d="M13 39.5c0-9 1.8-14.4 6-18.2-2.3.2-4.3 1.5-6.2 3.7l-3.7-1.2c.6-3.5 3.3-6.4 6.5-9.2 1.5-1.3 2.6-3 3.3-5.4l2.3 2.2c6.7.3 13.4 5.2 14.4 16.2.4 4.3.5 8 .6 11.9z"/>'
      + '<circle style="fill:var(--pcs-line);stroke:none" cx="18.4" cy="15.2" r="1.35"/>'
      + '<path ' + D + ' d="M10.2 22.8l3.7-1.4M22 28.5c2.8-2.5 4.8-5.5 5.2-9.5"/><path ' + L + ' d="M21.6 11.8c3.6.6 6.4 2.6 8.2 6.2-2.4-2.2-5.2-3.6-8.2-4z"/>',
    b: '<path ' + B + ' d="M22.5 6.8c4.2 3 7.4 7.2 7.4 11 0 3-2 5.2-4.2 6.8 1.5 3 2.2 6 2.2 9.4H17.1c0-3.4.7-6.4 2.2-9.4-2.2-1.6-4.2-3.8-4.2-6.8 0-3.8 3.2-8 7.4-11z"/>'
      + '<circle ' + B + ' cx="22.5" cy="6" r="2.4"/><path ' + D + ' d="M19.8 15.4l5.4 5.4M17.5 34.2h10"/><path ' + L + ' d="M18.4 15c.6-2.4 2.2-4.4 3.6-5.6-1.8 2.2-2.8 5-2.2 8.2z"/>',
    q: '<path ' + B + ' d="M8.6 14.6l5.2 17.4 2.6-15.2 4.6 13.4 1.5-15.8 1.5 15.8 4.6-13.4 2.6 15.2 5.2-17.4-2.4 21.6H11z"/>'
      + '<circle ' + B + ' cx="8.6" cy="13.4" r="2.2"/><circle ' + B + ' cx="16.4" cy="15.4" r="2.2"/><circle ' + B + ' cx="22.5" cy="12.4" r="2.4"/>'
      + '<circle ' + B + ' cx="28.6" cy="15.4" r="2.2"/><circle ' + B + ' cx="36.4" cy="13.4" r="2.2"/><path ' + D + ' d="M11.8 32.5h21.4"/>',
    k: '<path ' + B + ' d="M20.7 3.6h3.6v3h3v3.6h-3v2.6h-3.6v-2.6h-3V6.6h3z"/>'
      + '<path ' + B + ' d="M22.5 14.4c-8.4 0-13.6 5-13.6 12 0 3.6 1.6 6.6 3.4 9.6h20.4c1.8-3 3.4-6 3.4-9.6 0-7-5.2-12-13.6-12z"/>'
      + '<path ' + D + ' d="M12.6 31.5h19.8M22.5 14.8v5"/><path ' + L + ' d="M14.6 24c.6-3.4 3-5.8 6.2-6.6-2.6 2-4 4.2-4.4 8z"/>',
  };

  let ready = false;

  function mount() {
    if (ready || !document.body) return;
    ready = true;
    const defs = Object.keys(SYMBOLS).map((k) => '<symbol id="pcs-' + k + '" viewBox="0 0 45 45">' + SYMBOLS[k] + (k === 'p' ? '' : BASE) + '</symbol>').join('');
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

  window.AdRushPieces = { make, small, mount };
})();
