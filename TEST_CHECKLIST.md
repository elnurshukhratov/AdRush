# ✅ TEST CHECKLIST (5-bosqich)

Belgilang: `[ ]` → `[x]`. Avval: `npm run db:setup` va `npm run dev` (yoki `docker compose up -d --build`).

## 0. Avtomatik testlar
- [ ] `npm test` — barcha testlar yashil (initData HMAC, API xato formati, health, webhook secret, AdsGram token)
- [ ] `npm run check` — sintaksis xatosiz

## 1. Ishga tushish va infratuzilma
- [ ] `GET /health/live` → 200
- [ ] `GET /health` → 200, `db: "ok"`; PostgreSQL to'xtatilsa → 503 (`db: "down"`)
- [ ] `REDIS_URL` bo'sh: ishlaydi; to'ldirilgan: `redis: "ok"`; Redis to'xtatilsa API **yiqilmaydi**
- [ ] `Ctrl+C` / `docker compose stop` → log'da "to'xtatilmoqda…", bot/DB toza uziladi, jarayon 15 s ichida chiqadi
- [ ] Noto'g'ri `.env` (masalan `BOT_TOKEN` yo'q) → aniq xabar bilan darhol to'xtaydi
- [ ] Ikkinchi polling instansiya → "409 Conflict" haqida aniq fatal log
- [ ] Log'da `token=`, `Authorization`, bot token **ko'rinmaydi**

## 2. Bot (oddiy foydalanuvchi)
- [ ] `/start` har safar javob beradi, chiroyli welcome + 4 ta tugma (Reklama ko'rish / Reyting / Mening natijam / Qoidalar)
- [ ] `/start` ni 3 marta bosish → DB'da `User` **bitta** qator, `updatedAt` yangilanadi
- [ ] `/help`, `/rules`, `/leaderboard` (TOP 10), `/stats`, `/myrank` — matnlar spetsifikatsiyaga mos
- [ ] Tugmalar: Reyting / Natija / Qoidalar ishlaydi; "Reklama ko'rish" Mine App'ni ochadi
- [ ] Tez-tez bosish (15+ marta/10 s) → throttle, bot yiqilmaydi
- [ ] Bot bloklangan user (DB: `isBlocked=true`) → "akkaunt cheklangan"
- [ ] Xatolik (masalan DB o'chiq) → userga chiroyli xabar, stack ko'rinmaydi

## 3. Mine App va reward oqimi
- [ ] Mine App Telegram ichida ochiladi: reyting, "Siz — #N", taymer, TOP 3 ko'rinadi
- [ ] Reyting har ~15 s avtomatik yangilanadi
- [ ] Brauzerda (Telegram'siz) ochilganda API 401, ilova xato bermay xabar ko'rsatadi
- [ ] Reklama ko'rilgach `validAds` **+1** (server_confirmed rejimida AdsGram Reward URL kelgandan keyin)
- [ ] Bir sessiyani qayta yuborish → `DUPLICATE_REWARD`, +1 bo'lmaydi
- [ ] Parallel 10 ta bir xil `POST /api/ads/reward` → faqat bitta +1
- [ ] Reklamani oxirigacha ko'rmasdan claim → `CLAIM_TOO_FAST`, hisoblanmaydi
- [ ] Ketma-ket tez reward → `COOLDOWN`
- [ ] Boshqa user sessiyasi ID si bilan claim → rad etiladi + `SUSPICIOUS:FOREIGN_SESSION` audit
- [ ] `/api/adsgram/reward` noto'g'ri `token` bilan → 403 + `SUSPICIOUS:BAD_CALLBACK_TOKEN`
- [ ] Soxta/eskirgan `initData` → 401 + `SUSPICIOUS:BAD_INITDATA`
- [ ] Body'ga `userId`/`telegramId` qo'yib yuborish natijaga ta'sir qilmaydi
- [ ] 1 daqiqada 12+ session/reward → 429 `RATE_LIMITED`

## 4. Leaderboard / statistika (SQL tekshiruvi)
- [ ] `GET /api/leaderboard/current` — faqat ochiq maydonlar (`rank, username, validAds, ...`)
- [ ] `GET /api/users/me/stats` — `validAds, rank, nextRank, adsToNextRank`
- [ ] Tenglikda avval yetgan yuqorida
- [ ] `LEADERBOARD_EXPOSE_TELEGRAM_ID=false` → javobda `telegramId` yo'q

## 5. Admin
- [ ] Admin bo'lmagan `/admin*` → "⛔ Ruxsat yo'q" + `SUSPICIOUS:ADMIN_ACCESS_DENIED`
- [ ] `/admin`, `/admin_stats`, `/admin_leaderboard` (TOP 100), `/admin_user <id|@username>`, `/admin_winners [YYYY-MM]`
- [ ] `/admin_prize` — sovrin nomini o'zgartirish → `/rules` va welcome'da yangi nom
- [ ] Winner holatini boshqarish (tasdiqlash/topshirildi/rad) → `AuditLog` da yozuv
- [ ] User bloklash/blokdan chiqarish → `AuditLog`

## 6. Oy almashish
- [ ] `/admin_close_month` → tasdiq so'raydi → competition `LOCKED`, TOP 3 `Winner` yaratiladi, yangi oy `ACTIVE`
- [ ] Yopilgandan keyin reward → `COMPETITION_CLOSED`
- [ ] Eski oy `MonthlyStat` / `AdReward` / `Winner` yozuvlari saqlanib qoladi, o'zgarmaydi
- [ ] Ikki marta yopishga urinish → ikkinchisi zararsiz (idempotent), g'olib dublikat bo'lmaydi
- [ ] Avtomatik: test DB'da `endAt` ni o'tmishga qo'ying → ≤60 s ichida avtomatik yopiladi, adminlarga hisobot keladi
- [ ] Sovrin nomlari `PrizeConfig` dan olinadi (kodda hardcode emas)

## 7. Webhook rejimi (ixtiyoriy)
- [ ] `BOT_MODE=webhook` + `WEBHOOK_URL`/`WEBHOOK_SECRET` → log'da "webhook o'rnatildi"
- [ ] Noto'g'ri secret bilan `POST /telegram/webhook` → 401
- [ ] Bot webhook orqali javob beradi

## 8. Docker
- [ ] `docker compose up -d --build` → 3 servis healthy, migratsiya va seed avtomatik
- [ ] `docker compose restart app` → ma'lumot saqlanadi (`pgdata` volume)
- [ ] Konteyner root emas (`docker compose exec app id` → `node`)
