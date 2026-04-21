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
const SAVED_CAP = 200;
const WATCHLIST_CAP = 50;

// GitHub repo reference for "suggest source" issue pre-fill
const REPO_OWNER = 'juanmopeirano';
const REPO_NAME = 'juanmo-times';
const SUGGEST_URL =
  `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new` +
  `?title=${encodeURIComponent('[Fuente] ')}` +
  `&labels=nueva-fuente` +
  `&template=nueva-fuente.md`;

// ── State ─────────────────────────────────────────────────────
let allArticles = [];
let currentCat = 'destacadas';
let previousCat = 'destacadas';
let sourceFilter = null; // active secondary filter (source name) or null
let watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
let normalizedWatchlist = []; // populated after isSafeUrl+normalize are defined

// Spanish stopwords for trending tokenization (mirrors fetch_news.py STOPWORDS)
const STOPWORDS_ES = new Set([
  'el','la','los','las','de','del','y','en','a','un','una','por','para',
  'con','que','se','su','sus','al','lo','como','o','es','son','fue','ha',
  'han','mas','pero','no','si','sin','ser','ya','hay','sobre','entre',
  'cuando','donde','este','esta','estos','estas','ese','esa','eso',
  'tras','muy','todo','toda','todos','todas','tambien','porque','desde',
  'solo','tiene','estan','esta','para','mas','años','ano'
]);
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

// Clean persisted saved articles — attacker/devtools could have seeded unsafe URLs
savedArticles = savedArticles.filter(a => a && a.url && isSafeUrl(a.url));
if (savedArticles.length > SAVED_CAP) savedArticles.length = SAVED_CAP;

// Precompute normalized watchlist for fast card-matching
normalizedWatchlist = watchlist.map(kw => normalize(kw)).filter(Boolean);

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
    if (savedArticles.length > SAVED_CAP) savedArticles.length = SAVED_CAP;
  }
  try { localStorage.setItem('savedArticles', JSON.stringify(savedArticles)); }
  catch (_) { showToast('Almacenamiento lleno'); }
  return !wasSaved;
}

