"""Fetch market data (FX + indices + stocks + crypto) and write market.json.

Runs server-side via GitHub Actions — no CORS, no API keys. The browser just
reads market.json from the same origin, which is what makes this robust: the
client-side approach kept failing because free finance APIs either disallow
CORS or rate-limit aggressively.

Data sources (all free, no key):
  * Currencies: open.er-api.com  (USD-base rates → derive UYU crosses)
  * Crypto:     api.coingecko.com/v3/simple/price
  * Indices/Stocks: stooq.com/q/l  (batch CSV with '+' delimiter)

Percent change computation:
  Stooq's free tier no longer serves historical CSV without an apikey, so we
  can only get today's close. To still show daily % change, we keep the
  previous trading-day close inside market.json itself as bookkeeping fields
  (_date, _prev_close). When today's fetch returns a new trading date, the
  previously-stored current close becomes "yesterday" and we compute change
  from that. Intraday re-fetches on the same trading day keep "yesterday"
  stable, so the displayed % doesn't drift.

Uses only stdlib — no pip deps beyond what fetch_news.py already installs.
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone


# Stooq symbols — indices use ^ prefix; US stocks use .us suffix (lowercase).
# Note: Stooq's symbols don't always match Yahoo's. Verified mappings:
#   S&P 500     -> ^SPX
#   Dow         -> ^DJI
#   Nasdaq 100  -> ^NDX  (Stooq doesn't carry ^IXIC/composite)
#   Bovespa     -> ^BVP  (not ^BVSP)
#   Merval      -> ^MRV  (not ^MERV)
INDICES = [
    ("^SPX", "S&P 500"),
    ("^DJI", "Dow Jones"),
    ("^NDX", "Nasdaq 100"),
    ("^BVP", "Bovespa"),
    ("^MRV", "Merval"),
]
STOCKS = [
    ("aapl.us",  "AAPL"),
    ("msft.us",  "MSFT"),
    ("googl.us", "GOOGL"),
    ("amzn.us",  "AMZN"),
    ("tsla.us",  "TSLA"),
]
CRYPTO_IDS = [
    ("bitcoin",  "BTC"),
    ("ethereum", "ETH"),
    ("solana",   "SOL"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "text/csv, application/json, */*",
}

OUTPUT_FILE = "market.json"


# ── HTTP helpers ──────────────────────────────────────────────

def fetch_text(url, timeout=20):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_json(url, timeout=20):
    return json.loads(fetch_text(url, timeout))


# ── Stooq (indices + stocks) ──────────────────────────────────

def fetch_stooq_batch(symbols):
    """Batch-fetch OHLC from Stooq. Returns dict keyed by upper(symbol).

    IMPORTANT: Stooq batches symbols with '+' as the separator, NOT ','.  Using
    ',' makes Stooq collapse everything into one garbage row. This is
    undocumented; found by testing.

    We request OHLC (not just Close) so we can compute an intraday % change
    (close vs open) as a fallback on the very first run, when we don't yet
    have a stored previous-day close to compare against.
    """
    if not symbols:
        return {}
    # quote(^, safe='^') keeps the caret literal which Stooq's parser likes
    joined = "+".join(urllib.parse.quote(s, safe="^") for s in symbols)
    url = f"https://stooq.com/q/l/?s={joined}&f=sd2ohlc&h&e=csv"
    try:
        text = fetch_text(url)
    except Exception as e:
        print(f"  [!] Stooq batch: {e}")
        return {}

    lines = [ln for ln in text.strip().split("\n") if ln]
    if len(lines) < 2:
        return {}
    # Header: Symbol,Date,Open,High,Low,Close
    out = {}
    for line in lines[1:]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        sym, date = parts[0], parts[1]
        if date == "N/D":
            continue
        try:
            o = float(parts[2])
            c = float(parts[5])
        except ValueError:
            continue
        out[sym.upper()] = {"date": date, "open": o, "close": c}
    return out


def update_quotes(pairs, quotes_map, prev_items):
    """Build display quotes with a % change that's *always* populated.

    Strategy:
      1. If we have a stored previous-trading-day close (from an earlier run
         on a different date), compute day-over-day change — most accurate.
      2. Otherwise fall back to intraday change (close - open) / open, which
         is always available from the same Stooq request and still a useful
         directional signal (especially for the very first run).

    Bookkeeping fields (_date, _prev_close) persist in market.json so the
    day-over-day path kicks in as soon as a new trading date appears.
    """
    prev_by_label = {item.get("label"): item for item in (prev_items or [])}
    result = []
    for sym, label in pairs:
        cur = quotes_map.get(sym.upper())
        prev = prev_by_label.get(label) or {}
        if cur is None:
            # Transient Stooq hiccup — retain previous entry so the UI
            # doesn't flicker to "No disponible".
            if prev:
                print(f"    keeping stale: {sym}")
                result.append(prev)
            else:
                print(f"    missing: {sym}")
            continue

        today_date = cur["date"]
        today_open = cur["open"]
        today_close = cur["close"]

        prev_date = prev.get("_date")
        stored_prev_close = prev.get("_prev_close")
        stored_value = prev.get("value")

        # Decide which "previous close" to use for the day-over-day calc
        if prev_date and prev_date != today_date:
            # New trading day — yesterday's current becomes today's "prev"
            prev_close_for_change = stored_value
        else:
            # Same day or first run — keep whatever we stored as prev last time
            prev_close_for_change = stored_prev_close

        change = None
        if prev_close_for_change:
            try:
                change = (today_close - prev_close_for_change) / prev_close_for_change * 100.0
            except ZeroDivisionError:
                change = None
        # Fallback: intraday movement. Always available — guarantees the UI
        # shows a ± % even on the very first run.
        if change is None and today_open:
            try:
                change = (today_close - today_open) / today_open * 100.0
            except ZeroDivisionError:
                change = None

        result.append({
            "label":       label,
            "value":       round(today_close, 2),
            "change":      round(change, 2) if change is not None else None,
            # Bookkeeping for next run's day-over-day calc
            "_date":       today_date,
            "_prev_close": prev_close_for_change,
        })
    return result


# ── Currencies + Crypto ───────────────────────────────────────

def fetch_currencies():
    """UYU cross-rates derived from a USD base (open.er-api.com, no key)."""
    try:
        data = fetch_json("https://open.er-api.com/v6/latest/USD")
        rates = data.get("rates", {}) or {}
        usd_uyu = rates.get("UYU")
        if not usd_uyu:
            return []
        pairs = [("USD/UYU", usd_uyu)]
        if rates.get("EUR"):
            pairs.append(("EUR/UYU", usd_uyu / rates["EUR"]))
        if rates.get("BRL"):
            pairs.append(("BRL/UYU", usd_uyu / rates["BRL"]))
        if rates.get("ARS"):
            pairs.append(("ARS/UYU", usd_uyu / rates["ARS"]))
        return [{"label": lbl, "value": round(v, 2)} for lbl, v in pairs]
    except Exception as e:
        print(f"  [!] Currencies: {e}")
        return []


def fetch_crypto():
    """CoinGecko public API — free, no key, includes 24h % change."""
    try:
        ids = ",".join(i for i, _ in CRYPTO_IDS)
        url = (
            f"https://api.coingecko.com/api/v3/simple/price?ids={ids}"
            "&vs_currencies=usd&include_24hr_change=true"
        )
        data = fetch_json(url)
        out = []
        for cid, label in CRYPTO_IDS:
            row = data.get(cid)
            if not row:
                continue
            change = row.get("usd_24h_change")
            out.append({
                "label":    label,
                "value":    round(row.get("usd", 0), 2),
                "change":   round(change, 2) if change is not None else None,
                "currency": "USD",
            })
        return out
    except Exception as e:
        print(f"  [!] Crypto: {e}")
        return []


# ── Main ──────────────────────────────────────────────────────

def load_previous():
    """Load the existing market.json (if any) so we can use its stored closes
    for day-over-day % computation."""
    if not os.path.exists(OUTPUT_FILE):
        return {}
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    started = datetime.now(timezone.utc)
    print(f"Fetching market data — {started.isoformat()}")

    prev = load_previous()

    print("  Currencies...")
    fx = fetch_currencies()
    print(f"    {len(fx)} pairs")

    print("  Indices...")
    idx_quotes = fetch_stooq_batch([s for s, _ in INDICES])
    indices = update_quotes(INDICES, idx_quotes, prev.get("indices", []))
    print(f"    {len(indices)} indices")

    print("  Stocks...")
    stk_quotes = fetch_stooq_batch([s for s, _ in STOCKS])
    stocks = update_quotes(STOCKS, stk_quotes, prev.get("stocks", []))
    print(f"    {len(stocks)} stocks")

    print("  Crypto...")
    crypto = fetch_crypto()
    print(f"    {len(crypto)} coins")

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "fx":         fx,
        "indices":    indices,
        "stocks":     stocks,
        "crypto":     crypto,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    total = len(fx) + len(indices) + len(stocks) + len(crypto)
    print(f"\nListo! {OUTPUT_FILE} guardado ({total} items).")


if __name__ == "__main__":
    main()
