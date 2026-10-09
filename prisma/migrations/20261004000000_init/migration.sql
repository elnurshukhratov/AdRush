-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "WinnerStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DELIVERED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdSessionStatus" AS ENUM ('PENDING', 'CLAIMED', 'REWARDED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyCompetition" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyCompetition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdReward" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "externalRewardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AdReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyStat" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "validAds" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" SERIAL NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "place" INTEGER NOT NULL,
    "prize" TEXT NOT NULL,
    "status" "WinnerStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSession" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "status" "AdSessionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "AdSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsgramConfirmation" (
    "id" BIGSERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" UUID,

    CONSTRAINT "AdsgramConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeConfig" (
    "id" SERIAL NOT NULL,
    "place" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorTelegramId" BIGINT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_isBlocked_idx" ON "User"("isBlocked");

-- CreateIndex
CREATE INDEX "MonthlyCompetition_status_idx" ON "MonthlyCompetition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyCompetition_year_month_key" ON "MonthlyCompetition"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AdReward_externalRewardId_key" ON "AdReward"("externalRewardId");

-- CreateIndex
CREATE INDEX "AdReward_userId_competitionId_idx" ON "AdReward"("userId", "competitionId");

-- CreateIndex
CREATE INDEX "AdReward_competitionId_createdAt_idx" ON "AdReward"("competitionId", "createdAt");

-- CreateIndex
CREATE INDEX "MonthlyStat_competitionId_validAds_updatedAt_idx" ON "MonthlyStat"("competitionId", "validAds" DESC, "updatedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyStat_userId_competitionId_key" ON "MonthlyStat"("userId", "competitionId");

-- CreateIndex
CREATE INDEX "Winner_status_idx" ON "Winner"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_competitionId_place_key" ON "Winner"("competitionId", "place");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_competitionId_userId_key" ON "Winner"("competitionId", "userId");

-- CreateIndex
CREATE INDEX "AdSession_userId_status_idx" ON "AdSession"("userId", "status");

-- CreateIndex
CREATE INDEX "AdSession_status_expiresAt_idx" ON "AdSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdsgramConfirmation_sessionId_key" ON "AdsgramConfirmation"("sessionId");

-- CreateIndex
CREATE INDEX "AdsgramConfirmation_telegramId_receivedAt_idx" ON "AdsgramConfirmation"("telegramId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeConfig_place_key" ON "PrizeConfig"("place");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_telegramId_key" ON "Admin"("telegramId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorTelegramId_createdAt_idx" ON "AuditLog"("actorTelegramId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "AdReward" ADD CONSTRAINT "AdReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReward" ADD CONSTRAINT "AdReward_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyStat" ADD CONSTRAINT "MonthlyStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyStat" ADD CONSTRAINT "MonthlyStat_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSession" ADD CONSTRAINT "AdSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSession" ADD CONSTRAINT "AdSession_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsgramConfirmation" ADD CONSTRAINT "AdsgramConfirmation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
