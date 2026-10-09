'use strict';

const pino = require('pino');
const config = require('../config');

// Development'da o'qish oson bo'lishi uchun pino-pretty (devDependency); production'da JSON log.
function devTransport() {
  if (config.isProd) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } };
  } catch (_e) {
    return undefined;
  }
}

const logger = pino({
  level: config.logLevel,
  base: { service: 'kolizey-mine-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Maxfiy qiymatlar logga tushmasin
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-telegram-bot-api-secret-token"]',
      'botToken',
      '*.token',
      '*.secret',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport: devTransport(),
});

module.exports = logger;
