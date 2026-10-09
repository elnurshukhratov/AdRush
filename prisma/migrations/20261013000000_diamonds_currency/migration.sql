-- Olmos valyutasi: yangi ledger turlari, valyuta ustuni, User.diamonds. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.

-- AlterEnum
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'CONVERT_OUT';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'CONVERT_IN';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'SHOP_PURCHASE';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'SHOP_REFUND';

-- CreateEnum (qayta ishga tushirilganda xato bermasligi uchun)
DO $$
BEGIN
  CREATE TYPE "CoinCurrency" AS ENUM ('RUSH', 'DIAMOND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- User: olmos balansi
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "diamonds" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_diamonds_nonneg" CHECK ("diamonds" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CoinTransaction: valyuta (eski yozuvlar RUSH bo'lib qoladi)
ALTER TABLE "CoinTransaction" ADD COLUMN IF NOT EXISTS "currency" "CoinCurrency" NOT NULL DEFAULT 'RUSH';