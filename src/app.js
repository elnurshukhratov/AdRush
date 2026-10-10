'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const config = require('./config');
const { prisma } = require('./db/prisma');
const { redisStatus } = require('./db/redis');
const logger = require('./utils/logger');
const { asyncHandler } = require('./utils/apiError');
const apiRoutes = require('./api/routes');
const { notFound, errorHandler } = require('./api/middlewares/errorHandler');

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Request logging: har bir so'rovga requestId; URL dan query (token!) olib tashlanadi. */
function requestLogger() {
  return pinoHttp({
    logger,
    genReqId: (_req, res) => {
      const id = crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: {
      // Liveness probe va Telegram webhook (har bir update) logni to'ldirib yubormasin
      ignore: (req) => req.url === '/health/live' || req.url.startsWith(config.bot.webhookPath),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      // Reward/postback URL larda maxfiy token bor (AdsGram/Monetag: ?token=..., OnClickA: /onclicka/reward/<token>) — logga TUSHMASIN
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: String(req.originalUrl || req.url).split('?')[0].replace(/(\/onclicka\/reward\/)[^/?]+/, '$1:token'),
        ip: req.ip,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}

/**
 * @param {{ webhookHandler?: Function|null, state?: { shuttingDown: boolean } }} [opts]
 */
function createApp({ webhookHandler = null, state = { shuttingDown: false } } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Proxy ortida to'g'ri klient IP olish (rate limit va loglar uchun). Default 0 = ishonmaslik.
  app.set('trust proxy', config.trustProxy);

  app.use(requestLogger());
  // Mobil trafikni kamaytirish: JSON/HTML/CSS/JS siqiladi (rasmlar allaqachon siqilgan, compression ularni o'tkazib yuboradi)
  app.use(compression({ threshold: 1024 }));

  // --- Health ---
  // Liveness: jarayon tirik (orkestrator restart qarori uchun). Hech narsaga bog'liq emas.
  app.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  // Readiness: DB tayyormi (Redis ixtiyoriy va fail-open, shuning uchun 'down' bo'lsa ham 200).
  app.get('/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (state.shuttingDown) return res.status(503).json({ status: 'shutting_down' });

    let db = 'ok';
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2000);
    } catch (err) {
      db = 'down';
      logger.error({ err: err.message }, 'Health check: DB xatosi');
    }
    const redis = await redisStatus();
    return res.status(db === 'ok' ? 200 : 503).json({
      status: db === 'ok' ? 'ok' : 'error',
      db,
      redis,
      bot: config.bot.mode,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  // --- Telegram webhook (faqat BOT_MODE=webhook). Telegram yuboradigan secret_token grammY ichida tekshiriladi ---
  if (webhookHandler) {
    app.post(config.bot.webhookPath, express.json({ limit: '1mb' }), asyncHandler(webhookHandler));
  }

  // --- Mine App UI (statik) ---
  // Telegram Web (brauzer versiyasi) Mini App ni iframe ichida ochadi, shuning uchun bu yerda frameguard/CSP o'chirilgan.
  // CSP o'chirilishining sababi: AdsGram SDK yuklaydigan domenlar hujjatda to'liq berilmagan — qat'iy CSP reklamani buzishi mumkin.
  app.use(
    '/mine',
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginResourcePolicy: false,
      // AdsGram reklama iframe/so'rovlari platforma domenini Referer/Origin orqali tekshiradi. 'no-referrer' bo'lsa
      // reklama ochilib, darhol yopilib qolishi mumkin. Telegram initData URL hash'da — hash Referer'ga hech qachon tushmaydi.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Reklama bosilganda ochiladigan oyna/ilova bilan aloqani COOP uzib qo'ymasin
      crossOriginOpenerPolicy: false,
    }),
    (_req, res, next) => {
      // Telegram WebView uchun keraksiz brauzer imkoniyatlari o'chiriladi
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
      next();
    },
    // ETag + must-revalidate: o'zgarmagan fayl 304 bilan qaytadi, yangilanish esa darhol ko'rinadi
    express.static(path.join(__dirname, '..', 'public', 'mine'), {
      index: 'index.html',
      maxAge: 0,
      etag: true,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  );

  // --- Brend rasmlari (bot welcome rasmi va h.k.) ---
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets'), { index: false, maxAge: '7d' }));

  // --- Sovrin rasmlari (admin yuklagan; fayl nomi uuid, shuning uchun uzoq keshlanadi) ---
  app.use(
    '/uploads',
    express.static(config.uploads.dir, {
      index: false,
      dotfiles: 'ignore',
      maxAge: '365d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  // --- API (qat'iy xavfsizlik sarlavhalari) ---
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };