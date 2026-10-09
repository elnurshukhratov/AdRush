# syntax=docker/dockerfile:1

# ---- 1) Bog'liqliklar + Prisma client generatsiyasi ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma engine'lari uchun openssl kerak
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

# ---- 2) Runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/uploads/prizes && chown -R node:node /app

# Root bo'lmagan foydalanuvchi
USER node
EXPOSE 3000

# Liveness: jarayon javob beryaptimi (DB tekshiruvi /health da, orkestratorning readiness uchun)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini: signallarni to'g'ri uzatadi (graceful shutdown ishlashi uchun) va zombie jarayonlarni tozalaydi
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
