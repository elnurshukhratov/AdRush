/* eslint-disable */
/**
 * AdRush — OVOZLAR. Fayl kerak emas: hamma ovoz Web Audio bilan sintez qilinadi.
 * mine.js DAN OLDIN yuklanadi, window.AdRushSound orqali ishlaydi.
 *   play(name, delayMs?)  — tap | select | move | capture | check | success | warn | error | win | lose | draw
 *   haptic(kind)          — mine.js haptic() turlarini (select/light/success/warning/error) ovozga aylantiradi
 *   isEnabled() / setEnabled(bool) — foydalanuvchi sozlamasi (profildagi 🔊 tugmasi), localStorage da saqlanadi
 */
(function () {
  'use strict';

  const KEY = 'adrush_sound';
  let ctx = null;
  let master = null;
  let on = true;
  const lastAt = {};

  try { on = localStorage.getItem(KEY) !== '0'; } catch (_e) { /* localStorage yo'q — doim yoqilgan */ }

  function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch (_e) { ctx = null; }
    return ctx;
  }

  // Brauzer ovozni faqat foydalanuvchining birinchi bosishidan keyin ruxsat beradi.
  function unlock() {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true, capture: true }));

  function tone(c, t, f, d, type, vol, to) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.02);
  }

  // Yog'och "klak" uchun qisqa shovqin
  function noise(c, t, d, f, q, vol) {
    const len = Math.max(1, Math.floor(c.sampleRate * d));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource();
    s.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t);
  }

  const SOUNDS = {
    tap: (c, t) => tone(c, t, 900, 0.05, 'sine', 0.14),
    select: (c, t) => tone(c, t, 1250, 0.035, 'triangle', 0.11),
    move: (c, t) => { noise(c, t, 0.05, 1800, 1.2, 0.55); tone(c, t, 230, 0.08, 'sine', 0.38, 140); },
    capture: (c, t) => {
      noise(c, t, 0.09, 1200, 0.9, 0.85); tone(c, t, 170, 0.13, 'triangle', 0.5, 90);
      noise(c, t + 0.07, 0.05, 1700, 1.2, 0.4);
    },
    check: (c, t) => { tone(c, t, 740, 0.12, 'triangle', 0.2); tone(c, t + 0.11, 988, 0.16, 'triangle', 0.2); },
    success: (c, t) => { tone(c, t, 660, 0.1, 'sine', 0.2); tone(c, t + 0.09, 880, 0.16, 'sine', 0.2); },
    warn: (c, t) => tone(c, t, 340, 0.2, 'triangle', 0.2, 260),
    error: (c, t) => { tone(c, t, 190, 0.12, 'sawtooth', 0.09); tone(c, t + 0.14, 160, 0.16, 'sawtooth', 0.09); },
    win: (c, t) => [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.11, f, i === 3 ? 0.34 : 0.16, 'triangle', 0.24)),
    lose: (c, t) => [392, 330, 262].forEach((f, i) => tone(c, t + i * 0.16, f, i === 2 ? 0.34 : 0.2, 'triangle', 0.22)),
    draw: (c, t) => { tone(c, t, 440, 0.16, 'sine', 0.2); tone(c, t + 0.18, 440, 0.22, 'sine', 0.2); },
  };

  const HAPTIC_MAP = { select: 'select', light: 'tap', success: 'success', warning: 'warn', error: 'error' };

  function play(name, delayMs) {
    if (!on || document.hidden) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const now = Date.now();
    if (now - (lastAt[name] || 0) < 35) return; // bir vaqtda ikki marta chalinishining oldini oladi
    lastAt[name] = now;
    const c = getCtx();
    if (!c) return;
    if (c.state !== 'running') { c.resume().catch(() => {}); return; } // hali ruxsat yo'q — kechikib chalinmasin
    try { fn(c, c.currentTime + 0.005 + (delayMs || 0) / 1000); } catch (_e) { /* ovoz ixtiyoriy */ }
  }

  function setEnabled(v) {
    on = Boolean(v);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_e) { /* ixtiyoriy */ }
  }

  function paint(btn) {
    const span = btn.querySelector('span') || btn;
    span.textContent = on ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Sound: on' : 'Sound: off';
  }

  function bind() {
    const btn = document.getElementById('soundBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    paint(btn);
    btn.addEventListener('click', () => {
      setEnabled(!on);
      paint(btn);
      if (on) play('tap');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.AdRushSound = {
    play,
    haptic: (kind) => { const n = HAPTIC_MAP[kind]; if (n) play(n); },
    isEnabled: () => on,
    setEnabled,
  };
})();