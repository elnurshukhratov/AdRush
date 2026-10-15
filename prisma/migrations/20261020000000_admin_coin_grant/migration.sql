-- Admin paneldan qo'lda yuborilgan Rush Coin uchun ledger turi. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.
-- DIQQAT: yangi enum qiymati shu migratsiyada ISHLATILMAYDI (Postgres: ADD VALUE tranzaksiyada ishlatib bo'lmaydi).

-- AlterEnum
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'ADMIN_GRANT';