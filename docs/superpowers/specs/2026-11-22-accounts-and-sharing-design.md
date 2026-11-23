# The Christmas List — Accounts & Shareable Lists

Date: 2026-11-22
Status: Approved design, pending implementation plan

## Goal

Turn the currently single-user "Christmas List" app into a multi-user app:

1. People can **create an account and log in**, so each person's recipients, gift
   ideas, ratings, favorites, and shopping lists are private to them.
2. A user can **share one recipient's list via an unlisted link** (reachable only
   with the link, not listed/indexed anywhere). Visitors to that link can view the
   list and **claim items** ("I'll buy this") without an account, so co-shoppers do
   not double-buy.

Per the owner's decision, existing production data is **wiped (start fresh)** — no
migration of the current 7 personas / ~900 ideas.

## Non-goals

- Password reset flows (can be added later; not required for v1).
- Team/shared editing of a single account.
- Email verification on signup (v1 trusts the email string; magic-link path proves
  control of an inbox for those who use it).
- Changing the head-to-head / Elo / AI generation behavior, except to scope it per
  user and to populate a new recipient's pool on creation.

## Authentication

Three login methods behind **one shared session layer**. Email+password works with
zero external setup and is the v1 baseline; the other two are wired and activate
automatically when their credentials/env are present.

| Method | Works now? | Requires |
|--------|-----------|----------|
| Email + password | Yes | nothing (Node `crypto.scrypt`, no new deps) |
| Google sign-in (OAuth) | Code ready, dark until configured | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN` env |
| Magic link (email) | Code ready, dark until configured | SMTP creds (`SMTP_*` env) for outbound email |

The login screen shows only the methods whose config is present (email+password
always; Google button only if `GOOGLE_CLIENT_ID` set; magic-link field only if SMTP
is configured). `GET /api/auth/config` reports which are enabled so the frontend can
render accordingly.

### Sessions

- Opaque random 32-byte token stored in a `sessions` table, delivered as an
  httpOnly, `SameSite=Lax`, `Secure` (when behind https) cookie named `cl_session`.
- Signed with a server secret (`SESSION_SECRET` env; generated and persisted to
  `data/.session-secret` if unset) to detect tampering.
- Default lifetime 60 days; sliding refresh on use. Logout deletes the row.

### Password hashing

- `crypto.scryptSync(password, salt, 64)` with a per-user random 16-byte salt,
  stored as `scrypt$<saltHex>$<hashHex>`. Constant-time compare via
  `crypto.timingSafeEqual`. Minimum password length 8.

## Data model

New fresh-start schema (the start-fresh wipe removes the old DB; a one-time
migration also adds the columns/tables if an old DB is present, then clears user
data so no orphaned rows survive).

```
users
  id            INTEGER PK
  email         TEXT UNIQUE            -- lowercased
  name          TEXT
  password_hash TEXT   NULL            -- null for OAuth-only / magic-only users
  google_sub    TEXT UNIQUE NULL       -- Google subject id
  created, updated TEXT

sessions
  token     TEXT PK                    -- random 32 bytes hex
  user_id   INTEGER -> users.id
  expires   TEXT
  created   TEXT

login_tokens                          -- magic links
  token     TEXT PK
  email     TEXT
  expires   TEXT                       -- short, ~15 min
  used      INTEGER DEFAULT 0

recipients  (+ new columns)
  user_id     INTEGER -> users.id      -- owner
  share_token TEXT UNIQUE NULL         -- null = private; set = shared at /share/<token>
  share_hide_claims INTEGER DEFAULT 0  -- "surprise mode": hide claim details from owner

claims
  id           INTEGER PK
  idea_id      INTEGER -> ideas.id
  claimer_name TEXT
  note         TEXT
  created      TEXT
