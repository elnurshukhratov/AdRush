'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error({ target: e.target }, `Prisma error: ${e.message}`));
prisma.$on('warn', (e) => logger.warn({ target: e.target }, `Prisma warn: ${e.message}`));

async function connectDb() {
  await prisma.$connect();
  logger.info('PostgreSQL ulandi');
}

async function disconnectDb() {
  await prisma.$disconnect();
  logger.info('PostgreSQL uzildi');
}

module.exports = { prisma, connectDb, disconnectDb };
