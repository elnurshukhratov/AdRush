-- 3-bosqich: indekslar (performance). Ma'lumotlar o'zgarmaydi, faqat qo'shiladi.

-- Cooldown (oxirgi reward) va kunlik limit so'rovlari: WHERE userId = ? AND createdAt >= ? / ORDER BY createdAt DESC
CREATE INDEX IF NOT EXISTS "AdReward_userId_createdAt_idx" ON "AdReward"("userId", "createdAt" DESC);

-- Sessiyalarni competition + status bo'yicha qidirish (competition o'chirish tekshiruvi, tozalash jobi)
CREATE INDEX IF NOT EXISTS "AdSession_competitionId_status_idx" ON "AdSession"("competitionId", "status");

-- Foydalanuvchi g'olib bo'lgan competitionlar
CREATE INDEX IF NOT EXISTS "Winner_userId_idx" ON "Winner"("userId");

-- Hali sessiyaga bog'lanmagan AdsGram tasdiqlari (claim paytida qidiriladi). Partial index: Prisma bilmaydi, lekin teginmaydi.
CREATE INDEX IF NOT EXISTS "AdsgramConfirmation_unmatched_idx"
  ON "AdsgramConfirmation"("telegramId", "receivedAt")
  WHERE "sessionId" IS NULL;

-- Dashboard "oxirgi 24 soat shubhali faollik" va audit feed: action prefiksi + vaqt
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);