function toggleHideRead() {
  hideRead = !hideRead;
  localStorage.setItem('hideRead', hideRead ? '1' : '0');
  // Reflect state on the overflow menu item (may not be visible when toggled)
  const item = document.querySelector('[data-action="hide-read"]');
  if (item) item.setAttribute('aria-pressed', hideRead ? 'true' : 'false');
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

function readTime(a) {
  const words = `${a.title || ''} ${a.summary || ''}`.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Return list of watchlist keywords that appear in this article.
// Uses precomputed `normalizedWatchlist` to avoid re-normalizing per render.
function matchedKeywords(a) {
  if (!normalizedWatchlist.length) return [];
  const hay = normalize(`${a.title || ''} ${a.summary || ''}`);
  const matches = [];
  for (let i = 0; i < normalizedWatchlist.length; i++) {
    if (hay.includes(normalizedWatchlist[i])) matches.push(watchlist[i]);
  }
  return matches;
}

// Tokenize text for trending/related (drops stopwords, short tokens, non-alphanumeric)
function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS_ES.has(w) && /^[a-z0-9]+$/.test(w));
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

function cardHTML(a, idx) {
  const isRead = readUrls.has(a.url);
  const isNew = a.published && new Date(a.published) > lastVisit;
  const saved = isSaved(a.url);

  const imgHtml = (a.image && isSafeUrl(a.image))
    ? `<img class="card-image" src="${escHtml(a.image)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  const newBadge = isNew ? `<span class="badge-new" aria-label="Nueva">NUEVO</span>` : '';
  const kwBadges = matchedKeywords(a)
    .map(kw => `<span class="badge-kw" title="Coincidencia con palabra clave">⚡ ${escHtml(kw)}</span>`)
    .join('');
  const mins = readTime(a);

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
          ${kwBadges}
          <button class="card-source" data-source="${escHtml(a.source)}" aria-label="Filtrar por ${escHtml(a.source)}">${escHtml(a.source)}</button>
          <span class="card-time" data-published="${escHtml(a.published || '')}" data-readtime="${mins}">${timeAgo(a.published)} · ${mins} min</span>
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
                  data-action="related"
                  aria-label="Ver noticias relacionadas">🔗</button>
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
function renderFilterChips() {
  const container = document.getElementById('filter-chips');
  if (!sourceFilter) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <button class="source-chip" aria-label="Quitar filtro por ${escHtml(sourceFilter)}">
      <span class="label">${escHtml(sourceFilter)}</span>
      <span class="close" aria-hidden="true">×</span>
    </button>
  `;
}

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
  const sourceSuffix = sourceFilter ? ` · ${sourceFilter}` : '';

  // Special: saved
  if (cat === 'guardadas') {
    let list = hideRead ? savedArticles.filter(a => !readUrls.has(a.url)) : savedArticles;
    if (sourceFilter) list = list.filter(a => a.source === sourceFilter);
    if (!list.length) {
      renderEmpty('Sin guardadas', 'Marca el ☆ en cualquier noticia para guardarla y leerla después.');
      label.textContent = 'Tus guardadas' + sourceSuffix;
      renderFilterChips();
      return;
    }
    label.textContent = `${list.length} guardada${list.length !== 1 ? 's' : ''}` + sourceSuffix;
    renderFlat(list);
    renderFilterChips();
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
  if (sourceFilter) filtered = filtered.filter(a => a.source === sourceFilter);

  if (!filtered.length) {
    const emptyText = sourceFilter
      ? `No hay artículos de ${sourceFilter} en esta categoría.`
      : hideRead ? 'Probá desactivar "ocultar leídas".' : 'Intentá actualizar en un momento.';
    renderEmpty('Sin noticias por ahora', emptyText);
    label.textContent = '0 artículos' + sourceSuffix;
    renderFilterChips();
    return;
  }

  if (cat === 'destacadas') {
    label.textContent = `Portada — ${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}` + sourceSuffix;
    renderFlat(filtered);
  } else if (cat === 'todas') {
    label.textContent = `${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}` + sourceSuffix;
    renderGrouped(filtered);
  } else {
    label.textContent = `${CATEGORY_LABELS[cat] || cat} — ${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}` + sourceSuffix;
    renderGrouped(filtered);
  }
  renderFilterChips();
}

function setSourceFilter(source) {
  sourceFilter = source;
  applyFilter(currentCat);
  if (source) showToast(`Filtrando por ${source}`);
}

// ── Load ──────────────────────────────────────────────────────
async function loadNews(manual = false) {
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
    // Precompute token sets for related-lookup (avoids re-tokenizing per click)
    for (const a of allArticles) {
      a._tokens = new Set(tokenize(`${a.title || ''} ${a.summary || ''}`));
    }

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

    renderTrending();
    applyFilter(currentCat);

    // Persist visit AFTER render so the badges appear this session
    localStorage.setItem('lastVisitAt', Date.now().toString());

    if (manual) showToast('Actualizado');
  } catch (err) {
    renderEmpty('No se pudieron cargar las noticias', 'Verificá tu conexión e intentá de nuevo.');
    document.getElementById('section-label').textContent = 'Error al cargar';
    if (manual) showToast('Error al actualizar');
  }
}

