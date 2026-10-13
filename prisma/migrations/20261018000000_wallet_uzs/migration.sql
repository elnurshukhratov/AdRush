-- So'm hamyon: UZS valyutasi, yangi ledger turlari, User.balanceUzs, Payment jadvali. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.
-- DIQQAT: yangi enum qiymatlari shu migratsiyada ISHLATILMAYDI (Postgres: ADD VALUE tranzaksiyada ishlatib bo'lmaydi).

-- AlterEnum
ALTER TYPE "CoinCurrency" ADD VALUE IF NOT EXISTS 'UZS';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'WALLET_TOPUP';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'COIN_BUY_OUT';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'COIN_BUY_IN';

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- User: so'm balansi (manfiy bo'lmaydi)
ALTER TABLE "User" ADD COLUMN "balanceUzs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_balanceUzs_nonneg" CHECK ("balanceUzs" >= 0);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "amountUzs" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "telegramChargeId" TEXT,
    "providerChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amountUzs_positive" CHECK ("amountUzs" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_telegramChargeId_key" ON "Payment"("telegramChargeId");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt" DESC);
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;