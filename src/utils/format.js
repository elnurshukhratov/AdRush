'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function displayName(user) {
  if (user.username) return `@${escapeHtml(user.username)}`;
  return escapeHtml(user.firstName || 'Foydalanuvchi');
}

module.exports = { escapeHtml, formatNumber, displayName };