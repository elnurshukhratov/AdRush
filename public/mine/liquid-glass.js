/* AdRush — Liquid Glass runtime v4. mine.js'ga tegmaydi: faqat CSS o'zgaruvchilari, qo'shimcha qatlamlar va class'larni boshqaradi.
   Glass faqat controls qatlamida (tab bar, chip, me-card, toast, CTA); content plitalari shishasiz. */
(function () {
  'use strict';
  var root = document.documentElement, body = document.body;
  var $ = function (id) { return document.getElementById(id); };
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lite = root.classList.contains('lite');
  var nav = $('nav'), navInd = $('navInd');
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  root.classList.add('lg-on');

  /* 1. Content qatlami rangi: shisha sindirib ko'rsatadigan yorug'lik, scroll va qiyalikka parallaks */
  var bg = document.createElement('div');
  bg.className = 'lg-bg'; bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = '<i class="o1"></i><i class="o2"></i><i class="o3"></i><i class="o4"></i>';
  body.insertBefore(bg, body.firstChild);

  /* 2. Progressive edge blur (yuqori va pastki) — 5 qatlam, har biri kuchliroq blur */
  ['t', 'b'].forEach(function (k) {
    var d = document.createElement('div');
    d.className = 'lg-pb ' + k; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<i></i><i></i>';
    body.appendChild(d);
  });

  /* 3. Lensing: SDF asosidagi haqiqiy displacement xaritasi + xromatik aberratsiya (Chromium/Android WebView) */
  function makeMap(w, h, r, bezel, magnify) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    var hx = w / 2, hy = h / 2; r = Math.min(r, hx, hy);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var px = x + .5 - hx, py = y + .5 - hy, qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
      var ox = Math.max(qx, 0), oy = Math.max(qy, 0), len = Math.sqrt(ox * ox + oy * oy);
      var sdf = len + Math.min(Math.max(qx, qy), 0) - r, dist = -sdf;
      var gx, gy;
      if (qx > 0 && qy > 0) { gx = ox / len * Math.sign(px); gy = oy / len * Math.sign(py); }
      else if (qx > qy) { gx = Math.sign(px); gy = 0; } else { gx = 0; gy = Math.sign(py); }
      var t = clamp(dist / bezel, 0, 1), m = Math.pow(1 - t, 2.2);
      var vx = -gx * m, vy = -gy * m;                       // qirra ichkariga qarab egiladi
      if (magnify) { vx += -px / hx * .38; vy += -py / hy * .38; }  // markaz kattalashadi (loupe)
      var i = (y * w + x) * 4;
      d[i] = clamp(128 + vx * 127, 0, 255); d[i + 1] = clamp(128 + vy * 127, 0, 255); d[i + 2] = 128; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  function ch(src, row) { return '<feColorMatrix in="' + src + '" type="matrix" values="' + row + '" result="' + src + 'c"/>'; }
  function lens(id, map, s) {
    return '<filter id="' + id + '" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      '<feImage href="' + map + '" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="m"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + s + '" xChannelSelector="R" yChannelSelector="G" result="r"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + (s * .93) + '" xChannelSelector="R" yChannelSelector="G" result="g"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + (s * .86) + '" xChannelSelector="R" yChannelSelector="G" result="b"/>' +
      ch('r', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0') + ch('g', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0') + ch('b', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0') +
      '<feBlend in="rc" in2="gc" mode="screen" result="rg"/><feBlend in="rg" in2="bc" mode="screen"/></filter>';
  }
  var svgHost = null;
  function buildLens() {
    if (!nav || !navInd) return;
    var n = nav.getBoundingClientRect(), i = navInd.getBoundingClientRect();
    if (n.width < 40) return;
    var nw = Math.round(n.width), nh = Math.round(n.height || 64), iw = Math.max(40, Math.round(i.width)), ih = Math.max(40, Math.round(i.height || 54));
    svgHost.innerHTML = '<svg width="0" height="0">' + lens('lg-ind', makeMap(iw, ih, ih / 2, 16, true), 34) + '</svg>';
  }
  try {
    var apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
    if (!lite && !apple && window.CSS && CSS.supports('backdrop-filter', 'url(#lg-nav)')) {
      svgHost = document.createElement('div');
      svgHost.setAttribute('aria-hidden', 'true'); svgHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      body.appendChild(svgHost);
      var rs = 0;
      window.addEventListener('resize', function () { clearTimeout(rs); rs = setTimeout(buildLens, 200); });
      setTimeout(function () { buildLens(); root.classList.add('lg-refract'); }, 60);
    }
  } catch (e) {}

  /* 4. Scroll-reaktiv: --sp (0..1), yorug'lik burchagi --ang (+ giroskop), parallaks, tab bar ixchamlashishi */
  var lastY = window.scrollY, tick = false, tiltX = 0, tiltY = 0, adaptT = 0, lastSp = -1, lastAng = -1, scrollT = 0;
  function frame() {
    tick = false;
    var y = Math.max(0, window.scrollY);
    var sp = Math.round(clamp(y / 110, 0, 1) * 8) / 8;            // 8 pog'ona: butun sahifa qayta hisoblanmaydi
    if (sp !== lastSp) { lastSp = sp; root.style.setProperty('--sp', sp); }
    var ang = Math.round((135 + tiltX * 28) / 8) * 8;              // yorug'lik burchagi faqat qiyalikka bog'liq
    if (ang !== lastAng) { lastAng = ang; root.style.setProperty('--ang', ang + 'deg'); }
    if (nav && !reduce) {
      if (y > lastY + 6 && y > 90) nav.classList.add('mini');
      else if (y < lastY - 6 || y < 40) nav.classList.remove('mini');
    }
    if (y !== lastY) {
      root.classList.add('scrolling');
      clearTimeout(scrollT);
      scrollT = setTimeout(function () { root.classList.remove('scrolling'); adapt(); }, 140);
      var now = Date.now();
      if (now - adaptT > 400) { adaptT = now; adapt(); }
    }
    lastY = y;
  }
  function req() { if (!tick) { tick = true; requestAnimationFrame(frame); } }
  window.addEventListener('scroll', req, { passive: true });
  window.addEventListener('resize', req, { passive: true });
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma == null) return;
      tiltX = clamp(e.gamma / 35, -1, 1); tiltY = clamp(((e.beta || 0) - 45) / 35, -1, 1);
      bg.style.setProperty('--px', tiltX.toFixed(2)); bg.style.setProperty('--py', tiltY.toFixed(2)); req();
    }, { passive: true });
  }
  if (matchMedia('(hover:hover)').matches) {
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      bg.style.setProperty('--px', ((e.clientX / innerWidth) * 2 - 1).toFixed(2));
      bg.style.setProperty('--py', ((e.clientY / innerHeight) * 2 - 1).toFixed(2));
    }, { passive: true });
  }

  /* 5. Kontekstga moslashuvchan kontrast: kichik element (tab bar) ostidagi kontent yorqinligiga qarab light/dark almashadi. Katta elementlar (sheet, me-card) almashmaydi */
  function lum(cs) {
    var m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/.exec(cs);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < .3) return null;
    return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
  }
  function adapt() {
    if (!nav || nav.hidden || !document.elementsFromPoint) return;
    var r = nav.getBoundingClientRect(), y = r.top + r.height / 2, light = root.dataset.theme === 'light', sum = 0, n = 0;
    [.18, .38, .62, .82].forEach(function (f) {
      var els = document.elementsFromPoint(r.left + r.width * f, y), L = null;
      for (var i = 0; i < els.length && L === null; i++) {
        var e = els[i];
        if (nav.contains(e) || e === root || e === body || e.classList.contains('lg-bg') || (e.parentNode && e.parentNode.classList && e.parentNode.classList.contains('lg-pb'))) continue;
        if (e.closest('.cta,.hero,.btn:not(.sec),.pod.p1')) { L = .3; break; }
        L = lum(getComputedStyle(e).backgroundColor);
      }
      sum += (L === null ? (light ? .93 : .04) : L); n++;
    });
    var ctx = sum / n > .55 ? 'light' : 'dark';
    if (nav.dataset.ctx !== ctx) nav.dataset.ctx = ctx;
  }
  /* Kontekst ranglari (.nav[data-ctx]) liquid-glass.css ichida */
  new MutationObserver(function () { adaptT = 0; req(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('pointerup', function () { setTimeout(function () { adaptT = 0; req(); }, 120); }, { passive: true });
  req();

  /* 6. Specular: barmoq/kursor ostida yorug'lik dog'i (--mx/--my/--lit), faqat controls'da */
  var SEL = '.cta,.chip,.tab,.nav,.me-card'; // faqat glass elementlar: content plitalarida yorug'lik dog'i yo'q
  function spec(e, on) {
    var t = e.target && e.target.closest && e.target.closest(SEL);
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    t.style.setProperty('--lit', on ? '1' : '0');
  }
  document.addEventListener('pointerdown', function (e) { spec(e, true); }, { passive: true });
  document.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'mouse') spec(e, true); }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(function (n) { document.addEventListener(n, function (e) { spec(e, false); }, { passive: true }); });

  /* 7. Suyuq morphing: indikator tezligiga qarab cho'ziladi (hajm saqlanadi), to'xtaganda spring bilan yig'iladi */
  function morph(ind) {
    if (!ind || reduce) return;
    var raf = 0, lastC = null, lastT = 0, still = 0;
    function step(t) {
      if (ind.classList.contains('dragging')) { ind.style.scale = ''; raf = 0; lastC = null; return; }
      var rc = ind.getBoundingClientRect(), c = rc.left + rc.width / 2;
      if (lastC !== null) {
        var v = (c - lastC) / Math.max(1, t - lastT), a = Math.abs(v);
        var sx = 1 + Math.min(a * .42, .42);
        ind.style.scale = sx.toFixed(3) + ' ' + (1 / Math.sqrt(sx)).toFixed(3);
        still = a < .03 ? still + 1 : 0;
        if (still > 4) { ind.style.scale = ''; raf = 0; lastC = null; return; }
      }
      lastC = c; lastT = t; raf = requestAnimationFrame(step);
    }
    new MutationObserver(function () {
      if (!raf && !ind.classList.contains('dragging')) { lastC = null; still = 0; raf = requestAnimationFrame(step); }
    }).observe(ind, { attributes: true, attributeFilter: ['style'] });
  }
  morph(navInd); morph($('champInd'));

  /* 8. Faol tab (bubble) ustidan bosib sudrash: tab'lar bubble ustida turgani uchun hodisani indikatorga uzatamiz */
  if (nav && navInd) {
    nav.addEventListener('pointerdown', function (e) {
      var t = e.target.closest && e.target.closest('.tab.active');
      if (!t || e.target === navInd) return;
      navInd.dispatchEvent(new PointerEvent('pointerdown', { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType, bubbles: true, cancelable: true }));
    });
  }
})();