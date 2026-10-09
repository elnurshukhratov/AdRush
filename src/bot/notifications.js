'use strict';

const { medal, formatNumber, displayName, escapeHtml } = require('../utils/format');

function who(u) {
  return `${displayName(u)} (<code>${u.telegramId}</code>)`;
}

/** Competition avtomatik tugaganda adminlarga yuboriladigan qisqa xabarnoma (bot boshqaruv paneli emas). */
function closeReportText(r, { auto = false } = {}) {
  const lines = [
    `🔒 <b>${escapeHtml(r.competition.title)}</b> tugadi${auto ? ' (avtomatik)' : ''}`,
    `👥 Ishtirokchilar: <b>${formatNumber(r.participants)}</b>`,
    '',
  ];
  if (r.winners.length) {
    for (const w of r.winners) {
      lines.push(`${medal(w.place)} ${who(w)} — ${formatNumber(w.validAds)} reklama\n   🎁 ${escapeHtml(w.prize)}`);
    }
  } else {
    lines.push('G\'oliblar yo\'q (ishtirokchi yoki sovrin belgilanmagan).');
  }
  lines.push('', 'Natijalarni AdRush ilovasidagi Admin bo\'limida ko\'ring.');
  return lines.join('\n');
}

module.exports = { closeReportText };
