-- Shahmat: o'yinlar va onlayn navbat, olmos ledger turlari. Faqat qo'shiladi; mavjud jadvallar va ma'lumotlar o'zgarmaydi.

-- AlterEnum
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'CHESS_WIN';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'CHESS_LOSS';

-- CreateEnum (qayta ishga tushirilganda xato bermasligi uchun)
DO $$
BEGIN
  CREATE TYPE "ChessMode" AS ENUM ('BOT', 'ONLINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ChessStatus" AS ENUM ('ACTIVE', 'FINISHED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ChessResult" AS ENUM ('WHITE', 'BLACK', 'DRAW');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ChessEnd" AS ENUM ('CHECKMATE', 'STALEMATE', 'DRAW_RULE', 'RESIGN', 'TIMEOUT', 'ABANDON');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChessGame" (
  "id" UUID NOT NULL,
  "mode" "ChessMode" NOT NULL,
  "status" "ChessStatus" NOT NULL DEFAULT 'ACTIVE',
  "whiteUserId" INTEGER,
  "blackUserId" INTEGER,
  "botLevel" INTEGER,
  "fen" TEXT NOT NULL,
  "moves" JSONB NOT NULL DEFAULT '[]',
  "moveCount" INTEGER NOT NULL DEFAULT 0,
  "lastMoveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "whiteTimeMs" INTEGER,
  "blackTimeMs" INTEGER,
  "incrementMs" INTEGER NOT NULL DEFAULT 0,
  "result" "ChessResult",
  "endReason" "ChessEnd",
  "whiteDelta" INTEGER NOT NULL DEFAULT 0,
  "blackDelta" INTEGER NOT NULL DEFAULT 0,
  "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChessGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChessQueue" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChessQueue_pkey" PRIMARY KEY ("id")
);

-- Bot darajasi 1..3; o'yinda kamida bitta haqiqiy foydalanuvchi bo'lishi shart; bot o'yinida aynan bitta tomon bot
DO $$
BEGIN
  ALTER TABLE "ChessGame" ADD CONSTRAINT "ChessGame_botLevel_range" CHECK ("botLevel" IS NULL OR ("botLevel" BETWEEN 1 AND 3));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChessGame" ADD CONSTRAINT "ChessGame_players_check" CHECK (
    ("mode" = 'BOT' AND "botLevel" IS NOT NULL AND (("whiteUserId" IS NULL) <> ("blackUserId" IS NULL)))
    OR ("mode" = 'ONLINE' AND "botLevel" IS NULL AND "whiteUserId" IS NOT NULL AND "blackUserId" IS NOT NULL AND "whiteUserId" <> "blackUserId")
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChessQueue_userId_key" ON "ChessQueue"("userId");
CREATE INDEX IF NOT EXISTS "ChessQueue_joinedAt_idx" ON "ChessQueue"("joinedAt");
CREATE INDEX IF NOT EXISTS "ChessQueue_lastSeenAt_idx" ON "ChessQueue"("lastSeenAt");

CREATE INDEX IF NOT EXISTS "ChessGame_whiteUserId_status_idx" ON "ChessGame"("whiteUserId", "status");
CREATE INDEX IF NOT EXISTS "ChessGame_blackUserId_status_idx" ON "ChessGame"("blackUserId", "status");
CREATE INDEX IF NOT EXISTS "ChessGame_status_mode_lastMoveAt_idx" ON "ChessGame"("status", "mode", "lastMoveAt");
CREATE INDEX IF NOT EXISTS "ChessGame_whiteUserId_settledAt_idx" ON "ChessGame"("whiteUserId", "settledAt");
CREATE INDEX IF NOT EXISTS "ChessGame_blackUserId_settledAt_idx" ON "ChessGame"("blackUserId", "settledAt");

-- Bir foydalanuvchida bir vaqtda faqat bitta faol o'yin (DB darajasida kafolat, poyga holatlariga qarshi)
CREATE UNIQUE INDEX IF NOT EXISTS "ChessGame_one_active_white" ON "ChessGame"("whiteUserId") WHERE "status" = 'ACTIVE' AND "whiteUserId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ChessGame_one_active_black" ON "ChessGame"("blackUserId") WHERE "status" = 'ACTIVE' AND "blackUserId" IS NOT NULL;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "ChessGame" ADD CONSTRAINT "ChessGame_whiteUserId_fkey" FOREIGN KEY ("whiteUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChessGame" ADD CONSTRAINT "ChessGame_blackUserId_fkey" FOREIGN KEY ("blackUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChessQueue" ADD CONSTRAINT "ChessQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;