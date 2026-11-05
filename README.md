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
- **Refine from winners**: keep the top 25% by Elo, retire the rest, and breed new
  ideas inspired by what rose to the top. Loop it to converge on great gifts.
- **Shopping list**: everything you star, grouped by person, with a concrete product
  link, a price-watch graph over time, target prices, mark-as-bought, and running
  totals.
- **Photos on everything**: catalog items and AI-generated ideas get real product
  photos resolved from web image search (no paid key required).

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

The app works out of the box with the baked product catalog. To enable the AI
Generate / Steer / Refine features, copy `.llm-env.example` to `.llm-env` and add your
keys (the compose file loads it automatically).

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
