# 🏆 KOLIZEY MINE — oylik reklama chempionati (Telegram bot + backend)

AdsGram orqali **server tasdiqlagan** reklama ko'rishlarini sanaydi, har oy TOP 3 ni aniqlaydi.
Node.js · CommonJS · grammY · Express · PostgreSQL · Prisma · (ixtiyoriy) Redis.

## Imkoniyatlar

- **Bot**: `/start /help /stats /myrank /leaderboard /rules`, inline tugmalar, Mine App (Web App) tugmasi
- **Mine App** (`/mine/`): reyting, o'z o'rni, taymer, "Reklama ko'rish" (avtomatik yangilanadi)
- **Reward xavfsizligi**: server sessiyasi + AdsGram Reward URL tasdig'i + unique constraint + tranzaksiya + advisory lock
- **Oy almashish**: oy tugaganda avtomatik LOCK → TOP 3 → `Winner` → keyingi oy ochiladi; eski oylar o'chmaydi
- **Admin** (bot): `/admin /admin_stats /admin_leaderboard /admin_winners /admin_user /admin_close_month /admin_prize`
- **Production**: health, structured log (pino), global error handler, graceful shutdown, rate limit (Redis ixtiyoriy), Docker

## Tez boshlash (lokal)

```bash
cp .env.example .env            # BOT_TOKEN, DATABASE_URL, ADMIN_IDS, ADSGRAM_* ni to'ldiring
npm install
npm run db:setup                # prisma generate + migrate deploy + seed
npm run dev
```

Telegram'dan tashqaridan sinash uchun HTTPS kerak: `cloudflared tunnel --url http://localhost:3000` → hosil bo'lgan
`https://...trycloudflare.com/mine/` ni `MINE_APP_URL` ga qo'ying.

## Docker

```bash
cp .env.example .env     # BOT_TOKEN, ADMIN_IDS, ADSGRAM_*, POSTGRES_PASSWORD ni to'ldiring
docker compose up -d --build
docker compose logs -f app
curl http://127.0.0.1:3000/health
```

Konteyner ishga tushganda `prisma migrate deploy` va idempotent seed avtomatik bajariladi
(o'chirish: `RUN_MIGRATIONS=false`, `RUN_SEED=false`). Telegram Mini App va AdsGram Reward URL **HTTPS** talab qiladi —
app oldiga nginx/Caddy/Cloudflare qo'ying va `TRUST_PROXY=1` qiling.

## Bot rejimlari

| Rejim | Qachon | Eslatma |
|---|---|---|
| `polling` (default) | bitta instansiya, oddiy deploy | Ikkinchi instansiya `409 Conflict` beradi — log'da aniq yoziladi |
| `webhook` | bir nechta instansiya / zero-downtime deploy | `WEBHOOK_URL` + `WEBHOOK_SECRET` majburiy; Telegram `secret_token` har so'rovda tekshiriladi |

## Muhim env o'zgaruvchilari

Hammasi `.env.example` da izohlangan. Asosiylari: `BOT_TOKEN`, `DATABASE_URL`, `ADMIN_IDS`, `MINE_APP_URL`,
`ADSGRAM_BLOCK_ID`, `ADSGRAM_REWARD_TOKEN`, `ADSGRAM_VERIFY_MODE`, `BOT_MODE`, `REDIS_URL`, `TRUST_PROXY`.

## AdsGram sozlash

1. partner.adsgram.ai da **Reward** blok yarating → ID ni `ADSGRAM_BLOCK_ID` ga yozing.
2. `openssl rand -hex 32` → `ADSGRAM_REWARD_TOKEN`.
3. AdsGram kabinetida blokning **Reward URL** maydoniga yozing:
   `https://YOUR_DOMAIN/api/adsgram/reward?userid=[userId]&token=<ADSGRAM_REWARD_TOKEN>`
4. **Eslatma (halol cheklov):** AdsGram hujjatida Reward URL so'rovi imzolanishi, reward ID yoki rasmiy IP
   ro'yxati haqida ma'lumot yo'q. Shuning uchun himoya qatlami bizniki: maxfiy `token`, server sessiyasi,
   minimal davomiylik, cooldown, bir tasdiq — bir sessiya. Bu joylar kodda `TODO(ADSGRAM-UNVERIFIED)` bilan
   belgilangan (`src/services/adsgram/adsgramService.js`). AdsGram imzo e'lon qilsa, faqat shu fayl o'zgaradi.
5. `debug: true` rejimida AdsGram Reward URL'ga so'rov yubormaydi — sinov paytida +1 bo'lmasa shu sababdan bo'lishi mumkin.

## API

Barcha xatolar bir xil formatda: `{ "success": false, "reason": "KOD", "message": "...", "requestId": "..." }`

| Endpoint | Auth | Tavsif |
|---|---|---|
| `GET /health/live` | — | Jarayon tirik (liveness) |
| `GET /health` | — | DB (+Redis holati) tayyorligi (readiness); shutdown paytida 503 |
| `GET /api/competition/current` | `tma` | Joriy competition |
| `GET /api/leaderboard/current?limit=` | `tma` | TOP ro'yxat (+ o'zining qatori) |
| `GET /api/users/me/stats` | `tma` | `validAds, rank, nextRank, adsToNextRank` |
| `POST /api/ads/session` | `tma` | Reklama sessiyasini ochadi |
| `POST /api/ads/reward` `{sessionId}` | `tma` | Reward da'vo qilish (`DUPLICATE_REWARD` va h.k.) |
| `GET /api/ads/session/:id` | `tma` | Sessiya holati (polling) |
| `GET /api/adsgram/reward?userid=&token=` | token | AdsGram server-to-server tasdiq |
| `POST /telegram/webhook` | secret_token | Faqat `BOT_MODE=webhook` |

`tma` = `Authorization: tma <Telegram.WebApp.initData>` — backend HMAC-SHA256 bilan tekshiradi; frontenddan kelgan `userId` ga ishonilmaydi.

## Struktura

```
src/
  bot/ (commands, keyboards, handlers, middlewares, admin)
  api/ (routes, controllers, middlewares)
  services/ (adsgram, competition, leaderboard, rewards, users, admin, audit)
  db/ (prisma.js, redis.js)  jobs/ (monthRollover.js)  config/  utils/
  app.js  bot.js  server.js
prisma/ (schema.prisma, migrations/, seed.js)
public/mine/ (Mine App UI)
tests/  Dockerfile  docker-compose.yml  docker-entrypoint.sh  .env.example
```

## Skriptlar

`npm start` · `npm run dev` · `npm test` (DB talab qilmaydi) · `npm run check` · `npm run db:setup` ·
`npm run prisma:migrate:dev` · `npm run prisma:migrate:deploy` · `npm run seed` · `npm run docker:up`

## Production eslatmalari

- `.env` va tokenlar hech qachon GitHub'ga tushmasin (`.gitignore` da bor). Token oshkor bo'lsa — @BotFather'da yangilang.
- Polling rejimida faqat **bitta** bot instansiyasi. Bir nechta app instansiyasi kerak bo'lsa `BOT_MODE=webhook` + `REDIS_URL`.
- Bot throttle va leaderboard keshi instansiya ichida (xotirada) — bu zararsiz (qisqa TTL / polling bitta instansiyada).
- DB zaxira nusxasi (pg_dump) — g'oliblar tarixi shu yerda; o'zingiz sozlang.
- Sovrinlarni o'zgartirish: bot'da `/admin_prize` (DB'da saqlanadi, kodda emas).
- Test ro'yxati: [TEST_CHECKLIST.md](TEST_CHECKLIST.md)
