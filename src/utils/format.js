'use strict';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function medal(place) {
  return MEDALS[place] || `${place}.`;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function displayName(user) {
  if (user.username) return `@${escapeHtml(user.username)}`;
  return escapeHtml(user.firstName || 'Foydalanuvchi');
}

const MONTHS_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

function monthLabel(competition) {
  return `${MONTHS_UZ[competition.month - 1]} ${competition.year}`;
}

module.exports = { escapeHtml, medal, formatNumber, displayName, monthLabel };
