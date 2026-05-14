#!/usr/bin/env python3
"""
Tazkarti Derby Ticket Watcher
Monitors tazkarti.com for Al-Ahly vs Zamalek tickets.

How it works:
  1. Opens tazkarti.com in a headless browser (Playwright)
  2. Intercepts the background API calls to get match data directly
  3. Checks if the derby match has available tickets
  4. Sends a Telegram notification on any change

Setup:
    pip install playwright requests schedule
    playwright install chromium
"""

import json
import logging
import time
import re
import schedule
import requests
from datetime import datetime
from playwright.sync_api import sync_playwright, Route, Request

# ─────────────────────────────────────────────────────────
#  CONFIGURATION  ← edit this section only
# ─────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = "8726423157:AAHBDPuWl6tAT8g4XjcgXF2FU5l7tjg7lyM"   # from @BotFather
TELEGRAM_CHAT_ID   = "-1003538526366"     # from @userinfobot

# Check every N minutes
CHECK_INTERVAL_MINUTES = 1
CHECK_INTERVAL_SECONDS = 20


# Keywords to identify the derby match (case-insensitive)
# The script will flag a match if ANY of these appear in the match name/teams
DERBY_KEYWORDS = ["ceramica"]

# Ticket page
TAZKARTI_URL = "https://www.tazkarti.com/#/matches"

# ─────────────────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("tazkarti_watcher.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
#  STATE
# ─────────────────────────────────────────────────────────

last_status: dict = {}   # match_id -> status string

# ─────────────────────────────────────────────────────────
#  TELEGRAM
# ─────────────────────────────────────────────────────────

def send_telegram(message: str) -> bool:
    url  = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = {"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"}
    try:
        r = requests.post(url, data=data, timeout=10)
        r.raise_for_status()
        log.info("Telegram ✓")
        return True
    except Exception as e:
        log.error(f"Telegram failed: {e}")
        return False

# ─────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────

def is_final(match: dict) -> bool:

    text = json.dumps(match, ensure_ascii=False).lower()
    return any(kw.lower() in text for kw in DERBY_KEYWORDS)


def guess_status(match: dict) -> str:
    """
    Try to extract a status string from a match dict.
    Tazkarti usually has fields like: status, isAvailable, ticketStatus, etc.
    We'll try common field names and fall back to a JSON fingerprint.
    """
    candidates = [
        match.get("status"),
        match.get("ticketStatus"),
        match.get("Available"),
        match.get("availableTickets"),
        match.get("isSoldOut"),
        match.get("matchStatus"),
    ]
    # Build a status string from whatever is non-None
    parts = [str(v) for v in candidates if v is not None]
    return "|".join(parts) if parts else json.dumps(match, sort_keys=True)



# ─────────────────────────────────────────────────────────
#  SCRAPING — API INTERCEPTION + DOM FALLBACK
# ─────────────────────────────────────────────────────────

def fetch_matches_via_interception() -> list[dict]:
    """
    Open tazkarti.com with Playwright, intercept XHR/fetch calls,
    and return the matches list from the API response.
    """
    captured: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx     = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ar-EG",
        )
        page = ctx.new_page()

        # ── Intercept all API responses ───────────────────
        api_responses: list[dict] = []

        def handle_response(response):
            url = response.url.lower()
            # Look for JSON responses that might contain match data
            if any(kw in url for kw in ["match", "event", "game", "ticket"]):
                try:
                    ct = response.headers.get("content-type", "")
                    if "json" in ct:
                        body = response.json()
                        api_responses.append({"url": response.url, "body": body})
                        log.info(f"  Captured API call: {response.url}")
                except Exception:
                    pass

        page.on("response", handle_response)

        log.info(f"Opening {TAZKARTI_URL} ...")
        page.goto(TAZKARTI_URL, wait_until="networkidle", timeout=40_000)
        page.wait_for_timeout(4000)   # extra wait for lazy-loaded data

        # ── Parse intercepted API responses ──────────────
        for api in api_responses:
            body = api["body"]
            # Common shapes: list, {"data": [...]}, {"matches": [...]}
            matches_list = None
            if isinstance(body, list):
                matches_list = body
            elif isinstance(body, dict):
                for key in ("data", "matches", "events", "result", "items", "results"):
                    if isinstance(body.get(key), list):
                        matches_list = body[key]
                        break

            if matches_list:
                log.info(f"  Found {len(matches_list)} matches in {api['url']}")
                captured.extend(matches_list)

        # ── DOM fallback if no API was caught ─────────────
        if not captured:
            log.warning("No API responses captured — falling back to DOM scraping.")
            page.wait_for_timeout(3000)

            # Try to grab visible match cards text
            try:
                cards = page.query_selector_all(
                    "[class*='match'], [class*='card'], [class*='event'], article, .match-item"
                )
                for card in cards:
                    text = card.inner_text()
                    if any(kw.lower() in text.lower() for kw in DERBY_KEYWORDS):
                        captured.append({"raw_text": text, "source": "DOM"})
                        log.info(f"  DOM match found: {text[:80]}")
            except Exception as e:
                log.error(f"DOM fallback error: {e}")

        browser.close()

    return captured


# ─────────────────────────────────────────────────────────
#  MAIN CHECK
# ─────────────────────────────────────────────────────────

def check_tickets():
    global last_status

    now = datetime.now().strftime("%H:%M:%S")
    log.info(f"[{now}] ─── Checking Tazkarti ───")

    try:
        all_matches = fetch_matches_via_interception()
    except Exception as e:
        log.error(f"Scrape error: {e}")
       # send_telegram(f"⚠️ <b>Tazkarti Watcher Error</b>\n<code>{e}</code>")
        return

    if not all_matches:
        log.warning("No matches data found at all.")
        return

    derby_matches = [m for m in all_matches if is_final(m)]
    log.info(f"Total matches: {len(all_matches)} | Zamalek matches found: {len(derby_matches)}")

    if not derby_matches:
        log.info("zamalek final match not listed yet on the site.")
        return

    for match in derby_matches:
        mid    = str(match.get("id", match.get("matchId", hash(json.dumps(match, sort_keys=True)))))
        status = guess_status(match)
        prev   = last_status.get(mid)

        if prev is None:
            # First time we see this match
            log.info(f"zamalek match detected for the first time! Status: {status}")
            send_telegram(
                f"👀 <b>Zamalek vs ceramica cleopatra Match Found on Tazkarti!</b>\n\n"
                f"🔥🔥<b>التذاكر نزلت</b>\n\n"
                f"👉 <a href='{TAZKARTI_URL}'>book tickets</a>\n"
            )

        elif status != prev:
            log.info(f"Zamalek status CHANGED: {prev!r} → {status!r}")
        else:
            log.info(f"Derby status unchanged: {status}")

        last_status[mid] = status


# ─────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("=" * 55)
    log.info("  Tazkarti Zamalek Watcher")
    log.info(f"  Interval : every {CHECK_INTERVAL_SECONDS} second(s)")
    log.info("=" * 55)

    send_telegram(
        f"🚀 <b>Zamalek vs USM Alger Tickets Watcher Started</b>\n"
        f"Checking every {CHECK_INTERVAL_SECONDS} sec for:\n"
        f"👉 <a href='{TAZKARTI_URL}'>tazkarti.com</a>"
    )

    check_tickets()
    schedule.every(CHECK_INTERVAL_SECONDS).seconds.do(check_tickets)

    while True:
        schedule.run_pending()
        time.sleep(10)