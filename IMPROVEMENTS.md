# Juanmo Times — Improvements Brief

Spec para implementar mejoras de UI/UX y funcionamiento en el hub de noticias.
Hecho para pasar a Claude Code.

## Contexto del proyecto

PWA estática que agrega noticias por RSS en categorías (internacional, economía, iglesia, tecnología, deportes, bélico, uruguay). Stack:

- `index.html` — single-file app (HTML + CSS + JS vanilla, sin build step).
- `fetch_news.py` — script Python que lee los RSS y escribe `news.json`.
- `sw.js` — service worker (network-first para `news.json`, cache-first para estáticos).
- `.github/workflows/update.yml` — GitHub Actions corre `fetch_news.py` 3 veces al día (10:00, 16:00, 22:00 UTC).
- `manifest.json` + `icon.svg` — PWA metadata.

Estilo actual: serif (Playfair) en el logo, sans (Inter) en el resto. Paleta navy (`#0f172a`) + rojo (`#dc2626`) + fondo claro (`#f1f5f9`). Cards con badge de categoría, fuente, tiempo relativo, título, summary, link.

## Reglas generales

- Mantener el stack actual: **no** agregar build step, frameworks ni bundlers. Vanilla JS + CSS.
- Mantener el single-file approach en `index.html` salvo que una mejora justifique separar.
- Código y comentarios en inglés. UI en español.
- Persistencia cliente-side: `localStorage`. Nada de cookies ni backend.
- Al tocar `fetch_news.py`, mantener compatibilidad con el schema actual de `news.json` (campos `category`, `source`, `title`, `summary`, `url`, `published`) — agregar campos, no renombrar.
- Todos los cambios deben seguir funcionando offline vía el service worker.

---

## Mejoras a implementar

### 1. Búsqueda de texto (Ctrl/Cmd+K)

Input de búsqueda que filtra en cliente por `title`, `summary` y `source` sobre el array `allArticles`.

- Atajo global `Ctrl+K` / `Cmd+K` abre/foca el input.
- Filtrado en tiempo real (sin debounce agresivo; con 50–100ms basta).
- Respeta la categoría activa (busca dentro del filtro actual).
- Soporte básico: case-insensitive, ignorar acentos (`"normalize('NFD')"`).
- `Esc` limpia y cierra.
- Mostrar contador de resultados en `#section-label`.

### 2. Thumbnails en las tarjetas

Parsear imagen del feed RSS en `fetch_news.py` y renderizarla en la card.

