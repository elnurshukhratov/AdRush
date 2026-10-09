-- Foydalanuvchilar orasida Rush Coin o'tkazmasi: ledger uchun ikkita yangi tur. Mavjud ma'lumotlar o'zgarmaydi, faqat qo'shiladi.

-- AlterEnum
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "CoinTxType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';