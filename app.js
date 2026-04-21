// ── Config ────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  destacadas:    'Destacadas',
  todas:         'Todas',
  guardadas:     'Guardadas',
  internacional: 'Internacional',
  economia:      'Economía',
  iglesia:       'Iglesia',
  tecnologia:    'Tecnología',
  deportes:      'Deportes',
  belico:        'Bélico',
  uruguay:       'Uruguay',
};

const CATEGORY_EMOJIS = {
  destacadas:    '⭐',
  todas:         '🌐',
  guardadas:     '🔖',
  internacional: '🌍',
  economia:      '💰',
  iglesia:       '✝️',
  tecnologia:    '🤖',
  deportes:      '⚽',
  belico:        '⚔️',
  uruguay:       '🇺🇾',
};

const THEMES = ['auto', 'light', 'dark', 'sepia'];
const THEME_ICONS = { auto: '☼', light: '☀', dark: '☾', sepia: '☕' };
const THEME_LABELS = { auto: 'automático', light: 'claro', dark: 'oscuro', sepia: 'sepia' };
const THEME_COLORS = { light: '#0f172a', dark: '#000814', sepia: '#3d2b1f' };

const STALE_MS = 6 * 60 * 60 * 1000;
const READ_CAP = 500;

// ── State ─────────────────────────────────────────────────────
let allArticles = [];
let currentCat = 'destacadas';
let previousCat = 'destacadas';
let lastVisit = new Date(parseInt(localStorage.getItem('lastVisitAt') || '0', 10));
let readUrls = new Set(JSON.parse(localStorage.getItem('readUrls') || '[]'));
let savedArticles = JSON.parse(localStorage.getItem('savedArticles') || '[]');
let hideRead = localStorage.getItem('hideRead') === '1';
let currentTheme = localStorage.getItem('theme') || 'auto';
let paletteItems = [];
let paletteSelected = 0;

// ── Helpers ───────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'hace un momento';
  if (diff < 3600)  return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

function formatDate(d) {
  return d.toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function escHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Reject non-http(s) URLs to avoid javascript:/data:/vbscript: XSS vectors
function isSafeUrl(u) {
  if (!u) return false;
  try {
    const p = new URL(u, location.href).protocol;
    return p === 'http:' || p === 'https:';
  } catch (_) {
    return false;
  }
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function findArticleByUrl(url) {
  return allArticles.find(a => a.url === url) || savedArticles.find(a => a.url === url);
}

// ── Theme ─────────────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('theme', theme);

  // Effective theme for meta theme-color
  const effective = theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[effective] || THEME_COLORS.light;

  // Update button icon and label
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.querySelector('span').textContent = THEME_ICONS[theme];
    btn.title = `Tema: ${THEME_LABELS[theme]}`;
  }
}

function cycleTheme() {
  const idx = THEMES.indexOf(currentTheme);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
  showToast(`Tema: ${THEME_LABELS[next]}`);
}

// ── Read / Saved ──────────────────────────────────────────────
function markRead(url) {
  if (!url || readUrls.has(url)) return;
  readUrls.add(url);
  if (readUrls.size > READ_CAP) {
    const arr = Array.from(readUrls);
    readUrls = new Set(arr.slice(-READ_CAP));
  }
  localStorage.setItem('readUrls', JSON.stringify(Array.from(readUrls)));
}

function isSaved(url) {
  return savedArticles.some(a => a.url === url);
}

function toggleSaved(article) {
  const idx = savedArticles.findIndex(a => a.url === article.url);
  const wasSaved = idx >= 0;
  if (wasSaved) {
    savedArticles.splice(idx, 1);
  } else {
    savedArticles.unshift({ ...article, savedAt: new Date().toISOString() });
  }
  localStorage.setItem('savedArticles', JSON.stringify(savedArticles));
  return !wasSaved;
}

function toggleHideRead() {
  hideRead = !hideRead;
  localStorage.setItem('hideRead', hideRead ? '1' : '0');
  const btn = document.getElementById('btn-hide-read');
  btn.classList.toggle('active', hideRead);
  btn.setAttribute('aria-pressed', hideRead ? 'true' : 'false');
  showToast(hideRead ? 'Ocultando leídas' : 'Mostrando todas');
  applyFilter(currentCat);
}

