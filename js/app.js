import { parseConnections, parseMessages, buildContacts, mergeImport, fillTemplate, PRODUCT_RX, isoDay, addDaysISO, normUrl } from './linkedin.js';
import { toCSV } from './csv.js';
import { makeICS } from './ics.js';
import { load, save, clearAll, loadSettings, storageWorks, DEFAULT_SETTINGS, TAG_COLORS } from './store.js';

// ---------------------------------------------------------------- state
let contacts = load('contacts', []);
let meta = load('meta', null);          // { importedAt, importCount, demo, total, withMessages }
let progress = load('progress', {});    // { [contactId]: { stars, status, sentAt, snoozeUntil, prevStatus, note, roles, draft, tags, roleSeen } }
let settings = loadSettings();
let filters = load('filters', { flags: [], status: [] });
let query = '', sortBy = 'score', shown = 60, kIndex = -1;
const PAGE = 60;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BY_ID = () => Object.fromEntries(contacts.map(c => [c.id, c]));
let byId = BY_ID();

// ---------------------------------------------------------------- status model
const STATUSES = ['none', 'reach', 'sent', 'replied', 'meeting', 'skip'];
const STATUS_LABEL = { none: 'Set status…', reach: '☐ To reach out', sent: '➤ Sent', replied: '✓ Replied', meeting: '★ Meeting booked', skip: '– Skip' };
const STATUS_CHIPS = [
  { id: 'none', label: 'No status', dot: 'var(--muted)' },
  { id: 'reach', label: 'To reach out', dot: 'var(--seg-warm)' },
  { id: 'sent', label: 'Sent', dot: 'var(--coral)' },
  { id: 'replied', label: 'Replied', dot: 'var(--good)' },
  { id: 'meeting', label: 'Meeting booked', dot: 'var(--teal)' },
  { id: 'skip', label: 'Skip', dot: 'var(--seg-dormant)' },
  { id: 'snoozed', label: 'Snoozed', dot: 'var(--seg-dormant-ink)' },
];

const today = () => isoDay(new Date());
const entry = c => progress[c.id] || {};
const isSnoozing = e => !!(e && e.status === 'snoozed' && e.snoozeUntil && today() < e.snoozeUntil);
const snoozeEnded = c => { const e = entry(c); return e.status === 'snoozed' && !isSnoozing(e); };
function getStatus(c) {
  const e = entry(c);
  if (!e.status) return 'none';
  if (e.status === 'snoozed') return isSnoozing(e) ? 'snoozed' : (e.prevStatus || 'none');
  return e.status;
}
const getStars = c => entry(c).stars || 0;
const getNote = c => entry(c).note || '';
const fmtDay = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
const daysSinceTs = ts => Math.floor((Date.now() - ts) / 864e5);
const followUpDue = c => getStatus(c) === 'sent' && entry(c).sentAt && daysSinceTs(entry(c).sentAt) >= settings.followUpDays;
const roleFlag = c => !!(c.roleChanged && entry(c).roleSeen !== c.roleChanged.at);
const isNewConnection = c => !!(meta && meta.importCount > 1 && c.firstSeen === (meta.importId || meta.importedAt));

