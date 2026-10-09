'use strict';

const { ensureUser } = require('../../services/users/userService');

/**
 * Har bir update uchun userni DBdan oladi/yaratadi va ctx.dbUser ga qo'yadi.
 * ctx.isNewUser — user aynan shu update'da birinchi marta yaratilgan bo'lsa true (referral shu belgiga tayanadi).
 */
function userSync() {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    const { user, created } = await ensureUser(ctx.from);
    ctx.dbUser = user;
    ctx.isNewUser = created;
    return next();
  };
}

module.exports = { userSync };