// ── Auto-refresh timestamps ───────────────────────────────────
function refreshTimestamps() {
  document.querySelectorAll('.card-time[data-published]').forEach(el => {
    if (!el.dataset.published) return;
    const base = timeAgo(el.dataset.published);
    const mins = el.dataset.readtime;
    el.textContent = mins ? `${base} · ${mins} min` : base;
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

// ── Overflow menu ─────────────────────────────────────────────
function updateOverflowStates() {
  const hideItem = document.querySelector('[data-action="hide-read"]');
  if (hideItem) hideItem.setAttribute('aria-pressed', hideRead ? 'true' : 'false');
  const focusItem = document.querySelector('[data-action="focus"]');
  if (focusItem) focusItem.setAttribute('aria-pressed', document.body.classList.contains('focus-mode') ? 'true' : 'false');
  const themeItem = document.querySelector('[data-action="theme"] .sub');
  if (themeItem) themeItem.textContent = THEME_LABELS[currentTheme];
}

function openOverflowMenu() {
  const btn = document.getElementById('btn-overflow');
  const menu = document.getElementById('overflow-menu');
  updateOverflowStates();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Close on outside click (registered after this event loop)
  setTimeout(() => {
    document.addEventListener('click', outsideOverflowClose, { capture: true });
  }, 0);
}

function closeOverflowMenu() {
  const btn = document.getElementById('btn-overflow');
  const menu = document.getElementById('overflow-menu');
  menu.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', outsideOverflowClose, { capture: true });
}

function outsideOverflowClose(e) {
  const wrap = document.querySelector('.overflow-wrap');
  if (!wrap.contains(e.target)) closeOverflowMenu();
}

// ── Sources modal ─────────────────────────────────────────────
function buildSourcesList() {
  const byCat = {};
  for (const a of allArticles) {
    (byCat[a.category] ??= {});
    const s = byCat[a.category][a.source] ??= { count: 0, lastAt: 0 };
    s.count++;
    const t = a.published ? new Date(a.published).getTime() : 0;
    if (t > s.lastAt) s.lastAt = t;
  }
  return byCat;
}

function renderSourcesModal() {
  const list = document.getElementById('sources-list');
  const byCat = buildSourcesList();
  const order = ['internacional', 'economia', 'iglesia', 'tecnologia', 'deportes', 'belico', 'uruguay'];
  let html = '';
  let anySources = false;
  for (const cat of order) {
    const sources = byCat[cat];
    if (!sources) continue;
    anySources = true;
    html += `<li class="sources-section">${CATEGORY_EMOJIS[cat] || ''} ${escHtml(CATEGORY_LABELS[cat] || cat)}</li>`;
    const sorted = Object.entries(sources).sort((a, b) => b[1].count - a[1].count);
    for (const [src, info] of sorted) {
      const lastLabel = info.lastAt
        ? timeAgo(new Date(info.lastAt).toISOString())
        : '';
      html += `
        <li>
          <button class="sources-item" data-source="${escHtml(src)}">
            <span class="source-name">${escHtml(src)}</span>
            <span class="source-count">${info.count} art.</span>
            <span class="source-time">${lastLabel}</span>
          </button>
        </li>
      `;
    }
  }
  if (!anySources) {
    html = `<li class="palette-empty">No hay fuentes cargadas todavía.</li>`;
  }
  list.innerHTML = html;
  document.getElementById('btn-suggest-source').href = SUGGEST_URL;
}

function openSourcesModal() {
  renderSourcesModal();
  document.getElementById('sources-backdrop').classList.add('open');
}

function closeSourcesModal() {
  document.getElementById('sources-backdrop').classList.remove('open');
}

// ── Trending (most-mentioned terms) ───────────────────────────
function computeTrending(articles, n = 5) {
  const counts = new Map();
  for (const a of articles) {
    for (const t of tokenize(a.title || '')) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

function renderTrending() {
  const el = document.getElementById('trending');
  if (!allArticles.length) { el.hidden = true; return; }
  const top = computeTrending(allArticles);
  if (!top.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML =
    `<span class="trending-label">Tendencias</span>` +
    top.map(({ term, count }) => `
      <button class="trending-chip" data-term="${escHtml(term)}">
        ${escHtml(term)} <span class="trending-count">${count}</span>
      </button>
    `).join('');
}

// ── Watchlist (keyword highlighting) ──────────────────────────
function renderWatchlist() {
  const list = document.getElementById('watchlist-list');
  if (!watchlist.length) {
    list.innerHTML = `<div class="palette-empty">Agregá palabras para destacar noticias que las mencionen.</div>`;
  } else {
    list.innerHTML = watchlist.map((kw, i) => `
      <li>
        <button class="watchlist-item" data-idx="${i}" aria-label="Quitar ${escHtml(kw)}">
          <span class="watchlist-kw">${escHtml(kw)}</span>
          <span class="watchlist-remove" aria-hidden="true">×</span>
        </button>
      </li>
    `).join('');
  }
  // Update overflow menu count
  const countEl = document.getElementById('watchlist-count');
  if (countEl) countEl.textContent = watchlist.length ? String(watchlist.length) : '';
}

function openWatchlist() {
  renderWatchlist();
  document.getElementById('watchlist-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('watchlist-input').focus(), 50);
}

function closeWatchlist() {
  document.getElementById('watchlist-backdrop').classList.remove('open');
}

function addKeyword(kw) {
  kw = (kw || '').trim();
  if (!kw || kw.length > 40) return;
  if (watchlist.length >= WATCHLIST_CAP) {
    showToast(`Máximo ${WATCHLIST_CAP} palabras`);
    return;
  }
  const normalized = kw.toLowerCase();
  if (watchlist.some(w => w.toLowerCase() === normalized)) return;
  watchlist.push(kw);
  normalizedWatchlist.push(normalize(kw));
  localStorage.setItem('watchlist', JSON.stringify(watchlist));
  renderWatchlist();
  applyFilter(currentCat);
  showToast(`Agregada: ${kw}`);
}

function removeKeyword(idx) {
  const removed = watchlist.splice(idx, 1)[0];
  normalizedWatchlist.splice(idx, 1);
  localStorage.setItem('watchlist', JSON.stringify(watchlist));
  renderWatchlist();
  applyFilter(currentCat);
  if (removed) showToast(`Quitada: ${removed}`);
}

// ── Related articles (Jaccard over tokens) ────────────────────
function renderRelated(article) {
  const list = document.getElementById('related-list');
  const aTokens = article._tokens || new Set(tokenize(`${article.title} ${article.summary || ''}`));
  const scored = allArticles
    .filter(x => x.url !== article.url && isSafeUrl(x.url))
    .map(x => ({
      a: x,
      score: jaccard(aTokens, x._tokens || new Set()),
    }))
    .filter(x => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    list.innerHTML = `<div class="palette-empty">No encontramos noticias relacionadas.</div>`;
    return;
  }
  list.innerHTML = scored.map(({ a }) => `
    <li>
      <a class="related-item" href="${escHtml(a.url)}" target="_blank" rel="noopener" data-url="${escHtml(a.url)}">
        <span class="related-item-title">${escHtml(a.title)}</span>
        <span class="related-item-meta">${escHtml(CATEGORY_LABELS[a.category] || a.category)} · ${escHtml(a.source)} · ${timeAgo(a.published)}</span>
      </a>
    </li>
  `).join('');
}

function openRelated(article) {
  renderRelated(article);
  document.getElementById('related-backdrop').classList.add('open');
}

function closeRelated() {
  document.getElementById('related-backdrop').classList.remove('open');
}

// ── Focus mode ────────────────────────────────────────────────
function toggleFocus() {
  const active = document.body.classList.toggle('focus-mode');
  const exit = document.getElementById('focus-exit');
  exit.hidden = !active;
  if (active) showToast('Modo lectura — Esc para salir');
}

function exitFocus() {
  document.body.classList.remove('focus-mode');
  document.getElementById('focus-exit').hidden = true;
}

// ── Export cover as PNG ───────────────────────────────────────
async function exportCover() {
  if (!allArticles.length) { showToast('Sin artículos aún'); return; }
  try { await document.fonts.ready; } catch (_) {}
  const W = 1200, H = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Paper background
  ctx.fillStyle = '#fbf5e3';
  ctx.fillRect(0, 0, W, H);

  // Masthead
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 96px "Playfair Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('The Juanmo Times', W / 2, 150);

  // Red rule
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(W / 2 - 150, 180, 300, 4);

  // Date
  ctx.fillStyle = '#5d4633';
  ctx.font = '500 26px Inter, sans-serif';
  const dateStr = new Date().toLocaleDateString('es-UY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  ctx.fillText(dateStr, W / 2, 225);

  // Articles (top 8 most recent)
  const BADGE_COLORS = {
    internacional: '#1d4ed8', economia: '#15803d', iglesia: '#7c3aed',
    tecnologia: '#ea580c', deportes: '#0284c7', belico: '#b91c1c',
    uruguay: '#0369a1',
  };
  const articles = [...allArticles]
    .filter(a => a.title)
    .sort((a, b) => new Date(b.published) - new Date(a.published))
    .slice(0, 8);

  let y = 310;
  const slot = 155;
  ctx.textAlign = 'left';
  for (const a of articles) {
    if (y + slot > H - 80) break;
    // Badge
    const label = (CATEGORY_LABELS[a.category] || a.category).toUpperCase();
    ctx.font = '700 13px Inter, sans-serif';
    const labelW = ctx.measureText(label).width + 22;
    ctx.fillStyle = BADGE_COLORS[a.category] || '#1d4ed8';
    roundRect(ctx, 80, y - 22, labelW, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, 80 + labelW / 2, y - 4);

    // Title (Playfair, up to 2 lines)
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 30px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'left';
    const lines = wrapText(ctx, a.title, W - 160).slice(0, 2);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 80, y + 30 + i * 36);
    }

    // Meta
    ctx.fillStyle = '#5d4633';
    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillText(`${a.source} · ${timeAgo(a.published)}`, 80, y + 120);

    // Separator
    ctx.fillStyle = '#e6d9b8';
    ctx.fillRect(80, y + slot - 10, W - 160, 1);

    y += slot;
  }

  // Footer
  ctx.fillStyle = '#8b6f4e';
  ctx.font = '400 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('juanmo-times · portada del día', W / 2, H - 40);

  // Download
  canvas.toBlob(blob => {
    if (!blob) { showToast('Error al generar imagen'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `juanmo-times-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Portada descargada');
  }, 'image/png');
}

function wrapText(ctx, text, maxWidth) {
  const words = (text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
    if (document.getElementById('sources-backdrop').classList.contains('open')) closeSourcesModal();
    if (document.getElementById('watchlist-backdrop').classList.contains('open')) closeWatchlist();
    if (document.getElementById('related-backdrop').classList.contains('open')) closeRelated();
    if (!document.getElementById('overflow-menu').hidden) closeOverflowMenu();
    if (document.body.classList.contains('focus-mode')) exitFocus();
    closeShareMenu();
  }
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    openPalette();
  }
});

// ── Card click handling ───────────────────────────────────────
document.getElementById('grid').addEventListener('click', e => {
  // Source pill click: set source filter instead of opening article
  const sourceBtn = e.target.closest('.card-source[data-source]');
  if (sourceBtn) {
    e.preventDefault();
    e.stopPropagation();
    setSourceFilter(sourceBtn.dataset.source);
    return;
  }

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
    } else if (actionBtn.dataset.action === 'related') {
      openRelated(article);
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

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    sourceFilter = null; // switching category clears secondary filter
    applyFilter(btn.dataset.cat);
  });
});

document.getElementById('btn-search').addEventListener('click', openPalette);
document.getElementById('btn-saved').addEventListener('click', () => {
  sourceFilter = null;
  if (currentCat === 'guardadas') {
    applyFilter(previousCat);
  } else {
    previousCat = currentCat;
    applyFilter('guardadas');
  }
});

// Overflow menu trigger + item dispatcher
document.getElementById('btn-overflow').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('overflow-menu');
  if (menu.hidden) openOverflowMenu();
  else closeOverflowMenu();
});
document.getElementById('overflow-menu').addEventListener('click', e => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  e.stopPropagation();
  closeOverflowMenu();
  const action = item.dataset.action;
  if (action === 'sources') openSourcesModal();
  else if (action === 'watchlist') openWatchlist();
  else if (action === 'refresh') loadNews(true);
  else if (action === 'hide-read') toggleHideRead();
  else if (action === 'focus') toggleFocus();
  else if (action === 'export') exportCover();
  else if (action === 'theme') cycleTheme();
});

// Sources modal: backdrop click closes; list item click sets source filter
const sourcesBackdrop = document.getElementById('sources-backdrop');
sourcesBackdrop.addEventListener('click', e => {
  if (e.target === sourcesBackdrop) closeSourcesModal();
});
document.getElementById('sources-list').addEventListener('click', e => {
  const item = e.target.closest('.sources-item[data-source]');
  if (!item) return;
  setSourceFilter(item.dataset.source);
  closeSourcesModal();
});

// Filter chip click clears source filter
document.getElementById('filter-chips').addEventListener('click', () => {
  setSourceFilter(null);
});

// Trending chip click opens palette pre-filled with the term
document.getElementById('trending').addEventListener('click', e => {
  const chip = e.target.closest('[data-term]');
  if (!chip) return;
  openPalette();
  const input = document.getElementById('palette-input');
  input.value = chip.dataset.term;
  input.dispatchEvent(new Event('input'));
});

// Watchlist modal events
const watchlistBackdrop = document.getElementById('watchlist-backdrop');
watchlistBackdrop.addEventListener('click', e => {
  if (e.target === watchlistBackdrop) closeWatchlist();
});
document.getElementById('watchlist-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('watchlist-input');
  addKeyword(input.value);
  input.value = '';
  input.focus();
});
document.getElementById('watchlist-list').addEventListener('click', e => {
  const item = e.target.closest('.watchlist-item[data-idx]');
  if (!item) return;
  removeKeyword(parseInt(item.dataset.idx, 10));
});

// Related modal backdrop click closes
const relatedBackdrop = document.getElementById('related-backdrop');
relatedBackdrop.addEventListener('click', e => {
  if (e.target === relatedBackdrop) closeRelated();
});

// Focus mode exit button
document.getElementById('focus-exit').addEventListener('click', exitFocus);

// Initial watchlist count in overflow menu
{
  const countEl = document.getElementById('watchlist-count');
  if (countEl) countEl.textContent = watchlist.length ? String(watchlist.length) : '';
}

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
  // Auto-reload when a new SW takes control (fresh files available).
  // Guarded to skip the very first install (no prior controller).
  if (navigator.serviceWorker.controller) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
}