- Fuentes a intentar, en orden: `media:thumbnail`, `media:content` (con `medium="image"` o sin medium), `enclosure` (type image/*), primera `<img>` dentro del `summary`/`description`.
- Guardar en `news.json` como campo nuevo `image` (string URL o `null`).
- En la card: imagen a la izquierda o arriba, aspect-ratio fijo (16:9 o 4:3), `loading="lazy"`, `object-fit: cover`, fallback elegante cuando no hay imagen (no mostrar el hueco).
- Respetar responsive: en grid de 3 columnas, probablemente imagen arriba; en lista mobile, puede ser al lado.

### 3. Marcar como leído + ocultar leídas

- Al hacer click en una card (o en su link), guardar la `url` en `localStorage['readUrls']` (Set serializado).
- Las cards leídas se muestran con opacidad reducida (~0.55) y/o un check sutil.
- Toggle en el header: "Ocultar leídas" — cuando está activo, se filtran del render.
- Límite del Set: últimas ~500 URLs para no crecer indefinidamente (FIFO).

### 4. Favoritos / leer después

- Botón estrella en cada card — toggle. Persistido en `localStorage['savedUrls']` junto con el artículo completo (snapshot) para que sobreviva aunque desaparezca del `news.json`.
- Nuevo tab en la fila de categorías: "⭐ Guardadas" que muestra esos snapshots.
- Permitir quitar de guardadas desde la misma vista.

### 5. Badge "NUEVO" desde la última visita

- Guardar `localStorage['lastVisitAt']` en cada carga, pero **después** de calcular qué noticias son nuevas para esa sesión.
- Pill pequeño rojo "NUEVO" en cards cuyo `published > lastVisitAt`.
- Contador total de nuevas al lado del logo del header (opcional pero útil: "12 nuevas").

### 6. Deduplicación entre fuentes

En `fetch_news.py`, después de juntar todos los artículos:

- Normalizar título: lowercase, sin acentos, sin puntuación, sin stopwords comunes en ES ("el", "la", "los", "las", "de", "del", "y", "en", "a", "un", "una", "por", "para", "con", "que", "se").
- Calcular similaridad entre pares de la misma fecha (±24h) — empezar simple: **Jaccard sobre tokens** con threshold 0.6, o `difflib.SequenceMatcher.ratio() > 0.75`.
- Al encontrar duplicados, quedarse con el más reciente. Si hay empate, preferir fuentes en este orden: BBC Mundo > El País > DW > France 24 > Infobae > El Observador > resto. Hacer configurable este ranking en una constante.
- Loggear cuántos dedupeó por run.

### 7. Card clickeable entera + auto-refresh de timestamps

- Toda la card es clickeable (envolverla en `<a>` con `target="_blank" rel="noopener"`), excepto los botones de acción (estrella, "marcar leída").
- El link "Leer artículo →" puede quedar como indicador visual pero no como único punto de click.
- `setInterval` cada 60s que recorre `.card-time` y los re-renderiza con `timeAgo()`. Guardar el `published` en un `data-published` para evitar re-parsear.

### 8. Dark mode real

- Variables CSS en `:root` y override en `@media (prefers-color-scheme: dark)` **y** en `html[data-theme="dark"]` para permitir override manual.
- Toggle en el header (icono sol/luna). Persistido en `localStorage['theme']` con valores `'light' | 'dark' | 'auto'`.
- Revisar contrastes: en dark mode, `--bg` debería ser tipo `#0b1220`, cards `#1e293b`, texto `#e2e8f0`, muted `#94a3b8`. Los badges de colores pueden quedar pero verificar contraste del texto blanco sobre ellos.
- `meta[name="theme-color"]` debe actualizarse dinámicamente cuando cambia el modo.

### 9. Accesibilidad

Pasada para cumplir WCAG AA mínimo:

- Subir contraste del texto del header: `rgba(255,255,255,.5)` → `rgba(255,255,255,.75)` mínimo.
- Tabs con ARIA correcto: `role="tablist"` en `.tabs`, `role="tab"` + `aria-selected` en cada botón, `role="tabpanel"` en `main`.
- Emojis en los tabs con `aria-hidden="true"` envueltos en `<span>`.
- `:focus-visible` con outline claro y visible en todos los interactivos (tabs, cards, links, botones nuevos).
- Skip link "Saltar al contenido" oculto hasta recibir foco.
- `<main>` con `id="main"` para el skip link.
- Cards con `role="article"` y `<h3>` semántico para el título (hoy es un `div`).
- Imágenes con `alt=""` (decorativo) o alt significativo si viene del feed.

### 10. Refresh manual + indicador de stale

- Botón `↻ Actualizar` en el header que re-fetchea `news.json?_=${Date.now()}`.
- Feedback visual mientras carga (spinner o rotación del icono).
- Si `Date.now() - updated_at > 6h`, mostrar el `#last-update` en ámbar/rojo con tooltip "Los datos pueden estar desactualizados".
- Reemplazar el badge flotante `#next-update` por algo más discreto o integrarlo en el header (la esquina inferior derecha tapa contenido en mobile).

---

## Bonus (nice to have, no bloquean)

- **Scroll-hint en tabs mobile**: gradiente fade a la derecha que indique que hay más categorías scrolleando.
- **`navigator.share()`** en mobile: botón compartir por card, con fallback a `copy to clipboard`.
- **`og:image` y `og:description`** dinámicos (requiere meta base en `index.html`, los campos dinámicos no se pueden sin SSR — setear valores representativos genéricos).
- **Filtro multi-categoría**: permitir seleccionar varias categorías a la vez (Ctrl+click sobre tabs).
- **Virtualización** si se pasa de ~150 items.
- **Agrupado por fecha**: separadores "Hoy", "Ayer", "Esta semana" en la grilla.

---

## Orden sugerido de implementación

1. **#7, #8, #9** — cambios self-contained en `index.html`, bajo riesgo, alta mejora percibida.
2. **#1, #3, #5, #10** — features de estado cliente, tocan JS pero no el backend.
3. **#4** — requiere un tab nuevo + snapshot en localStorage.
4. **#2, #6** — tocan `fetch_news.py` y el schema de `news.json`. Dejar para el final para no romper el flujo anterior.

## Criterios de aceptación

- La app sigue funcionando offline (service worker intacto o mejorado).
- `news.json` sigue siendo retrocompatible (campos agregados, no renombrados).
- No se rompe la PWA: manifest, service worker y `theme-color` se mantienen coherentes.
- Sin dependencias externas nuevas en el frontend. En Python, solo librerías estándar o `feedparser` (ya presente).
- Probado en Chrome mobile y desktop mínimo.