// ── Render ────────────────────────────────────────────────────
function renderSkeletons() {
  const grid = document.getElementById('grid');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="card">
      <div class="skeleton sk-image"></div>
      <div class="card-body">
        <div class="card-meta">
          <div class="skeleton sk-badge"></div>
        </div>
        <div class="skeleton sk-title"></div>
        <div class="skeleton sk-title2"></div>
        <div class="sk-lines">
          <div class="skeleton sk-line"></div>
          <div class="skeleton sk-line2"></div>
          <div class="skeleton sk-line3"></div>
        </div>
      </div>
    </div>
  `).join('');
}

function cardHTML(a, idx) {
  const isRead = readUrls.has(a.url);
  const isNew = a.published && new Date(a.published) > lastVisit;
  const saved = isSaved(a.url);

  const imgHtml = (a.image && isSafeUrl(a.image))
    ? `<img class="card-image" src="${escHtml(a.image)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  const newBadge = isNew ? `<span class="badge-new" aria-label="Nueva">NUEVO</span>` : '';

  return `
    <a class="card ${isRead ? 'read' : ''}"
       role="article"
       href="${escHtml(a.url)}"
       target="_blank" rel="noopener"
       data-url="${escHtml(a.url)}"
       style="--i:${idx}">
      ${imgHtml}
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-${escHtml(a.category)}">${escHtml(CATEGORY_LABELS[a.category] || a.category)}</span>
          ${newBadge}
          <span class="card-source">${escHtml(a.source)}</span>
          <span class="card-time" data-published="${escHtml(a.published || '')}">${timeAgo(a.published)}</span>
        </div>
        <h3 class="card-title">${escHtml(a.title)}</h3>
        ${a.summary ? `<p class="card-summary">${escHtml(a.summary)}</p>` : ''}
        <div class="card-actions">
          <span class="card-link" aria-hidden="true">Leer artículo →</span>
          <button class="card-action ${saved ? 'saved' : ''}"
                  data-action="save"
                  aria-label="${saved ? 'Quitar de guardadas' : 'Guardar para después'}"
                  aria-pressed="${saved ? 'true' : 'false'}">${saved ? '★' : '☆'}</button>
          <button class="card-action"
                  data-action="share"
                  aria-label="Compartir">⇪</button>
        </div>
      </div>
    </a>
  `;
}

// Group into day buckets (returns array of [label, items])
function groupByDay(articles) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const buckets = { hoy: [], ayer: [], semana: [], antes: [] };
  for (const a of articles) {
    const t = a.published ? new Date(a.published).getTime() : 0;
    if (t >= today) buckets.hoy.push(a);
    else if (t >= yesterday) buckets.ayer.push(a);
    else if (t >= weekAgo) buckets.semana.push(a);
    else buckets.antes.push(a);
  }
  return [
    ['Hoy', buckets.hoy],
    ['Ayer', buckets.ayer],
    ['Esta semana', buckets.semana],
    ['Anteriores', buckets.antes],
  ];
}

function renderGrouped(articles) {
  const grid = document.getElementById('grid');
  let html = '';
  let i = 0;
  for (const [name, list] of groupByDay(articles)) {
    if (!list.length) continue;
    html += `<div class="day-separator">${escHtml(name)}</div>`;
    html += list.map(a => cardHTML(a, i++)).join('');
  }
  grid.innerHTML = html;
}

function renderFlat(articles) {
  const grid = document.getElementById('grid');
  grid.innerHTML = articles.map((a, i) => cardHTML(a, i)).join('');
}

function renderEmpty(title, text) {
  const grid = document.getElementById('grid');
  grid.innerHTML = `<div class="message"><h2>${escHtml(title)}</h2><p>${escHtml(text)}</p></div>`;
}

