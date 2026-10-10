-- Reklama provayderlari: AdsGram / Monetag / OnClickA.
-- Mavjud qatorlar o'zgarmaydi: eski sessiyalar 'adsgram' + 'task' bo'lib qoladi.

-- Sessiya provayderi va joyi (cooldown endi (provider, placement) bo'yicha; eski "slot" ustuni saqlanadi, ishlatilmaydi)
ALTER TABLE "AdSession" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'adsgram';
ALTER TABLE "AdSession" ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'task';
CREATE INDEX "AdSession_userId_provider_placement_status_idx" ON "AdSession"("userId", "provider", "placement", "status");

-- Server tasdiqlari (AdsGram Reward URL / OnClickA)
ALTER TABLE "AdsgramConfirmation" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'adsgram';
ALTER TABLE "AdsgramConfirmation" ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'task';
CREATE INDEX "AdsgramConfirmation_tg_prov_plc_recv_idx" ON "AdsgramConfirmation"("telegramId", "provider", "placement", "receivedAt");

-- Admin paneldan boshqariladigan ommaviy reklama identifikatorlari (maxfiy tokenlar emas)
CREATE TABLE "AdSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" BIGINT,

    CONSTRAINT "AdSetting_pkey" PRIMARY KEY ("key")
);