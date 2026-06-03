import feedparser
import json
import re
import sys
import html as html_module
import unicodedata
from datetime import datetime, timezone

def strip_html(text):
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', '', text)
    text = html_module.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def truncate(text, max_len=300):
    if len(text) <= max_len:
        return text
    return text[:max_len].rsplit(' ', 1)[0] + '...'

def parse_date(entry):
    for attr in ('published_parsed', 'updated_parsed', 'created_parsed'):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime(*t[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    return datetime.now(timezone.utc).isoformat()

def extract_image(entry):
    # 1. media:thumbnail
    for t in (getattr(entry, 'media_thumbnail', None) or []):
        url = t.get('url') if isinstance(t, dict) else None
        if url:
            return url
    # 2. media:content (prefer medium="image" or no medium)
    for c in (getattr(entry, 'media_content', None) or []):
        if not isinstance(c, dict):
            continue
        medium = c.get('medium')
        url = c.get('url')
        if url and (medium == 'image' or not medium):
            return url
    # 3. enclosures (via entry.enclosures or entry.links[rel=enclosure])
    for enc in (getattr(entry, 'enclosures', None) or []):
        if not isinstance(enc, dict):
            continue
        if enc.get('type', '').startswith('image/') and enc.get('href'):
            return enc['href']
        if enc.get('type', '').startswith('image/') and enc.get('url'):
            return enc['url']
    for link in (getattr(entry, 'links', None) or []):
        if not isinstance(link, dict):
            continue
        if link.get('rel') == 'enclosure' and link.get('type', '').startswith('image/'):
            return link.get('href') or link.get('url')
    # 4. first <img> inside summary/description
    raw = getattr(entry, 'summary', '') or getattr(entry, 'description', '') or ''
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', raw)
    if m:
        return m.group(1)
    return None

FEEDS = {
    "internacional": [
        {"source": "BBC Mundo",   "url": "https://feeds.bbci.co.uk/mundo/rss.xml"},
        {"source": "DW Español",  "url": "https://rss.dw.com/rdf/rss-es-all"},
        {"source": "France 24",   "url": "https://www.france24.com/es/rss"},
        {"source": "El País",     "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada"},
        {"source": "CNN Español", "url": "https://cnnespanol.cnn.com/feed/"},
        {"source": "Google Internacional", "url": "https://news.google.com/rss/search?q=internacional+when:1d&hl=es-419&gl=UY&ceid=UY:es-419"},
    ],
    "economia": [
        {"source": "Infobae",        "url": "https://www.infobae.com/feeds/rss/economia/"},
        {"source": "El Cronista",    "url": "https://www.cronista.com/rss/"},
        {"source": "El País Eco",    "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada"},
        {"source": "El Observador",  "url": "https://www.elobservador.com.uy/rss/economia.xml"},
        {"source": "Google Economía", "url": "https://news.google.com/rss/search?q=economia+mercados+dolar+when:1d&hl=es-419&gl=UY&ceid=UY:es-419"},
    ],
    "iglesia": [
        {"source": "Vatican News", "url": "https://www.vaticannews.va/es.rss.xml"},
        {"source": "ACI Prensa",   "url": "https://www.aciprensa.com/rss/todas"},
        {"source": "Aleteia",      "url": "https://es.aleteia.org/feed/"},
    ],
    "tecnologia": [
        {"source": "Xataka",       "url": "https://www.xataka.com/index.xml"},
        {"source": "Genbeta",      "url": "https://www.genbeta.com/index.xml"},
        {"source": "El País Tech", "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada"},
        {"source": "Hipertextual", "url": "https://hipertextual.com/feed"},
    ],
    "deportes": [
        {"source": "Marca",           "url": "https://www.marca.com/rss/portada.xml"},
        {"source": "AS",              "url": "https://as.com/rss/tags/ultimas_noticias.xml"},
        {"source": "Infobae Dep.",    "url": "https://www.infobae.com/feeds/rss/deportes/"},
        {"source": "Google Deportes", "url": "https://news.google.com/rss/search?q=deporte+futbol+tenis+basket&hl=es-419&gl=US&ceid=US:es-419"},
        {"source": "Mundial 2026",    "url": "https://news.google.com/rss/search?q=mundial+futbol+2026&hl=es-419&gl=US&ceid=US:es-419"},
    ],
    "belico": [
        {"source": "Google Noticias", "url": "https://news.google.com/rss/search?q=guerra+conflicto+ataque+militar+Gaza+Ucrania&hl=es-419&gl=US&ceid=US:es-419"},
        {"source": "Google Noticias", "url": "https://news.google.com/rss/search?q=Medio+Oriente+Iran+Israel+Hamas+Rusia&hl=es-419&gl=US&ceid=US:es-419"},
        {"source": "BBC Mundo",       "url": "https://feeds.bbci.co.uk/mundo/rss.xml",  "keywords": True},
        {"source": "France 24",       "url": "https://www.france24.com/es/rss",          "keywords": True},
        {"source": "DW Español",      "url": "https://rss.dw.com/rdf/rss-es-all",       "keywords": True},
    ],
    "uruguay": [
        {"source": "La Diaria",          "url": "https://ladiaria.com.uy/feeds/articulos/"},
        {"source": "Google Noticias UY", "url": "https://news.google.com/rss/search?q=uruguay&hl=es-419&gl=UY&ceid=UY:es-419"},
        {"source": "El Observador",      "url": "https://news.google.com/rss/search?q=site:elobservador.com.uy&hl=es-419&gl=UY&ceid=UY:es-419"},
        {"source": "El País Uy",         "url": "https://news.google.com/rss/search?q=site:elpais.com.uy&hl=es-419&gl=UY&ceid=UY:es-419"},
    ],
}

MAX_PER_CATEGORY = 8

# Dedup config
STOPWORDS = {
    "el","la","los","las","de","del","y","en","a","un","una",
    "por","para","con","que","se","su","sus","al","lo","como",
}
SOURCE_RANKING = {
    "BBC Mundo": 1,
    "El País": 2, "El País Eco": 2, "El País Tech": 2, "El País Uy": 2,
    "CNN Español": 3,
    "DW Español": 3,
    "France 24": 4,
    "Infobae": 5, "Infobae Dep.": 5,
    "Montevideo Portal": 6,
    "La Diaria": 7,
    "El Observador": 8,
    "Xataka": 5, "Genbeta": 6, "Hipertextual": 6,
    "Vatican News": 4, "ACI Prensa": 5, "Aleteia": 6,
    "Marca": 5, "AS": 5,
    # Google News aggregators rank low — they're great for *coverage counting*
    # but their titles carry a " - Fuente" suffix, so prefer a real outlet as
    # the representative whenever one exists.
    "Google Internacional": 20, "Google Economía": 20, "Google Deportes": 20,
    "Google Noticias": 20, "Google Noticias UY": 20, "Mundial 2026": 20,
}
DEDUP_THRESHOLD = 0.5
DEDUP_WINDOW_HOURS = 24

WAR_KEYWORDS = [
    "guerra", "conflicto", "ataque", "bombardeo", "misil", "cohete",
    "ofensiva", "ejército", "militar", "tropas", "ceasefire", "alto el fuego",
    "Gaza", "Ucrania", "Rusia", "Israel", "Hamas", "Hezbollah", "Irán",
    "Siria", "Yemen", "Sudán", "Corea del Norte", "OTAN", "NATO",
    "war", "attack", "strike", "troops", "offensive", "weapons", "bombs",
    "killed", "deaths", "casualties", "battle", "invasion", "occupation",
    "drone", "missile", "airstr", "ceasefire", "armistice",
]

def matches_war_keywords(title, summary):
    text = (title + " " + summary).lower()
    return any(kw.lower() in text for kw in WAR_KEYWORDS)

def _norm_compare(s):
    """Aggressive normalization for comparing title vs summary:
    lowercase, strip accents, drop all punctuation, collapse whitespace.
    Makes \"Title - Source\" and \"Title Source\" equivalent.
    """
    s = s.lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s)
                if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^\w\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def is_redundant_summary(title, summary):
    """Google News (and some aggregators) return the title wrapped in <a>
    as the description, so after stripping HTML the "summary" is basically
    the title. Detect that and drop the summary so cards don't duplicate it.
    """
    if not summary:
        return True
    t = _norm_compare(title)
    s = _norm_compare(summary)
    if not t or not s:
        return True
    if t == s:
        return True
    # Summary is title + small trailing tail
    if s.startswith(t) and (len(s) - len(t)) < 40:
        return True
    # Title is summary + small trailing tail
    if t.startswith(s) and (len(t) - len(s)) < 15:
        return True
    # Token overlap >= 85% (catches reordered / truncated cases)
    t_words = set(t.split())
    s_words = set(s.split())
    if t_words and s_words:
        jaccard = len(t_words & s_words) / len(t_words | s_words)
        if jaccard >= 0.85:
            return True
    return False

def normalize_title(t):
    """Lowercase, strip accents + punctuation, drop stopwords and short tokens."""
    t = t.lower()
    t = ''.join(c for c in unicodedata.normalize('NFD', t) if unicodedata.category(c) != 'Mn')
    t = re.sub(r'[^\w\s]', ' ', t)
    return {w for w in t.split() if len(w) > 2 and w not in STOPWORDS}

def deduplicate(articles):
    """Collapse near-duplicate articles across sources using Jaccard similarity.

    Instead of just discarding duplicates, we COUNT them: every source that
    runs the same story is recorded on the surviving article as `coverage`
    (distinct source count) + `sources` (their names). Cross-source corroboration
    is the strongest "this matters right now" signal we have — same principle as
    ranking a topic by how many outlets cover it.

    The surviving entry uses the best-ranked source as its representative
    (ties broken by most recent), but carries the full coverage of the cluster.
    """
    kept = []
    merged = 0
    window_sec = DEDUP_WINDOW_HOURS * 3600

    for a in articles:
        a.setdefault("coverage", 1)
        a.setdefault("sources_set", {a["source"]})
        a_tokens = normalize_title(a["title"])
        if not a_tokens:
            kept.append(a)
            continue
        try:
            a_date = datetime.fromisoformat(a["published"])
        except Exception:
            a_date = None

        dup_idx = -1
        for i, b in enumerate(kept):
            b_tokens = normalize_title(b["title"])
            if not b_tokens:
                continue
            if a_date:
                try:
                    b_date = datetime.fromisoformat(b["published"])
                    if abs((a_date - b_date).total_seconds()) > window_sec:
                        continue
                except Exception:
                    pass
            jaccard = len(a_tokens & b_tokens) / len(a_tokens | b_tokens)
            if jaccard >= DEDUP_THRESHOLD:
                dup_idx = i
                break

        if dup_idx >= 0:
            b = kept[dup_idx]
            # Merge the two clusters' source sets — that's the coverage count.
            merged_sources = set(b["sources_set"]) | set(a["sources_set"])
            merged_coverage = len(merged_sources)
            a_rank = SOURCE_RANKING.get(a["source"], 99)
            b_rank = SOURCE_RANKING.get(b["source"], 99)
            replace = False
            if a_rank < b_rank:
                replace = True
            elif a_rank == b_rank:
                try:
                    if datetime.fromisoformat(a["published"]) > datetime.fromisoformat(b["published"]):
                        replace = True
                except Exception:
                    pass
            if replace:
                a["sources_set"] = merged_sources
                a["coverage"] = merged_coverage
                kept[dup_idx] = a
            else:
                b["sources_set"] = merged_sources
                b["coverage"] = merged_coverage
            merged += 1
        else:
            kept.append(a)

    print(f"  Deduped: {merged} duplicates merged into coverage counts")
    return kept

def score_relevance(articles):
    """Assign each article a `relevance` score driving the Destacadas ranking.

    relevance = coverage * 10  (how many outlets ran the story — main driver)
              + recency_bonus(0..5)
              + quality_bonus(0..3)  (a story from BBC/El País outranks a random
                                      aggregator item all else equal)

    We also flatten the internal `sources_set` into a JSON-serialisable
    `sources` list and keep `coverage`.
    """
    now = datetime.now(timezone.utc)
    for a in articles:
        cov = a.get("coverage", 1)
        try:
            age_h = (now - datetime.fromisoformat(a["published"])).total_seconds() / 3600
        except Exception:
            age_h = 48.0
        recency = max(0.0, 1.0 - age_h / 48.0)  # 1.0 just now → 0.0 at 48h+
        rank = SOURCE_RANKING.get(a.get("source"), 99)
        quality = max(0.0, (10 - min(rank, 10)) / 10.0)  # rank1→0.9, rank10+→0
        a["relevance"] = round(cov * 10 + recency * 5 + quality * 3, 2)
        srcs = a.pop("sources_set", None) or {a.get("source")}
        a["sources"] = sorted(s for s in srcs if s)
        a["coverage"] = cov
    return articles

def fetch_category(category, feeds):
    articles = []
    for feed_info in feeds:
        try:
            feed = feedparser.parse(feed_info["url"])
            for entry in feed.entries[:15]:
                title = strip_html(getattr(entry, 'title', ''))
                # Google News appends " - Publisher" to every headline. Strip it:
                # it's noise on the card AND it pollutes title-similarity matching,
                # which is exactly what coverage counting relies on.
                if "Google" in feed_info["source"]:
                    title = re.sub(r'\s+-\s+[^-]+$', '', title).strip()
                raw_summary = (
                    getattr(entry, 'summary', '')
                    or getattr(entry, 'description', '')
                    or ''
                )
                summary = truncate(strip_html(raw_summary), 300)
                url = getattr(entry, 'link', '')
                if not title or not url:
                    continue
                if feed_info.get("keywords") and not matches_war_keywords(title, summary):
                    continue
                # Drop summary when it's just the title (common in Google News)
                if is_redundant_summary(title, summary):
                    summary = ""
                articles.append({
                    "category": category,
                    "source": feed_info["source"],
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "published": parse_date(entry),
                    "image": extract_image(entry),
                })
        except Exception as e:
            print(f"  [!] Error en {feed_info['source']}: {e}")

    # Return the FULL set (capped per feed above). Trimming to MAX_PER_CATEGORY
    # happens after dedup so we don't throw away the cross-source overlap that
    # coverage counting depends on.
    articles.sort(key=lambda x: x["published"], reverse=True)
    return articles

def main():
    # Windows consoles default to cp1252 and choke on emoji/accents in our
    # diagnostic prints. Force UTF-8 (replace anything unencodable) so logging
    # never aborts the run. No-op on Linux (GitHub Actions is already UTF-8).
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    print(f"Iniciando fetch de noticias — {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    all_articles = []
    for category, feeds in FEEDS.items():
        print(f"  Buscando: {category}...")
        articles = fetch_category(category, feeds)
        all_articles.extend(articles)
        print(f"    {len(articles)} artículos")

    print(f"Total bruto: {len(all_articles)} artículos")
    print("Deduplicando y midiendo cobertura entre fuentes...")
    all_articles = deduplicate(all_articles)
    all_articles = score_relevance(all_articles)

    # Trim each category to its MAX_PER_CATEGORY most relevant stories
    # (coverage-weighted, recency as tiebreak) — now that coverage is counted.
    by_cat = {}
    for a in all_articles:
        by_cat.setdefault(a["category"], []).append(a)
    trimmed = []
    for cat, items in by_cat.items():
        items.sort(key=lambda x: (x["relevance"], x["published"]), reverse=True)
        trimmed.extend(items[:MAX_PER_CATEGORY])
    all_articles = trimmed

    # Quick visibility into what the algorithm considers the top stories.
    top = sorted(all_articles, key=lambda x: x["relevance"], reverse=True)[:8]
    print("  Top por relevancia (lo que va a Destacadas):")
    for a in top:
        srcs = ", ".join(a["sources"][:4])
        print(f"    [{a['relevance']:.0f}] {a['coverage']}x ({srcs}) — {a['title'][:60]}")

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "articles": all_articles,
    }
    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nListo! {len(all_articles)} artículos guardados en news.json")

if __name__ == "__main__":
    main()
