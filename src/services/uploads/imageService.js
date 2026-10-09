'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');

const SHOP_DIR = path.join(config.uploads.dir, 'shop'); // do'kon mahsulotlari rasmlari (faqat admin yuklaydi)
const PROOF_DIR = path.join(config.uploads.dir, 'proofs'); // buyurtma yetkazilganini tasdiqlovchi rasmlar (faqat admin)
const URL_RE = /^\/uploads\/(?:shop|proofs)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Fayl turi Content-Type ga emas, haqiqiy magic bytes ga qarab aniqlanadi. */
function detectType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Faqat bizning /uploads/shop/<uuid>.<jpg|png|webp> (yoki /uploads/proofs/...) yo'li (tashqi URL va path traversal rad etiladi). */
function isValidImageUrl(url) {
  return typeof url === 'string' && URL_RE.test(url);
}

/** Rasmni berilgan papkaga saqlaydi va public yo'lni qaytaradi; format noto'g'ri bo'lsa null. */
async function saveImage(buf, dir, kind) {
  const type = detectType(buf);
  if (!type) return null;
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${type}`;
  await fs.promises.writeFile(path.join(dir, name), buf, { flag: 'wx', mode: 0o644 });
  return `/uploads/${kind}/${name}`;
}

const saveShopImage = (buf) => saveImage(buf, SHOP_DIR, 'shop');
const saveProofImage = (buf) => saveImage(buf, PROOF_DIR, 'proofs');

/** Faylni o'chiradi (xato asosiy oqimni buzmaydi). Faqat validatsiyadan o'tgan yo'l o'chiriladi. */
async function deleteImage(url) {
  if (!isValidImageUrl(url)) return;
  try {
    const dir = url.startsWith('/uploads/proofs/') ? PROOF_DIR : SHOP_DIR;
    await fs.promises.unlink(path.join(dir, path.basename(url)));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err: err.message, url }, 'Rasmni o\'chirib bo\'lmadi');
  }
}

module.exports = { detectType, isValidImageUrl, saveShopImage, saveProofImage, deleteImage };