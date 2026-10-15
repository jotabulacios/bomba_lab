// App chrome shared with Turbofan Lab: theme, help dialog, tabs, resizable panels and
// keyboard shortcuts. main.js passes the actions that touch the simulation.

const $ = (id) => document.getElementById(id);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: ignore */ } },
};

/** Current value of a CSS custom property (theme token). */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * @param {{onTheme:Function, onResize:Function, onTab:Function,
 *          shortcuts: Record<string, Function>}} cb  shortcuts: lower-case key → action
 */
export function setupChrome(cb) {
  const themeIcon = () => {
    $('themeBtn').querySelector('use').setAttribute('href', isDark() ? '#i-sun' : '#i-moon');
  };
  const toggleTheme = () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('bl-theme', next);
    themeIcon();
    cb.onTheme();
  };
  $('themeBtn').addEventListener('click', toggleTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeIcon(); cb.onTheme(); });
  themeIcon();

  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());

  const setTab = (name) => {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
    cb.onTab(name);
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  for (const side of ['left', 'right']) {
    const saved = Number(store.get(`bl-${side}-w`));
    if (saved) document.documentElement.style.setProperty(`--${side}-w`, `${saved}px`);
  }
  document.querySelectorAll('.resizer').forEach((r) => {
    const side = r.dataset.resize;
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      r.classList.add('dragging');
      const panel = r.parentElement;
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const w = Math.round(Math.min(Math.max(side === 'left' ? startW + dx : startW - dx, 220), 760));
        document.documentElement.style.setProperty(`--${side}-w`, `${w}px`);
        cb.onResize();
      };
      const up = () => {
        r.classList.remove('dragging');
        r.removeEventListener('pointermove', move);
        r.removeEventListener('pointerup', up);
        store.set(`bl-${side}-w`, String(Math.round(panel.getBoundingClientRect().width)));
      };
      r.addEventListener('pointermove', move);
      r.addEventListener('pointerup', up);
    });
  });

  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof Element && e.target.closest('input, select, textarea, dialog');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') toggleTheme();
    else if (k === '?' || (k === '/' && e.shiftKey)) $('helpDialog').showModal();
    else if (cb.shortcuts[k]) cb.shortcuts[k]();
    else return;
    e.preventDefault();
  });

  return { setTab };
}
