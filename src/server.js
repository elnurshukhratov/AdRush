'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const { connectDb, disconnectDb } = require('./db/prisma');
const { getRedis, disconnectRedis } = require('./db/redis');
const { createApp } = require('./app');
const { createBot, createWebhookHandler, startBot, stopBot } = require('./bot');
const { startMaintenance } = require('./jobs/maintenance');

async function main() {
  await connectDb();
  getRedis(); // REDIS_URL bo'lsa ulanishni boshlaydi (rate limiterlar app yaratilishidan oldin tayyor bo'lishi uchun)

  const state = { shuttingDown: false };
  const bot = createBot();
  const app = createApp({ webhookHandler: createWebhookHandler(bot), state });

  const server = app.listen(config.port, () => logger.info(`HTTP server: port ${config.port}`));
  server.requestTimeout = config.http.requestTimeoutMs;
  server.headersTimeout = Math.min(20_000, config.http.requestTimeoutMs);
  server.keepAliveTimeout = 65_000; // odatda reverse proxy (60s) dan uzoqroq bo'lishi kerak
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server xatosi');
    process.exit(1);
  });

  await startBot(bot);

  const maintenance = startMaintenance();

  async function shutdown(signal) {
    if (state.shuttingDown) return;
    state.shuttingDown = true; // /health 503 qaytaradi — balansirovshchik trafikni olib tashlaydi
    logger.info(`${signal} qabul qilindi, to'xtatilmoqda...`);

    const force = setTimeout(() => {
      logger.error('Majburiy chiqish (timeout)');
      process.exit(1);
    }, config.http.shutdownTimeoutMs);
    force.unref();

    try {
      await stopBot(bot);
      await maintenance.stop();
      await new Promise((resolve) => {
        server.close(resolve); // yangi ulanish qabul qilinmaydi, bajarilayotgan so'rovlar tugaydi
        server.closeIdleConnections(); // keep-alive bo'sh ulanishlar shutdownni kechiktirmasin
      });
      await disconnectRedis();
      await disconnectDb();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown xatosi');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Ishga tushirishda xato');
  process.exit(1);
});