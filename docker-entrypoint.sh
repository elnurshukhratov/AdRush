#!/bin/sh
# Konteyner ishga tushganda: migratsiya -> seed (idempotent) -> server.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Migratsiyalar qo'llanmoqda..."
  ./node_modules/.bin/prisma migrate deploy
fi

# Seed idempotent: mavjud sovrin/admin/competition'ga tegmaydi, faqat yo'qlarini yaratadi
if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seed..."
  node prisma/seed.js
fi

echo "[entrypoint] Server ishga tushmoqda..."
exec node src/server.js
