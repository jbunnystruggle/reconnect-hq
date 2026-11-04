import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, toCSV } from '../js/csv.js';
import {
  parseConnections, parseMessages, buildContacts, detectMe, mergeImport, roleChanged,
  parseLinkedInDate, fillTemplate, PRODUCT_RX, addDaysISO, daysBetween,
} from '../js/linkedin.js';
import { makeICS } from '../js/ics.js';

const sample = name => readFileSync(new URL(`../sample/${name}`, import.meta.url), 'utf8');

test('CSV: quotes, escaped quotes, commas and newlines inside fields', () => {
  const rows = parseCSV('a,b,c\n"x, y","say ""hi""","line1\nline2"\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']]);
});

test('CSV: round-trips through toCSV', () => {
  const data = [['Name', 'Note'], ['Avery', 'Met at "Summit", follow up\nnext week']];
  assert.deepEqual(parseCSV(toCSV(data)).filter(r => r.length > 1), data);
});

test('dates: LinkedIn formats', () => {
  assert.equal(parseLinkedInDate('08 Jul 2026'), '2026-07-08');
  assert.equal(parseLinkedInDate('2026-07-12 23:09:53 UTC'), '2026-07-12');
  assert.equal(parseLinkedInDate('garbage'), '');
  assert.equal(addDaysISO('2026-12-28', 7), '2027-01-04');
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
});

test('connections: skips the Notes preamble and reads every row', () => {
  const conns = parseConnections(sample('Connections.csv'));
  assert.equal(conns.length, 60);
  assert.ok(conns.every(c => c.url.startsWith('https://www.linkedin.com/in/') && /^\d{4}-\d{2}-\d{2}$/.test(c.connected)));
});

test('connections: rejects a file that is not Connections.csv', () => {
  assert.throws(() => parseConnections('foo,bar\n1,2\n'), /Connections\.csv/);
});

test('messages: detects the export owner and attributes threads', () => {
  const msgs = parseMessages(sample('messages.csv'));
  assert.equal(detectMe(msgs), 'https://www.linkedin.com/in/sam-sample-demo');
  const contacts = buildContacts(parseConnections(sample('Connections.csv')), msgs, { today: '2026-11-01' });
  const withMsgs = contacts.filter(c => c.msgs > 0);
  assert.equal(withMsgs.length, 26);
  assert.ok(withMsgs.every(c => c.lastDate && c.snippet));
  assert.ok(contacts.every(c => c.id === c.url.toLowerCase()));
});

test('messages: duplicates and spam are ignored', () => {
  const head = '"CONVERSATION ID","FROM","SENDER PROFILE URL","TO","RECIPIENT PROFILE URLS","DATE","CONTENT","FOLDER"\n';
  const row = (folder, content = 'hi') => `"c1","A","https://www.linkedin.com/in/a","Me","https://www.linkedin.com/in/me","2026-01-01 10:00:00 UTC","${content}","${folder}"\n`;
  const msgs = parseMessages(head + row('INBOX') + row('INBOX') + row('SPAM', 'buy now'));
  const conns = [{ first: 'A', last: 'B', url: 'https://www.linkedin.com/in/a', company: '', position: '', connected: '2025-01-01' }];
  const [c] = buildContacts(conns, msgs, { meUrl: 'https://www.linkedin.com/in/me', today: '2026-02-01' });
  assert.equal(c.msgs, 1);
});

test('role changes: company moves and promotions count, rewording does not', () => {
  assert.equal(roleChanged({ company: 'A', position: 'PM' }, { company: 'B', position: 'PM' }), true);
  assert.equal(roleChanged({ company: 'A', position: 'Director of Product' }, { company: 'A', position: 'VP of Product' }), true);
  assert.equal(roleChanged({ company: 'A', position: 'Marketing Coordinator (Project-Based)' }, { company: 'A', position: 'Marketing Coordinator' }), false);
  assert.equal(roleChanged({ company: 'A', position: 'Senior Product Manager' }, { company: 'a', position: 'senior product manager' }), false);
});

test('re-import: keeps first-seen dates, flags role changes and new people, follows changed URLs', () => {
  const v1 = [
    { id: 'u/a', url: 'u/a', name: 'Ann One', connected: '2024-01-01', company: 'X', position: 'PM' },
    { id: 'u/b', url: 'u/b', name: 'Ben Two', connected: '2024-02-01', company: 'Y', position: 'Engineer' },
    { id: 'u/c-old', url: 'u/c-old', name: 'Cy Three', connected: '2024-03-01', company: 'Z', position: 'Designer' },
  ];
  const first = mergeImport([], v1, '2026-07-01');
  assert.equal(first.stats.added, 0);
  assert.ok(first.contacts.every(c => c.firstSeen === '2026-07-01'));

  const v2 = [
    { id: 'u/a', url: 'u/a', name: 'Ann One', connected: '2024-01-01', company: 'NewCo', position: 'PM' },
    { id: 'u/c-new', url: 'u/c-new', name: 'Cy Three', connected: '2024-03-01', company: 'Z', position: 'Designer' },
    { id: 'u/d', url: 'u/d', name: 'Dee Four', connected: '2026-10-01', company: 'Q', position: 'CEO' },
  ];
  const second = mergeImport(first.contacts, v2, '2026-11-01');
  const by = Object.fromEntries(second.contacts.map(c => [c.id, c]));
  assert.deepEqual(by['u/a'].roleChanged, { from: 'PM · X', at: '2026-11-01' });
  assert.equal(by['u/a'].firstSeen, '2026-07-01');
  assert.equal(by['u/d'].firstSeen, '2026-11-01');
  assert.deepEqual(second.aliases, { 'u/c-old': 'u/c-new' });
  assert.deepEqual(second.stats, { total: 3, added: 1, removed: 1, roleChanges: 1 });

  const third = mergeImport(second.contacts, v2, '2026-12-01');
  assert.deepEqual(third.contacts.find(c => c.id === 'u/a').roleChanged, { from: 'PM · X', at: '2026-11-01' }, 'flag carries forward until the role changes again');
});

test('product titles are detected', () => {
  for (const t of ['Senior Product Manager', 'VP of Product', 'Head of Product', 'Group PM', 'Chief Product Officer', 'CPO & Co-Founder'])
    assert.ok(PRODUCT_RX.test(t), t);
  for (const t of ['Production Assistant', 'Software Engineer', 'Marketing Director'])
    assert.ok(!PRODUCT_RX.test(t), t);
});

test('templates fill placeholders with sensible fallbacks', () => {
  assert.equal(fillTemplate('Hi {first} at {company}', { first: 'Ann', company: 'X' }), 'Hi Ann at X');
  assert.equal(fillTemplate('Hi {first} at {company}', { first: 'Ann', company: '' }), 'Hi Ann at your company');
});

test('calendar reminder is a valid all-day event', () => {
  const ics = makeICS({ uid: 'u/a', date: '2026-11-30', title: 'Follow up with Ann, PM; X', url: 'https://x', now: new Date('2026-11-01T00:00:00Z') });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261201\r\n/);
  assert.match(ics, /SUMMARY:Follow up with Ann\\, PM\\; X\r\n/);
});
