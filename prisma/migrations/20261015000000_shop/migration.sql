-- Do'kon: mahsulotlar va buyurtmalar. Faqat qo'shiladi; hech qanday mahsulot seed qilinmaydi.

DO $$
BEGIN
  CREATE TYPE "ShopKind" AS ENUM ('GIFT', 'STARS', 'PREMIUM', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ShopProduct" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "priceRush" INTEGER NOT NULL,
  "kind" "ShopKind" NOT NULL DEFAULT 'CUSTOM',
  "stock" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShopOrder" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "productId" INTEGER,
  "productTitle" TEXT NOT NULL,
  "productKind" "ShopKind" NOT NULL,
  "priceRush" INTEGER NOT NULL,
  "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
  "adminNote" TEXT,
  "proofImage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- Narx musbat, zaxira manfiy bo'lmaydi (parallel so'rovlarda ham DB darajasida kafolat)
DO $$
BEGIN
  ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_priceRush_positive" CHECK ("priceRush" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_stock_nonneg" CHECK ("stock" IS NULL OR "stock" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ShopProduct_isActive_sortOrder_idx" ON "ShopProduct"("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "ShopOrder_userId_id_idx" ON "ShopOrder"("userId", "id" DESC);
CREATE INDEX IF NOT EXISTS "ShopOrder_status_id_idx" ON "ShopOrder"("status", "id" DESC);
CREATE INDEX IF NOT EXISTS "ShopOrder_productId_idx" ON "ShopOrder"("productId");

DO $$
BEGIN
  ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;