// ── Filter + dispatch render ──────────────────────────────────
function applyFilter(cat) {
  const changed = cat !== currentCat;
  currentCat = cat;

  // Reset scroll when switching filters so the new category starts from top
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' });

  // Update tab states
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.cat === cat;
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // Saved header button reflects active state
  const savedBtn = document.getElementById('btn-saved');
  if (savedBtn) savedBtn.classList.toggle('active', cat === 'guardadas');

  const label = document.getElementById('section-label');

  // Special: saved
  if (cat === 'guardadas') {
    const list = hideRead ? savedArticles.filter(a => !readUrls.has(a.url)) : savedArticles;
    if (!list.length) {
      renderEmpty('Sin guardadas', 'Marca el ☆ en cualquier noticia para guardarla y leerla después.');
      label.textContent = 'Tus guardadas';
      return;
    }
    label.textContent = `${list.length} guardada${list.length !== 1 ? 's' : ''}`;
    renderFlat(list);
    return;
  }

  // Build filtered
  let filtered;
  if (cat === 'todas') {
    filtered = allArticles.slice();
  } else if (cat === 'destacadas') {
    // One per category, most recent first
    const seen = new Set();
    filtered = [];
    const sorted = allArticles.slice().sort((a, b) => new Date(b.published) - new Date(a.published));
    for (const a of sorted) {
      if (!seen.has(a.category)) {
        seen.add(a.category);
        filtered.push(a);
      }
    }
  } else {
    filtered = allArticles.filter(a => a.category === cat);
  }

  if (hideRead) filtered = filtered.filter(a => !readUrls.has(a.url));

  if (!filtered.length) {
    renderEmpty('Sin noticias por ahora', hideRead ? 'Probá desactivar "ocultar leídas".' : 'Intentá actualizar en un momento.');
    label.textContent = '0 artículos';
    return;
  }

  if (cat === 'destacadas') {
    label.textContent = `Portada — ${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}`;
    renderFlat(filtered);
  } else if (cat === 'todas') {
    label.textContent = `${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}`;
    renderGrouped(filtered);
  } else {
    label.textContent = `${CATEGORY_LABELS[cat] || cat} — ${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}`;
    renderGrouped(filtered);
  }
}

// ── Load ──────────────────────────────────────────────────────
async function loadNews(manual = false) {
  const refreshBtn = document.getElementById('btn-refresh');
  if (manual) refreshBtn.classList.add('spinning');
  if (!manual) renderSkeletons();

  try {
    const res = await fetch(`news.json?_=${Date.now()}`);
    if (res.status === 404) {
      renderEmpty(
        'Generando noticias por primera vez',
        'GitHub Actions está procesando los feeds RSS. Recargá en unos segundos.'
      );
      document.getElementById('section-label').textContent = 'Primera carga';
      if (manual) showToast('Aún no hay datos disponibles');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Reject entries with non-http(s) URLs (defense against malicious feeds)
    allArticles = (data.articles || []).filter(a => isSafeUrl(a.url));

    // "Actualizado" shows when we last fetched (user-facing freshness),
    // not when the backend generated the JSON — so clicking refresh resets it.
    const updEl = document.getElementById('last-update');
    const fetchedAt = new Date().toISOString();
    updEl.textContent = `Actualizado ${timeAgo(fetchedAt)}`;
    updEl.dataset.updated = fetchedAt;
    if (data.updated_at) {
      const backendUpd = new Date(data.updated_at);
      const stale = Date.now() - backendUpd.getTime() > STALE_MS;
      updEl.classList.toggle('stale', stale);
      updEl.title = stale
        ? `Datos generados ${timeAgo(data.updated_at)}. Pueden estar desactualizados.`
        : `Datos generados ${timeAgo(data.updated_at)}`;
    } else {
      updEl.classList.remove('stale');
      updEl.title = '';
    }

    // Compute "new" count relative to lastVisit BEFORE we reset it
    const newCount = allArticles.filter(a => a.published && new Date(a.published) > lastVisit).length;
    const newCountEl = document.getElementById('new-count');
    newCountEl.textContent = newCount > 0 ? `${newCount} nuevas` : '';

    applyFilter(currentCat);

    // Persist visit AFTER render so the badges appear this session
    localStorage.setItem('lastVisitAt', Date.now().toString());

    if (manual) showToast('Actualizado');
  } catch (err) {
    renderEmpty('No se pudieron cargar las noticias', 'Verificá tu conexión e intentá de nuevo.');
    document.getElementById('section-label').textContent = 'Error al cargar';
    if (manual) showToast('Error al actualizar');
  } finally {
    if (manual) setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
  }
}

// ── Auto-refresh timestamps ───────────────────────────────────
function refreshTimestamps() {
  document.querySelectorAll('.card-time[data-published]').forEach(el => {
    if (el.dataset.published) el.textContent = timeAgo(el.dataset.published);
  });
  const updEl = document.getElementById('last-update');
  const ts = updEl.dataset.updated;
  if (ts) updEl.textContent = `Actualizado ${timeAgo(ts)}`;
}

// ── Share ─────────────────────────────────────────────────────
let openShareMenu = null;
function closeShareMenu() {
  if (openShareMenu) { openShareMenu.remove(); openShareMenu = null; }
}

async function shareArticle(article, buttonEl) {
  const shareData = {
    title: article.title,
    url: article.url,
    text: article.summary || article.title,
  };

  if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (_) { /* user cancelled */ return; }
  }

  // Fallback menu
  closeShareMenu();
  const menu = document.createElement('div');
  menu.className = 'share-menu';
  menu.setAttribute('role', 'menu');
  const url = encodeURIComponent(article.url);
  const title = encodeURIComponent(article.title);
  menu.innerHTML = `
    <a class="share-menu-item" role="menuitem" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${title}&url=${url}"><span class="icon" aria-hidden="true">𝕏</span> X / Twitter</a>
    <button class="share-menu-item" role="menuitem" data-share="copy"><span class="icon" aria-hidden="true">📋</span> Copiar enlace</button>
  `;
  buttonEl.parentElement.appendChild(menu);
  openShareMenu = menu;

  menu.querySelector('[data-share="copy"]').addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await navigator.clipboard.writeText(article.url);
      showToast('Enlace copiado');
    } catch (_) { showToast('No se pudo copiar'); }
    closeShareMenu();
  });
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', ev => ev.stopPropagation());
  });

  setTimeout(() => {
    document.addEventListener('click', function off(ev) {
      if (!menu.contains(ev.target)) { closeShareMenu(); document.removeEventListener('click', off); }
    }, { once: false });
  }, 0);
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Command palette ───────────────────────────────────────────
const paletteBackdrop = document.getElementById('palette-backdrop');
const paletteInput = document.getElementById('palette-input');
const paletteResults = document.getElementById('palette-results');

