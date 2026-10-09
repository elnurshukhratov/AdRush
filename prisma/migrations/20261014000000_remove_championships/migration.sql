-- Chempionat tizimini olib tashlash.
-- MUHIM TARTIB: jadvallarni tashlashdan OLDIN barcha ACTIVE tikishlar to'liq qaytariladi
-- (har biri uchun ledger yozuvi bilan, user rushCoins iga qo'shiladi). Faqat shundan keyin jadvallar o'chadi.
-- Migratsiya qayta ishga tushirilganda xato bermaydi va ikki marta qaytarmaydi (idempotencyKey UNIQUE + IF EXISTS).
-- Eski ledger yozuvlari (COMPETITION_BET, LOSS_REFUND, COMPETITION_WIN) o'chirilmaydi. Userlarning mavjud balansi o'zgarmaydi.

DO $$
BEGIN
  IF to_regclass('public."CompetitionBet"') IS NOT NULL THEN
    -- Parallel tikish yozilib qolmasligi uchun jadvalni qulflaymiz
    LOCK TABLE "CompetitionBet" IN EXCLUSIVE MODE;

    WITH refunded AS (
      INSERT INTO "CoinTransaction" ("userId", "amount", "type", "idempotencyKey", "refType", "refId")
      SELECT b."userId", b."amount", 'LOSS_REFUND', 'BET_REFUND_MIGRATION:' || b."id", 'migration', b."id"::text
      FROM "CompetitionBet" b
      WHERE b."status" = 'ACTIVE' AND b."amount" > 0
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING "userId", "amount"
    )
    UPDATE "User" u
    SET "rushCoins" = u."rushCoins" + s."total"
    FROM (SELECT "userId", SUM("amount")::int AS "total" FROM refunded GROUP BY "userId") s
    WHERE u."id" = s."userId";
  END IF;
END $$;

-- Jadvallar (bog'liqlik tartibida)
DROP TABLE IF EXISTS "CompetitionBet";
DROP TABLE IF EXISTS "Winner";
DROP TABLE IF EXISTS "Prize";
DROP TABLE IF EXISTS "MonthlyStat";

-- competitionId ustunlari (ular bilan FK va indekslar ham ketadi)
ALTER TABLE "AdReward" DROP COLUMN IF EXISTS "competitionId";
ALTER TABLE "AdSession" DROP COLUMN IF EXISTS "competitionId";
ALTER TABLE "CoinTransaction" DROP COLUMN IF EXISTS "competitionId";

DROP TABLE IF EXISTS "MonthlyCompetition";

-- Enumlar
DROP TYPE IF EXISTS "BetStatus";
DROP TYPE IF EXISTS "WinnerStatus";
DROP TYPE IF EXISTS "PrizeStatus";
DROP TYPE IF EXISTS "CompetitionStatus";