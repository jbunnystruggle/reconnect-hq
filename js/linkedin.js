// Turns LinkedIn's "Get a copy of your data" export into Reconnect HQ contacts.
// Pure functions — no DOM, no storage — so the same code is unit-tested in Node.

import { parseCSV, rowsToObjects } from './csv.js';

export const normUrl = u => (u || '').trim().replace(/\/+$/, '').toLowerCase();

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const pad = n => String(n).padStart(2, '0');

/** "08 Jul 2026" or "2026-07-12 23:09:53 UTC" → "2026-07-08" / "2026-07-12" ('' if unreadable). */
export function parseLinkedInDate(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()] + 1)}-${pad(+m[1])}`;
  return '';
}

export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function daysBetween(fromISO, toISO) {
  const [a, b] = [fromISO, toISO].map(s => { const [y, mo, d] = s.split('-').map(Number); return Date.UTC(y, mo - 1, d); });
  return Math.round((b - a) / 864e5);
}
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Connections.csv → [{first,last,url,company,position,connected}] (skips LinkedIn's "Notes:" preamble). */
export function parseConnections(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex(r => (r[0] || '').trim() === 'First Name');
  if (hi < 0) throw new Error("This doesn't look like LinkedIn's Connections.csv — no \"First Name\" column found.");
  return rowsToObjects(rows, hi)
    .filter(o => o.URL)
    .map(o => ({
      first: o['First Name'] || '',
      last: o['Last Name'] || '',
      url: o.URL.trim(),
      company: o.Company || '',
      position: o.Position || '',
      connected: parseLinkedInDate(o['Connected On']),
    }));
}

/** messages.csv → [{conv,date,sender,recipients,content,folder}] */
export function parseMessages(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex(r => r.some(c => c.trim().toUpperCase() === 'CONVERSATION ID'));
  if (hi < 0) throw new Error("This doesn't look like LinkedIn's messages.csv — no \"CONVERSATION ID\" column found.");
  return rowsToObjects(rows, hi).map(o => {
    const get = k => o[k] ?? o[k.toUpperCase()] ?? '';
    return {
      conv: get('CONVERSATION ID'),
      date: get('DATE'),
      sender: normUrl(get('SENDER PROFILE URL')),
      recipients: get('RECIPIENT PROFILE URLS').split(',').map(normUrl).filter(Boolean),
      content: get('CONTENT'),
      folder: get('FOLDER').toUpperCase(),
    };
  });
}

/** The export's owner is the profile that appears in the most conversations. */
export function detectMe(messages) {
  const convs = new Map();
  for (const m of messages) {
    for (const u of [m.sender, ...m.recipients]) {
      if (!u) continue;
      if (!convs.has(u)) convs.set(u, new Set());
      convs.get(u).add(m.conv);
    }
  }
  let best = '', n = -1;
  for (const [u, s] of convs) if (s.size > n) { best = u; n = s.size; }
  return best;
}

export const PRODUCT_RX = /\b(product\s*(manager|management|lead|director|designer|owner|advisor|specialist|strategist)|senior\s+product|group\s+p\.?m\.?|technical\s+p\.?m\.?|data\s+product|head\s+of\s+product|cpo|chief\s+product|vp,?\s+(of\s+)?product|svp,?\s+(of\s+)?product|evp,?\s+(of\s+)?product|product\s+ops)\b|\bpm\b/i;

/** Builds one contact per connection, with message stats and a priority score. */
export function buildContacts(connections, messages = [], { today = isoDay(new Date()), meUrl } = {}) {
  const me = normUrl(meUrl) || detectMe(messages);
  const byPerson = new Map();
  const seen = new Set();
  for (const m of messages) {
    if (m.folder === 'SPAM') continue;
    const key = `${m.date}|${m.sender}|${m.content.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const people = new Set([m.sender, ...m.recipients]);
    people.delete(me);
    for (const u of people) {
      if (!u) continue;
      if (!byPerson.has(u)) byPerson.set(u, []);
      byPerson.get(u).push(m);
    }
  }
  return connections.map(c => {
    const id = normUrl(c.url);
    const name = `${c.first} ${c.last}`.trim() || c.url;
    const base = { id, url: c.url, name, first: c.first || name, company: c.company, position: c.position, connected: c.connected };
    const ms = (byPerson.get(id) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!ms.length) {
      const age = c.connected ? daysBetween(c.connected, today) : 5000;
      return { ...base, msgs: 0, lastDate: '', lastFromMe: false, snippet: '', score: +Math.max(0, 3 - age / 1500).toFixed(2) };
    }
    const last = ms[ms.length - 1];
    const fromMe = ms.filter(m => m.sender === me).length;
    const twoWay = fromMe > 0 && fromMe < ms.length;
    const lastDate = parseLinkedInDate(last.date);
    const days = lastDate ? Math.max(0, daysBetween(lastDate, today)) : 3650;
    const score = Math.max(0, 45 - days / 8) + Math.min(ms.length, 25) * (twoWay ? 1.6 : 0.6);
    return {
      ...base,
      msgs: ms.length,
      lastDate,
      lastFromMe: last.sender === me,
      snippet: last.content.replace(/\s+/g, ' ').trim().slice(0, 180),
      score: +score.toFixed(1),
    };
  });
}

