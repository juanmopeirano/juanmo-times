import feedparser
import json
import re
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
    ],
    "economia": [
        {"source": "Infobae",        "url": "https://www.infobae.com/feeds/rss/economia/"},
        {"source": "El Cronista",    "url": "https://www.cronista.com/rss/"},
        {"source": "El País Eco",    "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada"},
        {"source": "El Observador",  "url": "https://www.elobservador.com.uy/rss/economia.xml"},
    ],
    "iglesia": [
        {"source": "Vatican News", "url": "https://www.vaticannews.va/es.rss.xml"},
        {"source": "ACI Prensa",   "url": "https://www.aciprensa.com/rss/todas"},
    ],
    "tecnologia": [
        {"source": "Xataka",       "url": "https://www.xataka.com/index.xml"},
        {"source": "Genbeta",      "url": "https://www.genbeta.com/index.xml"},
        {"source": "El País Tech", "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada"},
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
        {"source": "Montevideo Portal",  "url": "https://www.montevideo.com.uy/anxml.aspx?58"},
        {"source": "La Diaria",          "url": "https://ladiaria.com.uy/feeds/articulos/"},
        {"source": "El País Uy",         "url": "https://www.elpais.com.uy/rss/index.xml"},
        {"source": "Google Noticias UY", "url": "https://news.google.com/rss/search?q=uruguay&hl=es-419&gl=UY&ceid=UY:es-419"},
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
    "DW Español": 3,
    "France 24": 4,
    "Infobae": 5, "Infobae Dep.": 5,
    "Montevideo Portal": 6,
    "La Diaria": 7,
    "El Observador": 8,
}
DEDUP_THRESHOLD = 0.6
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

    Keeps the entry with the best-ranked source (ties broken by most recent).
    """
    kept = []
    removed = 0
    window_sec = DEDUP_WINDOW_HOURS * 3600

    for a in articles:
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
                kept[dup_idx] = a
            removed += 1
        else:
            kept.append(a)

    print(f"  Deduped: {removed} duplicates removed")
    return kept

def fetch_category(category, feeds):
    articles = []
    for feed_info in feeds:
        try:
            feed = feedparser.parse(feed_info["url"])
            for entry in feed.entries[:10]:
                title = strip_html(getattr(entry, 'title', ''))
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

    articles.sort(key=lambda x: x["published"], reverse=True)
    return articles[:MAX_PER_CATEGORY]

def main():
    print(f"Iniciando fetch de noticias — {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    all_articles = []
    for category, feeds in FEEDS.items():
        print(f"  Buscando: {category}...")
        articles = fetch_category(category, feeds)
        all_articles.extend(articles)
        print(f"    {len(articles)} artículos")

    print("Deduplicando entre fuentes...")
    all_articles = deduplicate(all_articles)

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "articles": all_articles,
    }
    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nListo! {len(all_articles)} artículos guardados en news.json")

if __name__ == "__main__":
    main()
