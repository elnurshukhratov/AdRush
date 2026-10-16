-- Shashka (rus shashkasi): o'yin turi ustuni va yangi tugash sababi. Faqat qo'shiladi; mavjud jadvallar, indekslar va ma'lumotlar o'zgarmaydi.

-- CreateEnum (qayta ishga tushirilganda xato bermasligi uchun)
DO $$
BEGIN
  CREATE TYPE "GameType" AS ENUM ('CHESS', 'CHECKERS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum (shashka: raqibning donalari qolmadi yoki yura olmaydi)
ALTER TYPE "ChessEnd" ADD VALUE IF NOT EXISTS 'NO_MOVES';

-- AlterTable (eski barcha qatorlar avtomatik CHESS bo'ladi)
ALTER TABLE "ChessGame" ADD COLUMN IF NOT EXISTS "gameType" "GameType" NOT NULL DEFAULT 'CHESS';
ALTER TABLE "ChessQueue" ADD COLUMN IF NOT EXISTS "gameType" "GameType" NOT NULL DEFAULT 'CHESS';

-- CreateIndex (o'yin turi bo'yicha juftlash uchun)
CREATE INDEX IF NOT EXISTS "ChessQueue_gameType_joinedAt_idx" ON "ChessQueue"("gameType", "joinedAt");