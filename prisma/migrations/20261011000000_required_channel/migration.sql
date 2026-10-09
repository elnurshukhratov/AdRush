-- Majburiy obuna: yangi coin turi va kanal jadvali. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.

-- AlterEnum
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'SUBSCRIBE_REWARD';

-- CreateTable
CREATE TABLE IF NOT EXISTS "RequiredChannel" (
    "id" SERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT,
    "title" TEXT NOT NULL,
    "inviteUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequiredChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequiredChannel_isActive_idx" ON "RequiredChannel"("isActive");