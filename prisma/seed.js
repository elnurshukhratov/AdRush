'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseAdminIds(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

/**
 * Seed faqat adminlarni (.env ADMIN_IDS) yaratadi. Idempotent: mavjudlarga tegmaydi.
 * Competition va sovrinlar kodda/seedda HARDCODE QILINMAYDI — admin ularni Mine App ichidan yaratadi.
 */
async function main() {
  const adminIds = parseAdminIds(process.env.ADMIN_IDS);
  for (const [i, id] of adminIds.entries()) {
    await prisma.admin.upsert({
      where: { telegramId: BigInt(id) },
      update: {},
      create: { telegramId: BigInt(id), role: i === 0 ? 'SUPER_ADMIN' : 'ADMIN' },
    });
  }
  console.log(`Seed tayyor: ${adminIds.length} admin`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