function openPalette() {
  paletteBackdrop.classList.add('open');
  paletteInput.value = '';
  paletteSelected = 0;
  renderPalette('');
  setTimeout(() => paletteInput.focus(), 30);
}

function closePalette() {
  paletteBackdrop.classList.remove('open');
  paletteInput.value = '';
}

function searchArticles(query) {
  const q = normalize(query);
  if (!q) return [];
  return allArticles
    .filter(a => {
      const hay = normalize(`${a.title} ${a.summary || ''} ${a.source}`);
      return hay.includes(q);
    })
    .slice(0, 30)
    .map(a => ({
      emoji: CATEGORY_EMOJIS[a.category] || '📰',
      title: a.title,
      sub: `${a.source} · ${timeAgo(a.published)}`,
      article: a,
      run: () => {
        markRead(a.url);
        window.open(a.url, '_blank', 'noopener');
        closePalette();
      },
    }));
}

function renderPalette(query) {
  if (!query.trim()) {
    paletteItems = [];
    const total = allArticles.length;
    paletteResults.innerHTML = `<div class="palette-empty">Empezá a escribir para buscar en ${total} noticia${total !== 1 ? 's' : ''}</div>`;
    return;
  }

  paletteItems = searchArticles(query);

  if (!paletteItems.length) {
    paletteResults.innerHTML = `<div class="palette-empty">Sin resultados para "<strong>${escHtml(query)}</strong>"</div>`;
    return;
  }

  const n = paletteItems.length;
  paletteResults.innerHTML = `<li class="palette-section">${n} resultado${n !== 1 ? 's' : ''}</li>` +
    paletteItems.map((it, i) => `
      <li class="palette-item ${i === paletteSelected ? 'selected' : ''}"
          role="option"
          aria-selected="${i === paletteSelected ? 'true' : 'false'}"
          data-idx="${i}">
        <span class="palette-item-emoji" aria-hidden="true">${escHtml(it.emoji)}</span>
        <div class="palette-item-content">
          <div class="palette-item-title">${escHtml(it.title)}</div>
          <div class="palette-item-sub">${escHtml(it.sub)}</div>
        </div>
      </li>
    `).join('');
}

function movePaletteSelection(delta) {
  if (!paletteItems.length) return;
  paletteSelected = (paletteSelected + delta + paletteItems.length) % paletteItems.length;
  paletteResults.querySelectorAll('.palette-item').forEach((el, i) => {
    el.classList.toggle('selected', i === paletteSelected);
    el.setAttribute('aria-selected', i === paletteSelected ? 'true' : 'false');
    if (i === paletteSelected) el.scrollIntoView({ block: 'nearest' });
  });
}

function executePaletteItem() {
  const it = paletteItems[paletteSelected];
  if (!it) return;
  it.run();
}

