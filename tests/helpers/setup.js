'use strict';

/**
 * Unit testlar uchun: DB va tarmoqsiz muhit.
 * - majburiy env o'zgaruvchilari qo'yiladi
 * - @prisma/client soxta (stub) bilan almashtiriladi — testlar PostgreSQL talab qilmaydi
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456:TEST_TOKEN_FOR_UNIT_TESTS';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x';
process.env.ADSGRAM_REWARD_TOKEN = process.env.ADSGRAM_REWARD_TOKEN || 'test_reward_token_0123456789abcdef';
process.env.MINE_APP_URL = process.env.MINE_APP_URL || 'https://example.com/mine/';
process.env.REDIS_URL = '';

const Module = require('module');
const path = require('path');

const stub = {
  PrismaClient: class {
    constructor() {
      this.$on = () => {};
      this.$connect = async () => {};
      this.$disconnect = async () => {};
      this.$queryRaw = async () => [{ '?column?': 1 }];
    }
  },
};
const key = require.resolve('@prisma/client', { paths: [path.join(__dirname, '..', '..')] });
require.cache[key] = { id: key, filename: key, loaded: true, exports: stub, children: [], paths: [] };

module.exports = { Module };
