// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, and newlines inside quotes.
// Pure functions — no DOM — so they run in the browser and in Node tests.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function rowsToObjects(rows, headerIndex = 0) {
  const header = rows[headerIndex].map(h => h.trim());
  return rows
    .slice(headerIndex + 1)
    .filter(r => r.some(cell => cell.trim() !== ''))
    .map(r => Object.fromEntries(header.map((key, j) => [key, (r[j] ?? '').trim()])));
}

export function toCSV(rows) {
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
