'use strict';

const { Api } = require('grammy');
const config = require('../config');
const logger = require('../utils/logger');
const { t } = require('./i18n');
const { escapeHtml } = require('../utils/format');

let api = null;
function getApi() {
  if (!api) api = new Api(config.botToken);
  return api;
}

/**
 * Buyurtma holati o'zgarganda userga xabar (user tilida). Faqat DELIVERED va CANCELLED uchun.
 * Xabar yuborib bo'lmasa (user botni bloklagan va h.k.) xato bermaydi — faqat log.
 */
async function notifyShopOrder({ telegramId, language, status, orderId, productTitle, priceRush }) {
  const key = status === 'DELIVERED' ? 'shop_order_delivered' : status === 'CANCELLED' ? 'shop_order_cancelled' : null;
  if (!key) return false;
  try {
    const text = t(language, key, { title: escapeHtml(productTitle), id: orderId, price: priceRush });
    await getApi().sendMessage(Number(telegramId), text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    return true;
  } catch (err) {
    logger.warn({ orderId, telegramId: String(telegramId), err: err.description || err.message }, 'Buyurtma xabarini yuborib bo\'lmadi');
    return false;
  }
}

module.exports = { notifyShopOrder };