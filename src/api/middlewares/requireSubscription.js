'use strict';

const { ApiError } = require('../../utils/apiError');
const { getAdminRole } = require('../../services/admin/adminService');
const subscriptionService = require('../../services/subscription/subscriptionService');

/** Klientga ketadigan kanal ko'rinishi (chatId ichki ma'lumot, qaytarilmaydi). */
function toClientChannel(channel) {
  if (!channel) return null;
  const out = { id: channel.id, title: channel.title, username: channel.username, inviteUrl: channel.inviteUrl };
  if (channel.member === true || channel.member === false) out.member = channel.member;
  return out;
}

/** Kanallar ro'yxatining klient ko'rinishi (member: true | false — tekshirilgan bo'lsa). */
function toClientChannels(channels) {
  return Array.isArray(channels) ? channels.map(toClientChannel) : [];
}

/**
 * telegramAuth DAN KEYIN ishlatiladi (req.auth.user mavjud).
 * Majburiy kanal sozlangan va foydalanuvchi a'zo bo'lmasa:
 *   403 { success:false, reason:'SUBSCRIPTION_REQUIRED', message, channel:{...birinchi qolgan}, channels:[{ id, title, username, inviteUrl, member? }], requestId }
 * Bir nechta (ko'pi bilan 50 ta) majburiy kanal bo'lishi mumkin: foydalanuvchi HAMMASIGA a'zo bo'lishi kerak.
 * Frontend data.reason ni o'qiydi (USER_BLOCKED kabi). Adminlar tekshiruvdan o'tkaziladi.
 * Telegram ishlamasa getStatus fail-open (subscribed:true) — ilova ochiq qoladi.
 */
async function requireSubscription(req, res, next) {
  try {
    // Kanal sozlanmagan bo'lsa (keshdan) admin/Telegram tekshiruvlari umuman kerak emas
    const active = await subscriptionService.getActiveChannels();
    if (!active.length) return next();

    if (await getAdminRole(req.auth.user.telegramId)) return next();

    const st = await subscriptionService.getStatus(req.auth.user.telegramId);
    if (st.required && !st.subscribed) {
      res.set('Cache-Control', 'private, no-store');
      throw new ApiError(403, 'SUBSCRIPTION_REQUIRED', 'Davom etish uchun kanalga obuna bo\'ling', {
        channel: toClientChannel(st.channel),
        channels: toClientChannels(st.channels),
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireSubscription, toClientChannel, toClientChannels };