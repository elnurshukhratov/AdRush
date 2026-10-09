'use strict';

const { z } = require('zod');
const { ApiError, asyncHandler } = require('../../utils/apiError');
const { isValidImageUrl } = require('../../services/uploads/imageService');
const shopAdmin = require('../../services/shop/shopAdminService');
const { notifyShopOrder } = require('../../bot/notify');

const KINDS = ['GIFT', 'STARS', 'PREMIUM', 'CUSTOM'];
const actor = (req) => req.auth.telegramId;
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

// Mahsulot rasmi faqat bizning /uploads/shop/<uuid>.<ext> yo'li bo'lishi mumkin (tashqi URL rad etiladi)
const shopImageUrl = z
  .string()
  .refine((v) => isValidImageUrl(v) && v.startsWith('/uploads/shop/'), 'imageUrl noto\'g\'ri');
// Bo'sh satr -> null
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const productFields = {
  title: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  imageUrl: shopImageUrl.nullable(),
  priceRush: z.number().int().min(1).max(100_000_000),
  kind: z.enum(KINDS),
  stock: z.number().int().min(0).max(1_000_000).nullable(), // null = cheksiz
  isActive: z.boolean(),
  sortOrder: z.number().int().min(-10000).max(10000),
};

const createSchema = z
  .object({
    title: productFields.title,
    description: productFields.description.optional(),
    imageUrl: productFields.imageUrl.optional(),
    priceRush: productFields.priceRush,
    kind: productFields.kind.default('CUSTOM'),
    stock: productFields.stock.default(null),
    isActive: productFields.isActive.default(true),
    sortOrder: productFields.sortOrder.default(0),
  })
  .strict();

const patchSchema = z
  .object({
    title: productFields.title.optional(),
    description: productFields.description.optional(),
    imageUrl: productFields.imageUrl.optional(),
    priceRush: productFields.priceRush.optional(),
    kind: productFields.kind.optional(),
    stock: productFields.stock.optional(),
    isActive: productFields.isActive.optional(),
    sortOrder: productFields.sortOrder.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Hech narsa o\'zgartirilmadi');

const idParams = z.object({ id: z.coerce.number().int().positive().safe() }).strict();

const ordersQuery = z
  .object({
    status: z.enum(shopAdmin.ORDER_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().regex(/^\d{1,10}$/).optional(),
  })
  .strict();

const orderPatch = z
  .object({
    status: z.enum(shopAdmin.ORDER_STATUSES).optional(),
    adminNote: optionalText(1000).optional(),
  })
  .strict()
  .refine((o) => o.status !== undefined || o.adminNote !== undefined, 'Hech narsa o\'zgartirilmadi');

function requireImageBody(req) {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ApiError(400, 'INVALID_IMAGE', 'Rasm yuborilmadi (Content-Type: image/jpeg | image/png | image/webp)');
  return buf;
}

// ---------- Mahsulotlar ----------
const listProducts = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json({ success: true, items: await shopAdmin.listProducts() });
});

const createProduct = asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  res.status(201).json({ success: true, product: await shopAdmin.createProduct(data, actor(req)) });
});

const updateProduct = asyncHandler(async (req, res) => {
  const { id } = idParams.parse(req.params);
  const patch = patchSchema.parse(req.body);
  res.json({ success: true, product: await shopAdmin.updateProduct(id, patch, actor(req)) });
});

/** Buyurtmasi bor mahsulot o'chirilmaydi: { deleted:false, deactivated:true }. */
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json({ success: true, ...(await shopAdmin.deleteProduct(id, actor(req))) });
});

const uploadShopImage = asyncHandler(async (req, res) => {
  const imageUrl = await shopAdmin.uploadProductImage(requireImageBody(req));
  res.status(201).json({ success: true, imageUrl });
});

// ---------- Buyurtmalar ----------
const listOrders = asyncHandler(async (req, res) => {
  const q = ordersQuery.parse(req.query);
  noStore(res);
  res.json({ success: true, ...(await shopAdmin.listOrders({ status: q.status || null, limit: q.limit, cursor: q.cursor || null })) });
});

const updateOrder = asyncHandler(async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = orderPatch.parse(req.body);
  const { order, notify } = await shopAdmin.updateOrder(id, body, actor(req));
  res.json({ success: true, order });
  // Xabar javobdan keyin; yuborilmasa xato bermaydi (notifyShopOrder o'zi loglaydi)
  if (notify) notifyShopOrder(notify).catch(() => {});
});

const uploadOrderProof = asyncHandler(async (req, res) => {
  const { id } = idParams.parse(req.params);
  const order = await shopAdmin.setOrderProof(id, requireImageBody(req), actor(req));
  res.status(201).json({ success: true, order });
});

module.exports = { listProducts, createProduct, updateProduct, deleteProduct, uploadShopImage, listOrders, updateOrder, uploadOrderProof };