'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

/** Express ilovani vaqtinchalik portda ishga tushirib, haqiqiy HTTP so'rov yuboradi. */
async function withServer(fn, opts) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

test('GET /health/live — 200', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health/live`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });
});

test('GET /health — DB ok bo\'lsa 200, shutdown paytida 503', async () => {
  const state = { shuttingDown: false };
  await withServer(async (base) => {
    const ok = await fetch(`${base}/health`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).db, 'ok');

    state.shuttingDown = true;
    const down = await fetch(`${base}/health`);
    assert.equal(down.status, 503);
  }, { state });
});

test('noma\'lum yo\'l — standart 404 formati', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'NOT_FOUND');
    assert.ok(body.requestId);
  });
});

test('Authorization yo\'q — 401 UNAUTHORIZED (leaderboard, competition, stats, ads)', async () => {
  await withServer(async (base) => {
    for (const [method, path] of [
      ['GET', '/api/leaderboard/current'],
      ['GET', '/api/competition/current'],
      ['GET', '/api/users/me'],
      ['GET', '/api/competition/history'],
      ['GET', '/api/users/me/stats'],
      ['POST', '/api/ads/session'],
      ['POST', '/api/ads/reward'],
    ]) {
      const res = await fetch(base + path, { method });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal((await res.json()).reason, 'UNAUTHORIZED');
    }
  });
});

test('soxta initData — 401', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/leaderboard/current`, { headers: { Authorization: 'tma query_id=x&auth_date=1&hash=' + 'a'.repeat(64) } });
    assert.equal(res.status, 401);
  });
});

test('AdsGram callback: noto\'g\'ri token — 403', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/adsgram/reward?userid=123&token=wrong`);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'FORBIDDEN');
  });
});

test('buzuq JSON — 400 INVALID_JSON', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ads/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).reason, 'INVALID_JSON');
  });
});

test('xavfsizlik sarlavhalari (API) mavjud, x-powered-by yo\'q', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/leaderboard/current`);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-request-id'));
  });
});

test('/mine statik sahifa iframe uchun ochiq (Telegram Web)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mine/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), null);
  });
});

test('webhook: noto\'g\'ri secret_token — 401', async () => {
  const { webhookCallback, Bot } = require('grammy');
  const bot = new Bot(process.env.BOT_TOKEN, { botInfo: { id: 1, is_bot: true, first_name: 'T', username: 't', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } });
  const webhookHandler = webhookCallback(bot, 'express', { secretToken: 'a_valid_secret_token_value_123' });
  await withServer(async (base) => {
    const res = await fetch(`${base}/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(res.status, 401);
  }, { webhookHandler });
});
