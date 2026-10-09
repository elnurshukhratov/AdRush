-- Sovrin topshirilganini tasdiqlovchi rasm (admin yuklaydi). Faqat ustun qo'shiladi, mavjud ma'lumotlar o'zgarmaydi.
ALTER TABLE "Winner" ADD COLUMN IF NOT EXISTS "proofImage" TEXT;
ALTER TABLE "Winner" ADD COLUMN IF NOT EXISTS "proofUploadedAt" TIMESTAMP(3);
