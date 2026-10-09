-- Foydalanuvchi tili (uz | en | ru). NULL — hali tanlamagan. Faqat ustun qo'shiladi, mavjud ma'lumotlar o'zgarmaydi.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "language" TEXT;