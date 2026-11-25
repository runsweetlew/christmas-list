# The Christmas List

A calm, head-to-head gift finder. Set up the people you shop for, play "this or that"
to let your taste surface the best gifts, build a shopping list, and watch prices over
time. Ships with a curated catalog of real products (with photos) and optional AI that
generates fresh, personalized ideas.

Live demo: https://christmas.lewbutler.com

## What it does

- **People**: one card per recipient with demographics, interest keywords, a budget
  range, and a free-text "what they want" wishlist that drives matching.
- **Head-to-Head**: a pairwise "this or that" battle with product photos and an Elo
  rating under the hood. Pick with the arrow keys, press down for "neither" (both get
  penalized), star or banish a gift, and undo your last decision.
- **Steer the ideas**: type feedback mid-battle ("less kitchen stuff, more fishing
  gear") and the pool updates with fresh, re-targeted ideas; the note is saved to the
  profile so future ideas stay on-taste.
- **Refine from winners**: keep the top 50% by Elo, retire the rest, and breed new
  ideas inspired by what rose to the top. Loop it to converge on great gifts.
- **Shopping list**: everything you star, grouped by person, with a concrete product
  link, a price-watch graph over time, target prices, mark-as-bought, and running
  totals.
- **Photos on everything**: catalog items and AI-generated ideas get real product
  photos resolved from web image search (no paid key required).

## Accounts & sharing

- **Accounts**: every list is private to a signed-in user. Sign up or log in with email
  and password; sessions are kept in an HttpOnly cookie. A new account starts empty,
  with an optional "add sample people" seed. New recipients get their head-to-head pool
  pre-filled from the catalog by keyword match so you can start battling immediately.
- **Optional sign-in methods**: Google sign-in and passwordless magic-link email are
  wired in and light up when configured. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  for the Google button, and `SMTP_HOST` (plus the other `SMTP_*` vars) for magic-link
  email. Leave them blank to keep those methods hidden. See `.env.example`.
- **Share a list**: from a person's page you can mint an unlisted share link. Anyone with
  the link can view that one recipient's listed items and claim what they plan to buy so
  no one doubles up. Share links are `noindex`, can be reset (rotating the old one away)
  or disabled, and "surprise mode" hides claimers from you. Claims are name-tagged and
  rate-limited; no account is needed to view or claim.

## Design

The look is a deliberate blend: Frank Lloyd Wright for the bones (Prairie horizontality,
a geometric art-glass evergreen mark, warm earth palette), Dieter Rams for the discipline
(one accent, flat honest planes, strict grid, Jost type), and a little Elf-movie warmth
for the soul.

## Stack

- Node.js + Express, SQLite via better-sqlite3
- Vanilla JS frontend (no build step), custom SVG price charts
- Docker + docker-compose
- Optional AI idea generation via an OpenAI-compatible LLM (Groq primary, Gemini
  fallback)

## Run it

```bash
# with Docker
docker compose up -d --build
# → http://localhost:3101

# or plain Node
npm install
npm start
```

The app works out of the box with the baked product catalog and email+password
accounts — **no API keys required**. Every integration below is optional and only
lights up when you supply **your own** key.

## Configuration & API keys (bring your own)

All secrets live in two gitignored files you create from the provided examples.
**Nobody else's keys ship in this repo — each deployment must supply its own**, so
your account's quota/billing is never used by someone running their own copy.

1. **`.env`** — copy from `.env.example`, then fill in any you want:

   | Key | Enables | Where to get it |
   |-----|---------|-----------------|
   | `SESSION_SECRET` | Signs session cookies (auto-generated if blank) | — |
   | `APP_ORIGIN` | Share links + OAuth/magic-link URLs. Use `http://localhost:3101` for local | your deployment's URL |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google" sign-in | Your own OAuth 2.0 **Web** client at [Google Cloud Console](https://console.cloud.google.com) → Credentials. Redirect URI = `<APP_ORIGIN>/api/auth/google/callback` |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Magic-link email sign-in | Your own SMTP creds (e.g. a Gmail App Password) |
   | `SERPAPI_KEY` | Live, accurately-photographed/priced gift results for niche interests | Your own free key (250 searches/mo) at [serpapi.com](https://serpapi.com/manage-api-key) |

2. **`.llm-env`** — copy from `.llm-env.example`. Enables the AI **Generate / Steer /
   Refine** idea features. Needs your own [Groq](https://console.groq.com) key
   (primary) and optionally a [Google AI Studio / Gemini](https://aistudio.google.com)
   key (fallback).

`docker compose` loads both files automatically. Leave any key blank and that
feature simply stays hidden/falls back to the catalog — nothing breaks.

## How the data is built

`seed/catalog.json` is the product catalog. It is assembled and enriched by the scripts
in `scripts/`:

- `build_catalog.js` merges the raw research batches in `seed/raw/` into the catalog
- `resolve_bing.js` resolves a real product photo for each item via image search
- `verify_images.js` drops any image that does not load
- `price_scrape.js` is the nightly best-effort price-watch job

On first run the app seeds a set of default recipients and matches catalog items to each
by persona and interests.

## Notes

- Price tracking is best-effort: many retailers block automated price reads, so the
  graph fills from the price captured when you star an item plus whatever the nightly
  job and your manual entries add.
- This is a personal project shared as-is.
