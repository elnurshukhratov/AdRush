-- Rush Coin tizimi: ichki valyuta, ledger, tikish, referral. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.

-- CreateEnum
CREATE TYPE "CoinTxType" AS ENUM ('ADS_REWARD', 'REFERRAL_REWARD', 'COMPETITION_BET', 'LOSS_REFUND', 'COMPETITION_WIN');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('ACTIVE', 'WON', 'LOST');

-- User: balans va referral
ALTER TABLE "User" ADD COLUMN "rushCoins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "referredByUserId" INTEGER;

ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey"
  FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_referredByUserId_idx" ON "User"("referredByUserId");

-- Reklama endi competitionga bog'liq emas: competitionId ixtiyoriy
ALTER TABLE "AdReward" ALTER COLUMN "competitionId" DROP NOT NULL;
ALTER TABLE "AdSession" ALTER COLUMN "competitionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "CoinTxType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "competitionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionBet" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'ACTIVE',
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CompetitionBet_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "CoinTransaction_idempotencyKey_key" ON "CoinTransaction"("idempotencyKey");
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt" DESC);
CREATE INDEX "CoinTransaction_userId_type_idx" ON "CoinTransaction"("userId", "type");
CREATE INDEX "CompetitionBet_userId_status_idx" ON "CompetitionBet"("userId", "status");
CREATE INDEX "CompetitionBet_competitionId_status_idx" ON "CompetitionBet"("competitionId", "status");
CREATE INDEX "CompetitionBet_competitionId_userId_idx" ON "CompetitionBet"("competitionId", "userId");

-- Foreign keys
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompetitionBet" ADD CONSTRAINT "CompetitionBet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompetitionBet" ADD CONSTRAINT "CompetitionBet_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Himoya (Prisma bilmaydi, lekin teginmaydi): balans va miqdorlar manfiy bo'lib qolmasin
ALTER TABLE "User" ADD CONSTRAINT "User_rushCoins_nonneg" CHECK ("rushCoins" >= 0);
ALTER TABLE "CompetitionBet" ADD CONSTRAINT "CompetitionBet_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_amount_nonzero" CHECK ("amount" <> 0);