const LEVEL = new Set(['senior', 'sr', 'principal', 'staff', 'lead', 'head', 'director', 'vp', 'vice', 'president', 'chief', 'executive', 'svp', 'evp', 'manager', 'associate', 'ceo', 'coo', 'cto', 'cmo', 'cpo', 'founder', 'partner']);
const words = s => new Set((s || '').toLowerCase().match(/[a-z]+/g) || []);

/** True when someone moved companies, changed seniority, or their title meaningfully changed (not just reworded). */
export function roleChanged(prev, next) {
  if ((prev.company || '').trim().toLowerCase() !== (next.company || '').trim().toLowerCase()) return true;
  const a = words(prev.position), b = words(next.position);
  const same = [...a].filter(w => b.has(w));
  if (same.length === a.size && a.size === b.size) return false;
  const la = [...a].filter(w => LEVEL.has(w)).sort().join(), lb = [...b].filter(w => LEVEL.has(w)).sort().join();
  if (la !== lb) return true;
  const union = new Set([...a, ...b]).size || 1;
  return same.length / union < 0.5;
}

/**
 * Merges a fresh import into the previous one.
 * - flags role changes (kept until the next import that changes them again)
 * - records when each person first appeared (for "new connections")
 * - maps profile URLs that changed (same name + connection date) so saved progress follows the person
 */
export function mergeImport(prevContacts, nextContacts, importISO) {
  const prevById = new Map((prevContacts || []).map(c => [c.id, c]));
  const ident = c => `${(c.name || '').toLowerCase()}|${c.connected || ''}`;
  const prevByIdent = new Map((prevContacts || []).map(c => [ident(c), c]));
  const matched = new Set();
  const aliases = {};
  let added = 0, roleChanges = 0;
  const contacts = nextContacts.map(n => {
    let p = prevById.get(n.id);
    if (!p) {
      const alt = prevByIdent.get(ident(n));
      if (alt && !nextContacts.some(x => x.id === alt.id)) { p = alt; aliases[alt.id] = n.id; }
    }
    const out = { ...n };
    if (p) {
      matched.add(p.id);
      out.firstSeen = p.firstSeen || importISO;
      if (roleChanged(p, n)) {
        out.roleChanged = { from: [p.position, p.company].filter(Boolean).join(' · '), at: importISO };
        roleChanges++;
      } else if (p.roleChanged) {
        out.roleChanged = p.roleChanged;
      }
    } else {
      out.firstSeen = importISO;
      if (prevContacts && prevContacts.length) added++;
    }
    return out;
  });
  const removed = (prevContacts || []).filter(c => !matched.has(c.id)).length;
  return { contacts, aliases, stats: { total: contacts.length, added, removed, roleChanges } };
}

/** "{first}", "{company}", "{position}", "{name}" placeholders. */
export function fillTemplate(tpl, c) {
  return (tpl || '').replace(/\{(first|name|company|position)\}/g, (_, k) => {
    if (k === 'company') return c.company || 'your company';
    if (k === 'position') return c.position || 'your role';
    return c[k] || '';
  });
}
