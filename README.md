# 🚀 AdRush

<p align="center"><strong>Reklama, referallar va oylik chempionatlar — bitta Telegram Mini App ichida.</strong></p>

<p align="center">
<img src="https://img.shields.io/badge/Project-AdRush-12B8FF?style=for-the-badge" alt="AdRush">
<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
<img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
</p>

<p align="center"><a href="https://t.me/Ad_Rushbot">🤖 Botni ochish</a> · <a href="https://github.com/elnurshukhratov/AdRush/issues">🐛 Xatolik yoki taklif</a></p>

---

## ✨ AdRush nima?

**AdRush** — Telegram bot va Mini App asosidagi loyiha. Foydalanuvchilar referallar orqali Rush Coin to‘playdi, AdsGram mukofotli reklamalarida qatnashadi va oylik chempionatlarda sovrinlar uchun kurashadi.

## 🌟 Imkoniyatlar

| Funksiya | Tavsif |
|---|---|
| 🎯 AdsGram | Server tasdiqlagan mukofotli reklama uchun coin berish |
| 🪙 Rush Coin | Ilova ichidagi mukofot va chempionatlarda ishlatiladigan coin |
| 👥 Referal tizimi | Do‘stlarni taklif qilish uchun bonus |
| 🏆 Chempionatlar | Oylik reyting va sovrinlar |
| 🎁 Sovrinlar tarixi | Oldingi g‘oliblar va natijalar |
| 🧰 Admin boshqaruvi | Chempionat va sovrinlarni boshqarish |

## 🧱 Texnologiyalar

- Node.js (CommonJS)
- grammY — Telegram bot
- Express — backend API
- PostgreSQL — ma’lumotlar bazasi
- Prisma — ORM va migratsiyalar
- AdsGram — mukofotli reklama integratsiyasi
- Docker Compose — servislarni ishga tushirish

## ⚙️ O‘rnatish

### Talablar
Node.js 18.18+, npm va PostgreSQL. Telegram bot tokeni hamda AdsGram sozlamalari kerak bo‘lishi mumkin.

### 1. Repozitoriyani klonlash

```bash
git clone https://github.com/elnurshukhratov/AdRush.git
cd AdRush
npm install
```

### 2. Muhit sozlamalari

Agar .env.example mavjud bo‘lsa:

```bash
cp .env.example .env
```

.env ichidagi qiymatlarni loyihangizga moslang. Kerakli o‘zgaruvchilarni .env.example, package.json va konfiguratsiya fayllaridan tekshiring.

### 3. Prisma va ma’lumotlar bazasi

```bash
npx prisma generate
npx prisma migrate deploy
```

Buyruqlarni loyiha konfiguratsiyasi va mavjud migratsiyalarga mos ravishda bajaring.

### 4. Ishga tushirish

```bash
npm start
```

Development scripti mavjud bo‘lsa:

```bash
npm run dev
```

Mavjud scriptlarni ko‘rish:

```bash
npm run
```

## 🔐 Xavfsizlik

- **Hech qachon** haqiqiy bot tokeni, API kaliti yoki parolni GitHub’ga yuklamang.
- .env faylini .gitignore ichida saqlang.
- .env.example ichida faqat soxta namunaviy qiymatlar bo‘lsin.
- AdsGram mukofotlarini faqat frontend hodisasiga qarab bermang; server tasdiqlashini ishlating.
- Production muhitida HTTPS va kuchli ma’lumotlar bazasi parolidan foydalaning.

## 🤝 Hissa qo‘shish

1. Repozitoriyani fork qiling.
2. Yangi branch yarating: feature/your-feature
3. O‘zgarishlarni kiriting va tekshiring.
4. Commit qiling, so‘ng Pull Request yuboring.

## 📬 Havolalar

- **Telegram bot:** [@Ad_Rushbot](https://t.me/Ad_Rushbot)
- **GitHub Issues:** [Xatolik yoki taklif yuborish](https://github.com/elnurshukhratov/AdRush/issues)

---

<p align="center"><sub>Made with ⚡ by Elnur · AdRush</sub></p>