// Palette events
paletteInput.addEventListener('input', () => {
  paletteSelected = 0;
  renderPalette(paletteInput.value);
});
paletteInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePaletteSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePaletteSelection(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); executePaletteItem(); }
});
paletteBackdrop.addEventListener('click', e => {
  if (e.target === paletteBackdrop) closePalette();
});
paletteResults.addEventListener('click', e => {
  const item = e.target.closest('.palette-item');
  if (!item) return;
  paletteSelected = parseInt(item.dataset.idx, 10);
  executePaletteItem();
});

// Global shortcuts
document.addEventListener('keydown', e => {
  const isK = e.key.toLowerCase() === 'k';
  if ((e.ctrlKey || e.metaKey) && isK) {
    e.preventDefault();
    paletteBackdrop.classList.contains('open') ? closePalette() : openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if (paletteBackdrop.classList.contains('open')) closePalette();
    closeShareMenu();
  }
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    openPalette();
  }
});

// ── Card click handling ───────────────────────────────────────
document.getElementById('grid').addEventListener('click', e => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    e.preventDefault();
    e.stopPropagation();
    const card = actionBtn.closest('[data-url]');
    const url = card?.dataset.url;
    const article = findArticleByUrl(url);
    if (!article) return;

    if (actionBtn.dataset.action === 'save') {
      const saved = toggleSaved(article);
      actionBtn.classList.toggle('saved', saved);
      actionBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      actionBtn.textContent = saved ? '★' : '☆';
      actionBtn.setAttribute('aria-label', saved ? 'Quitar de guardadas' : 'Guardar para después');
      showToast(saved ? 'Guardada' : 'Quitada de guardadas');
      if (currentCat === 'guardadas' && !saved) applyFilter(currentCat);
    } else if (actionBtn.dataset.action === 'share') {
      shareArticle(article, actionBtn);
    }
    return;
  }

  const card = e.target.closest('.card[data-url]');
  if (card && !readUrls.has(card.dataset.url)) {
    markRead(card.dataset.url);
    card.classList.add('read');
  }
});

// ── Init ──────────────────────────────────────────────────────
document.getElementById('today-date').textContent = formatDate(new Date());

applyTheme(currentTheme);

{
  const btn = document.getElementById('btn-hide-read');
  btn.classList.toggle('active', hideRead);
  btn.setAttribute('aria-pressed', hideRead ? 'true' : 'false');
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => applyFilter(btn.dataset.cat));
});

document.getElementById('btn-search').addEventListener('click', openPalette);
document.getElementById('btn-saved').addEventListener('click', () => {
  if (currentCat === 'guardadas') {
    applyFilter(previousCat);
  } else {
    previousCat = currentCat;
    applyFilter('guardadas');
  }
});
document.getElementById('btn-theme').addEventListener('click', cycleTheme);
document.getElementById('btn-hide-read').addEventListener('click', toggleHideRead);
document.getElementById('btn-refresh').addEventListener('click', () => loadNews(true));

// ── Scroll progress indicator ─────────────────────────────────
{
  const bar = document.getElementById('scroll-progress');
  function updateScrollProgress() {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const pct = max > 4 ? Math.min(100, (h.scrollTop / max) * 100) : 0;
    bar.style.width = pct + '%';
  }
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress);
  updateScrollProgress();
}

// ── Tabs horizontal scroll arrows ─────────────────────────────
{
  const wrap = document.querySelector('.tabs-wrapper');
  const leftBtn = document.querySelector('.tab-scroll-left');
  const rightBtn = document.querySelector('.tab-scroll-right');

  function updateTabArrows() {
    const maxScroll = wrap.scrollWidth - wrap.clientWidth;
    leftBtn.hidden = wrap.scrollLeft <= 2;
    rightBtn.hidden = wrap.scrollLeft >= maxScroll - 2;
  }

  leftBtn.addEventListener('click', () => wrap.scrollBy({ left: -200, behavior: 'smooth' }));
  rightBtn.addEventListener('click', () => wrap.scrollBy({ left: 200, behavior: 'smooth' }));
  wrap.addEventListener('scroll', updateTabArrows, { passive: true });
  window.addEventListener('resize', updateTabArrows);

  // Initial state — after layout settles (fonts may still be loading)
  updateTabArrows();
  setTimeout(updateTabArrows, 250);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateTabArrows);
}

if (matchMedia('(prefers-color-scheme: dark)').addEventListener) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'auto') applyTheme('auto');
  });
}

loadNews();

setInterval(refreshTimestamps, 60000);

// ── PWA Service Worker ────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