// ---------------------------------------------------------------- tags
const tagColor = t => TAG_COLORS[t.color] || TAG_COLORS.teal;
function autoTag(c, t) {
  const title = c.position || '';
  if (t.auto === 'product' && PRODUCT_RX.test(title)) return true;
  const kws = (t.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
  return kws.some(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(title));
}
function hasTag(c, t) {
  const o = entry(c).tags;
  return o && typeof o[t.id] === 'boolean' ? o[t.id] : autoTag(c, t);
}

// ---------------------------------------------------------------- persistence
function persist(id) {
  if (id && progress[id]) {
    const e = progress[id];
    for (const k of Object.keys(e)) if (e[k] === undefined || e[k] === '' || e[k] === 0 || (k === 'tags' && !Object.keys(e.tags).length)) delete e[k];
    if (!Object.keys(e).length) delete progress[id];
  }
  const ok = save('progress', progress);
  const msg = $('save-msg');
  msg.textContent = ok ? 'Saved in this browser' : 'Not saved — browser storage is blocked or full';
  msg.classList.toggle('warn', !ok);
}
const ensure = id => (progress[id] = progress[id] || {});

// ---------------------------------------------------------------- filters
function flagDefs() {
  const defs = settings.tags.map(t => ({ id: 'tag:' + t.id, label: t.label, dot: tagColor(t), test: c => hasTag(c, t) }));
  defs.push({ id: 'newrole', label: 'New role', dot: 'var(--teal)', test: roleFlag });
  if (meta && meta.importCount > 1) defs.push({ id: 'newconn', label: 'New connections', dot: 'var(--coral)', test: isNewConnection });
  defs.push({ id: 'unrated', label: 'Unrated', dot: 'var(--star)', test: c => !getStars(c) && getStatus(c) !== 'skip' });
  defs.push({ id: 'due', label: 'Follow-up due', dot: 'var(--seg-warm)', test: followUpDue });
  return defs;
}
function matches(c, flagSet = new Set(filters.flags), statusSet = new Set(filters.status), defs = flagDefs()) {
  const st = getStatus(c);
  if (statusSet.size && !statusSet.has(st)) return false;
  if (!statusSet.has('snoozed') && st === 'snoozed') return false;
  for (const f of defs) if (flagSet.has(f.id) && !f.test(c)) return false;
  return true;
}
const saveFilters = () => save('filters', filters);

function renderTabs() {
  const defs = flagDefs();
  filters.flags = filters.flags.filter(id => defs.some(d => d.id === id));
  const flagSet = new Set(filters.flags), statusSet = new Set(filters.status);
  const flagHTML = defs.map(f => {
    const fs = new Set(flagSet); fs.add(f.id);
    const n = contacts.filter(c => matches(c, fs, statusSet, defs)).length;
    return `<button class="tab" data-group="flag" data-id="${esc(f.id)}" aria-pressed="${flagSet.has(f.id)}"><span class="dot" style="--d:${f.dot}"></span>${esc(f.label)} <span class="ct">${n}</span></button>`;
  }).join('');
  const any = flagSet.size || statusSet.size;
  const statusHTML = STATUS_CHIPS.map(s => {
    const n = contacts.filter(c => getStatus(c) === s.id && matches(c, flagSet, new Set([s.id]), defs)).length;
    return `<button class="tab st" data-group="status" data-id="${s.id}" aria-pressed="${statusSet.has(s.id)}" style="--d:${s.dot}"><span class="cb" aria-hidden="true"></span>${s.label} <span class="ct">${n}</span></button>`;
  }).join('');
  $('tabs').innerHTML =
    `<div class="fgroup" role="group" aria-label="Show only"><span class="flabel">Show only</span><div class="chips">${flagHTML}${any ? '<button class="tab clear" data-group="clear">✕ Clear filters</button>' : ''}</div></div>` +
    `<div class="fgroup" role="group" aria-label="Status"><span class="flabel">Status</span><div class="chips st-grid">${statusHTML}</div></div>`;
}

function visible() {
  const defs = flagDefs(), fs = new Set(filters.flags), ss = new Set(filters.status);
  let arr = contacts.filter(c => matches(c, fs, ss, defs));
  if (query) {
    const q = query.toLowerCase();
    arr = arr.filter(c => `${c.name} ${c.company} ${c.position} ${getNote(c)} ${entry(c).roles || ''}`.toLowerCase().includes(q));
  }
  const by = {
    recent: (a, b) => (b.lastDate || '').localeCompare(a.lastDate || '') || b.score - a.score,
    msgs: (a, b) => b.msgs - a.msgs || b.score - a.score,
    stars: (a, b) => getStars(b) - getStars(a) || b.score - a.score,
    connected: (a, b) => (b.connected || '').localeCompare(a.connected || ''),
    name: (a, b) => a.name.localeCompare(b.name),
    score: (a, b) => b.score - a.score,
  }[sortBy] || ((a, b) => b.score - a.score);
  return arr.slice().sort(by);
}

// ---------------------------------------------------------------- rendering
function weekStart() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); }
function renderStats() {
  const ws = weekStart();
  const thisWeek = contacts.filter(c => entry(c).sentAt >= ws).length;
  const reached = contacts.filter(c => ['sent', 'replied', 'meeting'].includes(getStatus(c))).length;
  const wins = contacts.filter(c => ['replied', 'meeting'].includes(getStatus(c))).length;
  const due = contacts.filter(followUpDue).length;
  const goal = Math.max(1, +settings.weeklyGoal || 3);
  $('stats').innerHTML = `
    <div class="stat goal"><div class="n">${thisWeek} / ${goal}</div><div class="l">sent this week</div><div class="goalbar"><span style="width:${Math.min(100, thisWeek / goal * 100)}%"></span></div></div>
    <div class="stat reached"><div class="n">${reached}</div><div class="l">reached out so far</div></div>
    <div class="stat wins"><div class="n">${wins}</div><div class="l">replies &amp; meetings</div></div>
    <div class="stat due"><div class="n">${due}</div><div class="l">follow-ups due</div></div>`;
}

