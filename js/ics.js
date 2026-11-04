// Builds a one-event calendar file (.ics) for a follow-up reminder. Works in Google Calendar, Outlook, and Apple Calendar.

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10).replace(/-/g, '');
}

/** All-day event on `date` (YYYY-MM-DD). */
export function makeICS({ uid, date, title, description = '', url = '', now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reconnect HQ//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${esc(uid)}@reconnect-hq`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${nextDay(date)}`,
    `SUMMARY:${esc(title)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    url ? `URL:${esc(url)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}