```

`ideas` and `price_history` stay keyed to a recipient and are scoped transitively
through `recipients.user_id`. The product **catalog** (`seed/catalog.json`) remains
global reference data, not user data.

## Scoping (ownership enforcement)

- A `requireUser` middleware runs before every `/api/*` route except `/api/auth/*`,
  `/api/health`, and the public `/api/share/*` routes. It resolves the session
  cookie to `req.user` or returns `401`.
- Every recipient lookup is `WHERE id = ? AND user_id = ?`. Idea/battle/price/status
  routes first resolve the idea's recipient and confirm it belongs to `req.user`,
  returning `404` on mismatch (never leak existence across accounts).
- `/api/state`, `/api/shopping-list` filter by `req.user.id`.

## Sharing

### Owner side (authenticated)

- `POST /api/recipients/:id/share` — mint a `share_token` if absent (random 24-byte
  urlsafe), enable sharing, return the full share URL. Idempotent.
- `POST /api/recipients/:id/share/rotate` — revoke the old token, mint a new one
  (old links die).
- `DELETE /api/recipients/:id/share` — disable sharing (set `share_token` null).
- `PUT /api/recipients/:id/share` — toggle `share_hide_claims` (surprise mode).
- UI: a **Share** control on the person detail view showing the link, a Copy button,
  a rotate/disable action, and the surprise-mode toggle.

### Public side (no auth)

- `GET /share/:token` — serves a dedicated minimal read-only page (own small HTML +
  JS, not the gated SPA) showing the recipient's **listed + purchased** items:
  photo, title, why, price, target price, and the product link. No profile internals
  (keywords/feedback/budget) and no head-to-head are exposed.
- `GET /api/share/:token` — JSON for that page: safe recipient fields (name, emoji,
  relationship) + the listed/purchased ideas + each item's claim state.
- `POST /api/share/:token/claim` `{ ideaId, name, note? }` — record a claim (no
  account). `POST /api/share/:token/unclaim` `{ ideaId, name }` — release it.
- Claim visibility: always shown to visitors so co-shoppers coordinate. Also shown to
  the owner in their app **unless** `share_hide_claims` is on, in which case the owner
  sees no claim information at all (preserving the surprise when sharing one's own
  wishlist).
- A claimed item stays visible and purchasable (someone may still want a backup), but
  renders with a clear "Claimed by <name>" badge and a Release action for that name.

## New-user experience (fresh start)

- New accounts start with **no recipients**. The user adds the people they shop for.
- On `POST /api/recipients`, after insert, **auto-populate the head-to-head pool from
  the catalog** by interest/budget match so the pool is not empty on day one. This
  reuses the matching idea from `seed/seed.js` generalized for arbitrary recipients:
  a `matchCatalog(recipient, catalog)` that scores catalog items by keyword overlap
  (recipient `keywords` + `wishlist` vs item `category/title/descr/tags`) within
  `~1.4x budget_max`, with the existing dogs special-case (keyword "dog" ->
  `tags.includes('dogs')`, and dog items only for dog recipients). Inserts up to ~80
  matched items as `source='pool'` ideas. AI Generate augments as today.
- A small **"Add sample people"** action on an empty account seeds the 7 demo
  personas (the existing `DEFAULTS`) into the current user, for a quick tour.

## Frontend

- **Auth gate**: on load, call `GET /api/auth/me`; if unauthenticated, render a
  login/signup screen (email+password form; Google button and magic-link field shown
  per `/api/auth/config`). On success, load the app.
- **User menu**: header shows the signed-in name with a logout action.
- **Share UI**: the Share control described above on the person view.
- **Shared view**: a separate lightweight page served at `/share/:token`, styled to
  match the app (North Pole Prairie look), read-only with claim buttons. It does not
  load the authenticated SPA bundle.
- Asset cache-busting: bump the `?v=` query on `app.js`/`styles.css` (currently
  `v=10`) per the project's CF-edge-cache convention; the new shared page gets its
  own versioned assets.

## Security notes

- Passwords: scrypt + per-user salt + constant-time compare; never logged.
- Session + share + login tokens: `crypto.randomBytes`, never sequential/guessable.
- Share tokens are unlisted and unguessable; `/share/*` and `/api/share/*` set
  `X-Robots-Tag: noindex` and are excluded from any sitemap.
- Claim endpoints are unauthenticated by design but rate-limited (simple in-memory
  per-IP limiter) and claimer name length-capped to prevent abuse.
- All existing input sanitization (`str`/`num` caps) is retained and applied to new
  inputs.

## Testing (TDD)

Pure/unit-testable units written test-first:

- Password hash + verify (round-trip, wrong password, tampered hash).
- Session token mint/verify/expiry.
- `matchCatalog(recipient, catalog)` — dogs special case, budget ceiling, keyword
  overlap, cap.
- Ownership guard helper (recipient belongs / does not belong to user -> 404).
- Share token lifecycle (mint is idempotent, rotate invalidates old, disable clears).
- Claim add/release idempotency.

Integration smoke (inside the node:20 container, since better-sqlite3 cannot build
on local node v25): signup -> login -> create recipient (pool populated) -> list
private to user -> share -> public view -> claim visible.

## Deploy

- Local `~/christmas-app` -> rsync to `~/deploy/christmas` on BASTIAT ->
  `docker compose up -d --build christmas` (per existing project runbook).
- Start-fresh: the deploy wipes the `christmas_christmas-data` volume (the owner
  accepted losing existing data) so the new schema seeds clean.
- New env (all optional except none-required baseline): `SESSION_SECRET`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN`, `SMTP_HOST/PORT/USER/PASS/FROM`.
  Documented in `.llm-env.example` -> new `.env.example`.
- Push to `runsweetlew/christmas-list`.

## Open follow-ups (explicitly deferred, not in this build)

- Password reset email.
- Google/magic-link live credentials (owner to provide when ready).
- Per-item quantity on claims (for "wants 2 of these").
