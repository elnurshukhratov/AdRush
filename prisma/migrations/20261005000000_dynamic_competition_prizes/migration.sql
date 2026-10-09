-- 2-bosqich: dinamik competition + dinamik sovrinlar + winner statuslari.
-- Mavjud ma'lumotlar saqlanadi: LOCKED -> ENDED, CONFIRMED -> CONTACTED, REJECTED -> CANCELLED,
-- PrizeConfig qatorlari faol competition uchun Prize ga ko'chiriladi.

-- ---------------------------------------------------------------------------
-- 1) CompetitionStatus: (ACTIVE, LOCKED) -> (DRAFT, ACTIVE, ENDED, ARCHIVED)
-- ---------------------------------------------------------------------------
CREATE TYPE "CompetitionStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'ARCHIVED');

ALTER TABLE "MonthlyCompetition" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MonthlyCompetition"
  ALTER COLUMN "status" TYPE "CompetitionStatus_new"
  USING (CASE "status"::text WHEN 'LOCKED' THEN 'ENDED' ELSE "status"::text END)::"CompetitionStatus_new";
ALTER TABLE "MonthlyCompetition" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "CompetitionStatus";
ALTER TYPE "CompetitionStatus_new" RENAME TO "CompetitionStatus";

-- ---------------------------------------------------------------------------
-- 2) WinnerStatus: (PENDING, CONFIRMED, DELIVERED, REJECTED) -> (PENDING, CONTACTED, DELIVERED, CANCELLED)
-- ---------------------------------------------------------------------------
CREATE TYPE "WinnerStatus_new" AS ENUM ('PENDING', 'CONTACTED', 'DELIVERED', 'CANCELLED');

ALTER TABLE "Winner" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Winner"
  ALTER COLUMN "status" TYPE "WinnerStatus_new"
  USING (CASE "status"::text
           WHEN 'CONFIRMED' THEN 'CONTACTED'
           WHEN 'REJECTED' THEN 'CANCELLED'
           ELSE "status"::text
         END)::"WinnerStatus_new";
ALTER TABLE "Winner" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "WinnerStatus";
ALTER TYPE "WinnerStatus_new" RENAME TO "WinnerStatus";

-- ---------------------------------------------------------------------------
-- 3) PrizeStatus
-- ---------------------------------------------------------------------------
CREATE TYPE "PrizeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- ---------------------------------------------------------------------------
-- 4) MonthlyCompetition: title/description/archivedAt/updatedAt, year-month unique olib tashlanadi
-- ---------------------------------------------------------------------------
ALTER TABLE "MonthlyCompetition" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MonthlyCompetition" ADD COLUMN "description" TEXT;
ALTER TABLE "MonthlyCompetition" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "MonthlyCompetition" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "MonthlyCompetition"
SET "title" = 'AdRush ' || "year"::text || '-' || lpad("month"::text, 2, '0')
WHERE "title" = '';

ALTER TABLE "MonthlyCompetition" ALTER COLUMN "title" DROP DEFAULT;

DROP INDEX IF EXISTS "MonthlyCompetition_year_month_key";

-- Bir nechta ACTIVE qolgan bo'lsa (kutilmagan holat): eng yangisi ACTIVE qoladi, qolganlari ENDED.
UPDATE "MonthlyCompetition" c
SET "status" = 'ENDED', "lockedAt" = COALESCE(c."lockedAt", CURRENT_TIMESTAMP)
WHERE c."status" = 'ACTIVE'
  AND c."id" <> (SELECT m."id" FROM "MonthlyCompetition" m WHERE m."status" = 'ACTIVE' ORDER BY m."startAt" DESC, m."id" DESC LIMIT 1);

-- Faqat bitta ACTIVE competition (DB darajasidagi kafolat; Prisma bu indeksni bilmaydi, lekin teginmaydi)
CREATE UNIQUE INDEX "MonthlyCompetition_single_active" ON "MonthlyCompetition"("status") WHERE "status" = 'ACTIVE';

CREATE INDEX "MonthlyCompetition_status_endAt_idx" ON "MonthlyCompetition"("status", "endAt");
CREATE INDEX "MonthlyCompetition_startAt_idx" ON "MonthlyCompetition"("startAt");

-- ---------------------------------------------------------------------------
-- 5) Prize (DB orqali boshqariladigan sovrinlar)
-- ---------------------------------------------------------------------------
CREATE TABLE "Prize" (
    "id" SERIAL NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "place" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "value" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "PrizeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Prize_competitionId_place_key" ON "Prize"("competitionId", "place");
CREATE INDEX "Prize_competitionId_status_idx" ON "Prize"("competitionId", "status");

ALTER TABLE "Prize" ADD CONSTRAINT "Prize_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "MonthlyCompetition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Eski global PrizeConfig qatorlari (admin o'zgartirgan bo'lishi mumkin) — hozirgi faol competition sovrinlariga
-- ko'chiriladi, hech narsa yo'qotilmaydi. Keyin ularni admin panelda tahrirlash/o'chirish mumkin.
INSERT INTO "Prize" ("competitionId", "place", "title", "status", "updatedAt")
SELECT a."id", p."place", p."title",
       CASE WHEN p."isActive" THEN 'ACTIVE'::"PrizeStatus" ELSE 'INACTIVE'::"PrizeStatus" END,
       CURRENT_TIMESTAMP
FROM "PrizeConfig" p
CROSS JOIN (SELECT "id" FROM "MonthlyCompetition" WHERE "status" = 'ACTIVE' LIMIT 1) a;

DROP TABLE "PrizeConfig";

-- ---------------------------------------------------------------------------
-- 6) Winner: prizeId, note, updatedAt
-- ---------------------------------------------------------------------------
ALTER TABLE "Winner" ADD COLUMN "prizeId" INTEGER;
ALTER TABLE "Winner" ADD COLUMN "note" TEXT;
ALTER TABLE "Winner" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Winner" ADD CONSTRAINT "Winner_prizeId_fkey"
  FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE SET NULL ON UPDATE CASCADE;
