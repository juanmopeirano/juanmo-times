import feedparser
import json
import re
import html as html_module
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
    "uruguay": [
        {"source": "El Observador", "url": "https://www.elobservador.com.uy/rss/ultimas-noticias.xml"},
        {"source": "El País Uy",    "url": "https://www.elpais.com.uy/rss"},
        {"source": "La Diaria",     "url": "https://ladiaria.com.uy/feeds/rss/"},
    ],
}

MAX_PER_CATEGORY = 8

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
                articles.append({
                    "category": category,
                    "source": feed_info["source"],
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "published": parse_date(entry),
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

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "articles": all_articles,
    }
    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nListo! {len(all_articles)} artículos guardados en news.json")

if __name__ == "__main__":
    main()
