# AdRush

AdRush --- Telegram bot va Telegram Mini App orqali AdsGram
reklamalarini server tomonidan tasdiqlash, foydalanuvchilarga **Rush
Coin** berish va oylik chempionatlarni boshqarish uchun loyiha.

## Texnologiyalar

-   Node.js (CommonJS)
-   Telegram bot: grammY
-   Backend API: Express
-   Ma'lumotlar bazasi: PostgreSQL
-   ORM va migratsiyalar: Prisma
-   Ixtiyoriy Redis
-   Telegram Mini App frontend
-   Docker Compose

## Asosiy imkoniyatlar

-   Telegram bot va Mine App (Mini App)
-   AdsGram Reward URL orqali serverdan tasdiqlangan reklama mukofotlari
-   Reklama sessiyalari va takroriy mukofot olishdan himoya
-   Rush Coin: reklama, referal va obuna mukofotlari
-   Chempionatlar, tikishlar, reyting va g'oliblar tarixi
-   Admin funksiyalari va sovrinlarni boshqarish
-   Admin yuklagan sovrin/g'olib rasmlarini saqlash
-   Health endpointlar, loglar, rate limiting va graceful shutdown
-   Docker Compose orqali ilova, PostgreSQL va Redis'ni ishga tushirish

## Talablar

Docker usuli uchun: - Docker Engine - Docker Compose plugin

Docker'siz ishlatish uchun: - Node.js `>=18.18` - npm - PostgreSQL -
(ixtiyoriy) Redis

## Konfiguratsiya

1.  Repozitoriyani yuklab oling:

    ``` bash
    git clone https://github.com/elnurshukhratov/AdRush.git
    cd AdRush
    ```

2.  Muhit faylini yarating:

    ``` bash
    cp .env.example .env
    ```

3.  `.env` ichidagi sozlamalarni o'zingizning qiymatlaringiz bilan
    to'ldiring. Eng muhimlari:

    -   `BOT_TOKEN` --- BotFather bergan Telegram bot tokeni
    -   `ADMIN_IDS` --- admin Telegram ID'lari
    -   `MINE_APP_URL` --- Mine App uchun ommaviy HTTPS manzil
    -   `ADSGRAM_BLOCK_ID` --- AdsGram Reward blok ID'si
    -   `ADSGRAM_REWARD_TOKEN` --- o'zingiz yaratgan maxfiy token
    -   `POSTGRES_PASSWORD` --- Docker Compose ishlatilgandagi
        PostgreSQL paroli
    -   `DATABASE_URL` --- PostgreSQL ulanish manzili

    `.env` faylini GitHub'ga yubormang. `.env.example` ichida ham
    haqiqiy token, parol yoki shaxsiy maxfiy qiymat bo'lmasin.

## Docker orqali ishga tushirish (tavsiya)

`.env` faylida kamida yuqoridagi qiymatlarni to'g'ri sozlagach:

``` bash
docker compose up -d --build
```

Holatini ko'rish:

``` bash
docker compose ps
docker compose logs -f app
```

Health tekshiruvi:

``` bash
curl http://127.0.0.1:3000/health
```

To'xtatish:

``` bash
docker compose down
```

Bu buyruq ma'lumotlar saqlanadigan Docker volume'larni o'chirmaydi.
`docker compose down -v` esa volume'larni, jumladan ma'lumotlar bazasini
o'chirishi mumkin --- uni ehtiyotkorlik bilan ishlating.

### HTTPS

Telegram Mini App va AdsGram Reward URL uchun ommaviy HTTPS manzili
kerak. Production muhitida domen va Nginx/Caddy/Cloudflare kabi reverse
proxy sozlang. Reverse proxy ortida ishlaganda `TRUST_PROXY` qiymatini
haqiqiy topologiyaga moslang.

## Lokal Node.js orqali ishga tushirish

PostgreSQL va kerak bo'lsa Redis oldindan ishga tushgan bo'lishi kerak.

``` bash
npm install
cp .env.example .env
```

`.env` ni to'ldirgach:

``` bash
npm run db:setup
npm start
```

Rivojlantirish rejimi:

``` bash
npm run dev
```

## Foydali buyruqlar

``` bash
npm test                  # testlarni ishga tushirish
npm run check             # JavaScript sintaksisini tekshirish
npm run prisma:generate   # Prisma Client yaratish
npm run prisma:migrate:deploy
npm run seed
```

## Muhim endpointlar

  Endpoint                         Maqsad
  -------------------------------- ------------------------------------------------
  `GET /health/live`               Jarayon ishlayotganini tekshirish
  `GET /health`                    Ilova va bog'liqliklar tayyorligini tekshirish
  `GET /api/competition/current`   Joriy chempionat
  `GET /api/leaderboard/current`   Joriy reyting
  `GET /api/users/me/stats`        Foydalanuvchi statistikasi
  `POST /api/ads/session`          Reklama sessiyasini boshlash
  `POST /api/ads/reward`           Sessiya mukofotini so'rash
  `GET /api/adsgram/reward`        AdsGram server callback endpointi

Foydalanuvchi endpointlarining ko'pchiligi Telegram Mini App `initData`
autentifikatsiyasini talab qiladi.

## AdsGram sozlash

1.  AdsGram kabinetida Reward blokini yarating va ID'sini
    `ADSGRAM_BLOCK_ID` ga kiriting.

2.  Maxfiy token yarating:

    ``` bash
    openssl rand -hex 32
    ```

3.  Hosil bo'lgan tokenni faqat serverdagi `.env` faylining
    `ADSGRAM_REWARD_TOKEN` qiymatiga kiriting.

4.  AdsGram kabinetidagi Reward URL'ni loyiha konfiguratsiyasiga mos
    ravishda sozlang. Masalan:

    ``` text
    https://YOUR_DOMAIN/api/adsgram/reward?userid=[userId]&token=YOUR_SECRET_TOKEN
    ```

5.  Reward URL faqat HTTPS orqali ochilishini va AdsGram kabinetidagi
    blok sozlamalari bilan mosligini tekshiring.

**Xavfsizlik eslatmasi:** callback himoyasi ushbu loyihaning joriy
implementatsiyasiga bog'liq. Ishlab chiqarishga chiqarishdan oldin
AdsGram'ning amaldagi hujjatlari bilan tekshiring; tokenni oshkor
qilmang va callback'ni oddiy foydalanuvchi mukofot olish endpointi deb
hisoblamang.

## Bot rejimi

`BOT_MODE=polling` --- odatda bitta server instansiyasi uchun. Bir
vaqtning o'zida bir nechta polling instansiyasini ishga tushirmang.

`BOT_MODE=webhook` ishlatilsa, `WEBHOOK_URL` va `WEBHOOK_SECRET` ni
sozlash hamda HTTPS endpointni ta'minlash kerak.

## Xavfsizlik va zaxira

-   `.env`, tokenlar, parollar va maxfiy kalitlarni GitHub'ga yubormang.
-   Token oshkor bo'lsa, tegishli provayderda darhol yangilang.
-   PostgreSQL ma'lumotlar bazasining muntazam zaxira nusxasini oling.
-   Production serverda firewall va HTTPS sozlang.
-   `uploads/` va ma'lumotlar bazasi zaxirasini alohida saqlang.
-   Migratsiyalarni production bazasida bajarishdan oldin zaxira nusxa
    oling.

## Litsenziya

Litsenziya alohida ko'rsatilmagan. Ruxsat shartlarini aniqlash uchun
loyiha egasi bilan bog'laning.
