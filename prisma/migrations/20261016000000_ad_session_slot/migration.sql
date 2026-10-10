-- Reklama kartasi (slot) raqami: cooldown har bir karta uchun alohida hisoblanadi
ALTER TABLE "AdSession" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;