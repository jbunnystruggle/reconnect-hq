// Everything is stored in this browser's localStorage. Nothing is sent to a server.

const PREFIX = 'rhq.';

export const DEFAULT_SETTINGS = {
  weeklyGoal: 3,
  followUpDays: 7,
  templates: {
    history: "Hi {first} — it's been a while since we last talked and you came to mind. What are you focused on at {company} these days? I'd love to catch up.",
    fresh: "Hi {first} — we're connected here but haven't really talked yet. I've been following your work at {company} and would love to hear what you're focused on. Open to a quick chat?",
  },
  tags: [
    { id: 'product', label: 'Product', color: 'teal', auto: 'product', keywords: '' },
  ],
};

export const TAG_COLORS = {
  teal: 'var(--teal)',
  coral: 'var(--coral)',
  gold: 'var(--seg-warm)',
  plum: 'var(--seg-stale)',
  olive: 'var(--good)',
  slate: 'var(--seg-dormant)',
};

let storageOk = true;
export const storageWorks = () => storageOk;

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    storageOk = false;
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    storageOk = true;
    return true;
  } catch (e) {
    storageOk = false;
    return false;
  }
}

export function clearAll() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export function loadSettings() {
  const s = load('settings', {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    templates: { ...DEFAULT_SETTINGS.templates, ...(s.templates || {}) },
    tags: Array.isArray(s.tags) ? s.tags : DEFAULT_SETTINGS.tags,
  };
}
