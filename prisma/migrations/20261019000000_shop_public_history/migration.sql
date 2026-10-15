-- Do'kon: ommaviy "Tarix" bo'limi. Faqat qo'shiladi; mavjud ma'lumotlar o'zgarmaydi.
-- confirmedAt: buyurtma DELIVERED bo'lgan VA admin isbot rasmini yuklagan payt (bir marta). NULL = Tarixda ko'rinmaydi.

ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

-- Mavjud yetkazilgan va isbot rasmi bor buyurtmalar (admin allaqachon tasdiqlagan) Tarixga kiradi.
UPDATE "ShopOrder"
SET "confirmedAt" = COALESCE("resolvedAt", "updatedAt")
WHERE "status" = 'DELIVERED' AND "proofImage" IS NOT NULL AND "confirmedAt" IS NULL;

-- DB darajasidagi kafolat: confirmedAt faqat yetkazilgan va isbot rasmi bor buyurtmada bo'lishi mumkin
DO $$
BEGIN
  ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_confirmed_requires_delivery"
    CHECK ("confirmedAt" IS NULL OR ("status" = 'DELIVERED' AND "proofImage" IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Tarix ro'yxati (yangi tasdiqlanganlar birinchi) uchun
CREATE INDEX IF NOT EXISTS "ShopOrder_confirmedAt_id_idx" ON "ShopOrder"("confirmedAt" DESC, "id" DESC);