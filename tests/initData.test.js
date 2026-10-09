'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { validateInitData } = require('../src/api/middlewares/telegramAuth');

const BOT_TOKEN = process.env.BOT_TOKEN;

/** Telegram hujjatiga mos initData yasaydi (test uchun). */
function sign(fields, token = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const now = () => Math.floor(Date.now() / 1000);
const user = (o = {}) => JSON.stringify({ id: 777001, first_name: 'Ali', username: 'ali', ...o });

test('to\'g\'ri imzolangan initData qabul qilinadi', () => {
  const r = validateInitData(sign({ auth_date: String(now()), user: user(), query_id: 'AAA' }));
  assert.ok(r.user, JSON.stringify(r));
  assert.equal(r.user.id, 777001);
});

test('boshqa bot tokeni bilan imzolangan rad etiladi', () => {
  const r = validateInitData(sign({ auth_date: String(now()), user: user() }, '999:OTHER'));
  assert.equal(r.error, 'BAD_HASH');
});

test('o\'zgartirilgan (tampered) user rad etiladi', () => {
  const good = new URLSearchParams(sign({ auth_date: String(now()), user: user() }));
  good.set('user', user({ id: 1 })); // boshqa user ID ga almashtirish
  assert.equal(validateInitData(good.toString()).error, 'BAD_HASH');
});

test('eskirgan initData rad etiladi', () => {
  const old = now() - 7 * 24 * 3600;
  assert.equal(validateInitData(sign({ auth_date: String(old), user: user() })).error, 'EXPIRED');
});

test('kelajakdagi auth_date rad etiladi', () => {
  assert.equal(validateInitData(sign({ auth_date: String(now() + 3600), user: user() })).error, 'AUTH_DATE_IN_FUTURE');
});

test('bot foydalanuvchi rad etiladi', () => {
  const r = validateInitData(sign({ auth_date: String(now()), user: user({ is_bot: true }) }));
  assert.equal(r.error, 'BAD_USER');
});

test('hash yo\'q / noto\'g\'ri formatdagi kirishlar rad etiladi', () => {
  assert.equal(validateInitData('').error, 'MALFORMED');
  assert.equal(validateInitData(undefined).error, 'MALFORMED');
  assert.equal(validateInitData('a=b').error, 'NO_HASH');
  assert.equal(validateInitData('a=b&hash=zzz').error, 'NO_HASH');
  assert.equal(validateInitData('x'.repeat(5000)).error, 'MALFORMED');
});