const initials = c => c.name.split(/\s+/).filter(w => /^\p{L}/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '•';
const defaultRole = c => [c.position, c.company].filter(Boolean).join(' · ');
const fmtAgo = days => days < 31 ? `${days} days ago` : days < 365 ? `${Math.round(days / 30.4)} mo ago` : `${(days / 365).toFixed(1)} yr ago`;
const daysSinceISO = iso => Math.max(0, Math.round((new Date(today() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 864e5));

function starHTML(c) {
  const n = getStars(c);
  const tips = ['Name recognition only', 'Real exchange — acquaintance', 'Real relationship — would pick up the phone'];
  return `<span class="c-stars" role="group" aria-label="Relationship strength">` +
    [1, 2, 3].map(i => `<button class="star-btn${i <= n ? ' lit' : ''}" data-star="${i}" title="${tips[i - 1]}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('') + `</span>`;
}
function statusOptions(c, st) {
  const e = entry(c);
  let h = STATUSES.map(s => `<option value="${s}" ${s === st ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');
  if (st === 'snoozed') h += `<option value="snoozed" selected>⏸ Snoozed until ${fmtDay(e.snoozeUntil)}</option>`;
  h += '<option disabled>──────────</option>' + [7, 14, 30].map(n => `<option value="snooze${n}">⏸ Snooze ${n} days</option>`).join('');
  return h;
}
function reminderDate(c) {
  const e = entry(c), st = getStatus(c);
  if (st === 'snoozed') return e.snoozeUntil;
  if (st === 'sent' && e.sentAt) return addDaysISO(isoDay(new Date(e.sentAt)), +settings.followUpDays || 7);
  return '';
}

function cardHTML(c) {
  const e = entry(c), st = getStatus(c);
  const thread = c.msgs > 0;
  const tpl = thread ? settings.templates.history : settings.templates.fresh;
  const draft = e.draft || fillTemplate(tpl, c);
  const note = getNote(c);
  const tags = settings.tags.filter(t => hasTag(c, t));
  const missing = settings.tags.filter(t => !hasTag(c, t));
  const rd = reminderDate(c);
  return `
  <article class="contact" data-id="${esc(c.id)}" data-status="${st}">
    <div class="avatar" aria-hidden="true">${esc(initials(c))}</div>
    <div class="c-body">
      <div class="c-top">
        <span class="c-name"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></span>
        ${isNewConnection(c) ? '<span class="badge new">New</span>' : ''}
        ${roleFlag(c) ? `<button class="badge new-role" data-act="role-seen" title="Was: ${esc(c.roleChanged.from)} — click to dismiss">New role ✕</button>` : ''}
        ${st === 'snoozed' ? `<span class="badge snooze">Snoozed until ${fmtDay(e.snoozeUntil)}</span>` : ''}
        ${snoozeEnded(c) ? `<span class="badge snooze-ended">Snooze ended ${fmtDay(e.snoozeUntil)}</span>` : ''}
        ${followUpDue(c) ? '<span class="badge due">Follow-up due</span>' : ''}
        ${tags.map(t => `<button class="badge tag" style="--tc:${tagColor(t)}" data-act="tag-off" data-tag="${esc(t.id)}" title="Remove ${esc(t.label)} tag">${esc(t.label)} ✕</button>`).join('')}
        ${missing.length ? `<select class="tag-add" aria-label="Add a tag"><option value="">+ Tag</option>${missing.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select>` : ''}
        ${starHTML(c)}
      </div>
      <div class="c-top">
        <span class="c-role${e.roles ? ' custom' : ''}">${esc(e.roles || defaultRole(c))}</span>
        <button class="edit-role" data-act="edit-role" title="LinkedIn's export only includes the primary role — add others here">✎ roles</button>
      </div>
      ${roleFlag(c) ? `<div class="was">Was: ${esc(c.roleChanged.from)}</div>` : ''}
      <div class="c-meta">
        ${thread ? `<span><b>${c.msgs}</b> message${c.msgs === 1 ? '' : 's'}</span><span>last <b>${fmtAgo(daysSinceISO(c.lastDate))}</b> (${c.lastDate})</span>` : '<span>no LinkedIn messages</span>'}
        ${c.connected ? `<span>connected ${c.connected}</span>` : ''}
      </div>
      ${c.snippet ? `<div class="c-snippet"><span class="who">${c.lastFromMe ? 'You' : esc(c.first)}:</span> ${esc(c.snippet)}${c.snippet.length >= 180 ? '…' : ''}</div>` : ''}
      <div class="c-actions">
        <button class="btn primary" data-act="toggle">Draft message</button>
        <a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">Open profile ↗</a>
        <select class="status-sel${st === 'none' ? ' unset' : ''}" aria-label="Status for ${esc(c.name)}">${statusOptions(c, st)}</select>
        ${rd ? `<button class="btn small" data-act="ics" title="Download a calendar reminder for ${fmtDay(rd)}">📅 Reminder ${fmtDay(rd)}</button>` : ''}
      </div>
      <textarea class="note${note ? ' has' : ''}" rows="1" placeholder="Add a note…" aria-label="Notes about ${esc(c.name)}">${esc(note)}</textarea>
      <div class="drafts">
        <textarea class="draft" aria-label="Draft message to ${esc(c.name)}">${esc(draft)}</textarea>
        <div class="draft-row">
          <button class="btn primary" data-act="copy">Copy message</button>
          ${e.draft ? '<button class="btn small" data-act="reset-draft">Reset to template</button>' : ''}
          <span class="copied" hidden>Copied — paste it into LinkedIn ✓</span>
        </div>
      </div>
    </div>
  </article>`;
}

let current = [];
function renderList(keep) {
  if (!keep) { shown = PAGE; kIndex = -1; }
  current = visible();
  const arr = current.slice(0, shown);
  $('count').textContent = `Showing ${current.length} of ${contacts.length}`;
  $('empty').hidden = current.length > 0;
  const more = $('more');
  more.hidden = current.length <= shown;
  more.textContent = `Show ${Math.min(PAGE, current.length - shown)} more · ${current.length - shown} left`;
  $('list').innerHTML = arr.map(cardHTML).join('');
  if (kIndex >= 0) markFocus(false);
}
function redrawCard(id) {
  const card = document.querySelector(`.contact[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const open = card.classList.contains('open'), focused = card.classList.contains('kfocus');
  card.outerHTML = cardHTML(byId[id]);
  const nc = document.querySelector(`.contact[data-id="${CSS.escape(id)}"]`);
  if (open) { nc.classList.add('open'); nc.querySelector('[data-act="toggle"]').textContent = 'Hide draft'; }
  if (focused) nc.classList.add('kfocus');
}
function renderBanner() {
  const b = $('banner');
  if (!storageWorks()) { b.innerHTML = '<div class="banner warn"><span>This browser is blocking local storage, so changes won\'t be kept after you close the page. Use <strong>Back up</strong> before leaving.</span></div>'; return; }
  if (meta && meta.demo) { b.innerHTML = '<div class="banner"><span>You\'re looking at <strong>sample data</strong> — fictional people.</span><button class="btn small primary" id="banner-import">Import your own export</button></div>'; return; }
  b.innerHTML = '';
}
function renderAll() {
  const has = contacts.length > 0;
  $('importer').hidden = has;
  $('app').hidden = !has;
  $('stats').hidden = !has;
  $('menu').hidden = !has;
  renderBanner();
  if (!has) return;
  $('lede').textContent = `${contacts.length.toLocaleString()} connections${meta && meta.withMessages ? `, ${meta.withMessages.toLocaleString()} with LinkedIn message history` : ''}. Rate each relationship, set a status, snooze, and take notes — everything saves in this browser.`;
  $('footer-meta').textContent = meta && meta.importedAt ? ` Last import: ${meta.importedAt}.` : '';
  renderStats(); renderTabs(); renderList();
}

// ---------------------------------------------------------------- actions
function setStars(c, n) { const e = ensure(c.id); e.stars = e.stars === n ? 0 : n; persist(c.id); }
function setStatus(c, v) {
  const e = ensure(c.id);
  if (/^snooze\d+$/.test(v)) {
    const cur = getStatus(c);
    const prev = cur === 'snoozed' ? e.prevStatus : cur;
    if (prev && prev !== 'none') e.prevStatus = prev; else delete e.prevStatus;
    e.status = 'snoozed';
    e.snoozeUntil = addDaysISO(today(), parseInt(v.slice(6), 10));
  } else if (v !== 'snoozed') {
    delete e.snoozeUntil; delete e.prevStatus;
    if (v === 'none') { delete e.status; delete e.sentAt; }
    else { e.status = v; if (v === 'sent' && !e.sentAt) e.sentAt = Date.now(); }
  }
  persist(c.id);
}
function toggleTag(c, tagId, on) {
  const t = settings.tags.find(x => x.id === tagId); if (!t) return;
  const e = ensure(c.id); e.tags = e.tags || {};
  if (on === autoTag(c, t)) delete e.tags[tagId]; else e.tags[tagId] = on;
  persist(c.id);
}
function afterChange(id) { redrawCard(id); renderStats(); renderTabs(); }

let toastTimer;
function toast(msg, ms = 3200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }
function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- list events
const list = $('list');
list.addEventListener('click', e => {
  const card = e.target.closest('.contact'); if (!card) return;
  const c = byId[card.dataset.id]; if (!c) return;
  kIndex = current.findIndex(x => x.id === c.id); markFocus(false);
  const star = e.target.closest('.star-btn');
  if (star) { setStars(c, +star.dataset.star); afterChange(c.id); return; }
  const act = e.target.closest('[data-act]'); if (!act) return;
  switch (act.dataset.act) {
    case 'toggle': card.classList.toggle('open'); act.textContent = card.classList.contains('open') ? 'Hide draft' : 'Draft message'; break;
    case 'tag-off': toggleTag(c, act.dataset.tag, false); afterChange(c.id); break;
    case 'role-seen': ensure(c.id).roleSeen = c.roleChanged.at; persist(c.id); afterChange(c.id); break;
    case 'reset-draft': delete ensure(c.id).draft; persist(c.id); redrawCard(c.id); break;
    case 'ics': {
      const date = reminderDate(c); if (!date) return;
      const st = getStatus(c);
      const ics = makeICS({ uid: `${c.id}-${date}`, date, title: `${st === 'sent' ? 'Follow up with' : 'Reconnect with'} ${c.name}`, description: [defaultRole(c), getNote(c)].filter(Boolean).join('\n'), url: c.url });
      download(`reconnect-${c.name.replace(/[^\w]+/g, '-').toLowerCase()}-${date}.ics`, ics, 'text/calendar');
      break;
    }
    case 'copy': {
      const ta = card.querySelector('.draft'), ok = card.querySelector('.copied');
      const done = () => { ok.hidden = false; setTimeout(() => (ok.hidden = true), 2500); };
      (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(done, () => { ta.select(); try { document.execCommand('copy'); done(); } catch (err) { /* user can copy manually */ } });
      break;
    }
    case 'edit-role': {
      if (card.querySelector('.role-input')) return;
      const span = card.querySelector('.c-role');
      const inp = document.createElement('input');
      inp.className = 'role-input'; inp.value = span.textContent; inp.setAttribute('aria-label', 'Current roles');
      span.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const commit = cancel => {
        if (done) return; done = true;
        const v = inp.value.trim(), en = ensure(c.id);
        if (!cancel) { if (v && v !== defaultRole(c)) en.roles = v; else delete en.roles; persist(c.id); }
        redrawCard(c.id);
      };
      inp.addEventListener('blur', () => commit(false));
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } if (ev.key === 'Escape') { commit(true); } });
      break;
    }
  }
});
list.addEventListener('change', e => {
  const card = e.target.closest('.contact'); if (!card) return;
  const c = byId[card.dataset.id];
  if (e.target.classList.contains('status-sel')) { setStatus(c, e.target.value); afterChange(c.id); }
  if (e.target.classList.contains('tag-add') && e.target.value) { toggleTag(c, e.target.value, true); afterChange(c.id); }
});
list.addEventListener('input', e => {
  const card = e.target.closest('.contact'); if (!card) return;
  const id = card.dataset.id;
  if (e.target.classList.contains('note')) { ensure(id).note = e.target.value.trim() ? e.target.value : ''; e.target.classList.toggle('has', !!e.target.value.trim()); persist(id); }
  if (e.target.classList.contains('draft')) { ensure(id).draft = e.target.value; persist(id); }
});
list.addEventListener('mouseover', e => {
  const b = e.target.closest('.star-btn'); if (!b) return;
  b.parentElement.querySelectorAll('.star-btn').forEach(x => x.classList.toggle('hover-fill', +x.dataset.star <= +b.dataset.star));
});
list.addEventListener('mouseout', e => {
  const b = e.target.closest('.star-btn'); if (!b) return;
  if (!b.parentElement.contains(e.relatedTarget)) b.parentElement.querySelectorAll('.star-btn').forEach(x => x.classList.remove('hover-fill'));
});

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  if (b.dataset.group === 'clear') { filters = { flags: [], status: [] }; }
  else {
    const key = b.dataset.group === 'status' ? 'status' : 'flags';
    const set = new Set(filters[key]);
    set.has(b.dataset.id) ? set.delete(b.dataset.id) : set.add(b.dataset.id);
    filters[key] = [...set];
  }
  saveFilters(); renderTabs(); renderList();
});
$('more').addEventListener('click', () => { shown += PAGE; renderList(true); });
$('search').addEventListener('input', e => { query = e.target.value; renderList(); });
$('sort').addEventListener('change', e => { sortBy = e.target.value; renderList(); });

// ---------------------------------------------------------------- keyboard triage
function markFocus(scroll = true) {
  document.querySelectorAll('.contact.kfocus').forEach(el => el.classList.remove('kfocus'));
  const c = current[kIndex]; if (!c) return;
  const el = document.querySelector(`.contact[data-id="${CSS.escape(c.id)}"]`);
  if (el) { el.classList.add('kfocus'); if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function move(delta) {
  if (!current.length) return;
  kIndex = Math.max(0, Math.min(current.length - 1, kIndex + delta));
  if (kIndex >= shown) { shown = Math.ceil((kIndex + 1) / PAGE) * PAGE; renderList(true); }
  markFocus();
}
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (!contacts.length) return;
  const k = e.key;
  if (k === '?') { e.preventDefault(); $('dlg-keys').showModal(); return; }
  if (k === '/') { e.preventDefault(); $('search').focus(); return; }
  if (k === 'j') { e.preventDefault(); move(1); return; }
  if (k === 'k') { e.preventDefault(); move(-1); return; }
  const c = current[kIndex]; if (!c) return;
  const card = document.querySelector(`.contact[data-id="${CSS.escape(c.id)}"]`);
  const statusKeys = { r: 'reach', e: 'sent', y: 'replied', m: 'meeting', x: 'skip', u: 'none', z: 'snooze7', Z: 'snooze30' };
  if (k.length === 1 && '0123'.includes(k)) { const e2 = ensure(c.id); e2.stars = +k; persist(c.id); afterChange(c.id); }
  else if (statusKeys[k]) { setStatus(c, statusKeys[k]); afterChange(c.id); }
  else if (k === 'n' && card) { e.preventDefault(); card.querySelector('.note').focus(); }
  else if (k === 'd' && card) { card.querySelector('[data-act="toggle"]').click(); }
  else if (k === 'o') { window.open(c.url, '_blank', 'noopener'); }
});
$('btn-keys').addEventListener('click', () => $('dlg-keys').showModal());

// ---------------------------------------------------------------- import
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jszip.min.js';  // vendored so the page makes no third-party requests
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Could not load the zip reader. Unzip the export and drop Connections.csv and messages.csv instead.'));
    document.head.appendChild(s);
  });
}
async function readFiles(fileList) {
  let connText = '', msgText = '';
  for (const f of fileList) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.zip')) {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(f);
      for (const path of Object.keys(zip.files)) {
        const base = path.split('/').pop().toLowerCase();
        if (base === 'connections.csv') connText = await zip.files[path].async('string');
        if (base === 'messages.csv') msgText = await zip.files[path].async('string');
      }
    } else if (name.endsWith('.csv')) {
      const text = await f.text();
      if (name.includes('connection') || /^\s*(notes:|first name)/im.test(text.slice(0, 2000))) connText = text;
      else if (name.includes('message') || /conversation id/i.test(text.slice(0, 500))) msgText = text;
    }
  }
  return { connText, msgText };
}
async function importTexts({ connText, msgText }, { demo = false } = {}) {
  if (!connText) throw new Error('Connections.csv is missing. Drop the whole export .zip, or Connections.csv (plus messages.csv if you have it).');
  const conns = parseConnections(connText);
  const msgs = msgText ? parseMessages(msgText) : [];
  const built = buildContacts(conns, msgs);
  const wasDemo = meta && meta.demo;
  if (wasDemo !== demo && (wasDemo || demo)) { contacts = []; progress = {}; meta = null; }
  const prev = contacts;
  const importedAt = today();
  const importId = new Date().toISOString();
  const { contacts: merged, aliases, stats } = mergeImport(prev, built, importId);
  for (const [from, to] of Object.entries(aliases)) if (progress[from]) { progress[to] = { ...progress[from], ...(progress[to] || {}) }; delete progress[from]; }
  contacts = merged;
  byId = BY_ID();
  meta = { importedAt, importId, importCount: (meta ? meta.importCount || 1 : 0) + 1, demo, total: merged.length, withMessages: merged.filter(c => c.msgs > 0).length, hadMessages: !!msgText };
  save('contacts', contacts); save('meta', meta); persist();
  filters = { flags: [], status: [] }; saveFilters();
  renderAll();
  const parts = [`${stats.total.toLocaleString()} connections`];
  if (meta.importCount > 1) parts.push(`${stats.added} new`, `${stats.roleChanges} role changes`, `${stats.removed} no longer connected`);
  if (!msgText) parts.push('no messages file, so message history is empty');
  toast(`Imported ${parts.join(' · ')}`, 5200);
}
async function handleFiles(files) {
  if (!files || !files.length) return;
  try { await importTexts(await readFiles(files)); }
  catch (err) { toast(err.message || String(err), 6000); }
}
const drop = $('drop');
document.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer ? [...e.dataTransfer.files] : []); });
$('btn-choose').addEventListener('click', () => $('file-import').click());
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; handleFiles(files); });
document.addEventListener('click', e => { if (e.target.id === 'banner-import') $('file-import').click(); });
$('btn-demo').addEventListener('click', async () => {
  try {
    const [connText, msgText] = await Promise.all(['sample/Connections.csv', 'sample/messages.csv'].map(p => fetch(p).then(r => { if (!r.ok) throw new Error(); return r.text(); })));
    await importTexts({ connText, msgText }, { demo: true });
  } catch (err) { toast('Could not load the sample files. If you opened index.html directly, serve the folder instead (see README).', 6000); }
});

// ---------------------------------------------------------------- backup / restore / export
$('btn-backup').addEventListener('click', () => {
  const data = { app: 'reconnect-hq', version: 1, exportedAt: new Date().toISOString(), meta, contacts, progress, settings };
  download(`reconnect-hq-backup-${today()}.json`, JSON.stringify(data), 'application/json');
  toast('Backup downloaded — keep it somewhere private; it contains your contacts and notes.');
});
$('btn-restore').addEventListener('click', () => $('file-restore').click());
$('file-restore').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'reconnect-hq' || !Array.isArray(data.contacts)) throw new Error('That file isn\'t a Reconnect HQ backup.');
    if (contacts.length && !confirm('Replace everything in this browser with the backup?')) return;
    contacts = data.contacts; progress = data.progress || {}; meta = data.meta || null;
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    byId = BY_ID();
    save('contacts', contacts); save('meta', meta); save('settings', settings); persist();
    renderAll(); toast('Backup restored.');
  } catch (err) { toast(err.message || 'Could not read that file.', 5000); }
});
$('btn-export').addEventListener('click', () => {
  const rows = [['Name', 'Company', 'Position', 'LinkedIn URL', 'Status', 'Stars', 'Tags', 'Note', 'Sent on', 'Snoozed until', 'Last LinkedIn message', 'Messages', 'Connected on']];
  for (const c of contacts) {
    const e = entry(c);
    rows.push([c.name, c.company, c.position, c.url, getStatus(c) === 'none' ? '' : getStatus(c), e.stars || '', settings.tags.filter(t => hasTag(c, t)).map(t => t.label).join('; '), e.note || '', e.sentAt ? isoDay(new Date(e.sentAt)) : '', e.status === 'snoozed' ? e.snoozeUntil : '', c.lastDate, c.msgs, c.connected]);
  }
  download(`reconnect-hq-${today()}.csv`, toCSV(rows), 'text/csv');
});

// ---------------------------------------------------------------- settings
let draftTags = [];
function tagRowHTML(t, i) {
  const colors = Object.keys(TAG_COLORS).map(k => `<option value="${k}" ${t.color === k ? 'selected' : ''}>${k}</option>`).join('');
  return `<div class="tagrow" data-i="${i}">
    <input type="text" class="t-label" value="${esc(t.label)}" placeholder="Tag name" aria-label="Tag name">
    <select class="t-color" aria-label="Tag color">${colors}</select>
    <input type="text" class="t-kw" value="${esc(t.keywords || '')}" placeholder="${t.auto === 'product' ? 'Auto: product titles (+ your keywords)' : 'Auto-tag keywords, e.g. engineer, CTO'}" aria-label="Auto-tag keywords">
    <button type="button" class="btn small" data-rm="${i}" aria-label="Remove tag">✕</button></div>`;
}
function renderTagRows() { $('tag-rows').innerHTML = draftTags.map(tagRowHTML).join(''); }
function readTagRows() {
  document.querySelectorAll('#tag-rows .tagrow').forEach(row => {
    const t = draftTags[+row.dataset.i];
    t.label = row.querySelector('.t-label').value.trim();
    t.color = row.querySelector('.t-color').value;
    t.keywords = row.querySelector('.t-kw').value.trim();
  });
}
$('btn-settings').addEventListener('click', () => {
  $('set-goal').value = settings.weeklyGoal;
  $('set-follow').value = settings.followUpDays;
  $('set-tpl-history').value = settings.templates.history;
  $('set-tpl-fresh').value = settings.templates.fresh;
  draftTags = settings.tags.map(t => ({ ...t }));
  renderTagRows();
  $('dlg-settings').showModal();
});
$('btn-add-tag').addEventListener('click', () => { readTagRows(); draftTags.push({ id: 't' + Date.now().toString(36), label: '', color: 'coral', keywords: '' }); renderTagRows(); });
$('tag-rows').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; readTagRows(); draftTags.splice(+b.dataset.rm, 1); renderTagRows(); });
$('btn-settings-cancel').addEventListener('click', () => $('dlg-settings').close());
$('settings-form').addEventListener('submit', () => {
  readTagRows();
  settings = {
    weeklyGoal: Math.max(1, parseInt($('set-goal').value, 10) || 3),
    followUpDays: Math.max(1, parseInt($('set-follow').value, 10) || 7),
    templates: { history: $('set-tpl-history').value, fresh: $('set-tpl-fresh').value },
    tags: draftTags.filter(t => t.label),
  };
  save('settings', settings);
  renderAll();
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm('Delete all connections, ratings, statuses, notes and settings stored in this browser? Download a backup first if you want to keep them.')) return;
  clearAll();
  contacts = []; progress = {}; meta = null; settings = loadSettings(); filters = { flags: [], status: [] }; byId = {};
  $('dlg-settings').close();
  renderAll();
});

renderAll();
