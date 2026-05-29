# Agentic Development History

A running log of major Claude-driven changes to HikerAid, with the
lessons that surfaced. Useful for future sessions (to avoid re-treading
the same ground) and for humans curious about how the project evolved.

## 2026-05-29 — Comment-free refactor, live turn-back, always-on SOS, project skills

Stripped all explanatory comments from `src/main` (keeping the XXE and
test-visibility markers), added **live turn-back guidance** to GPS tracking,
made the **emergency SOS button always-on** for signed-in users, fixed a false
"no internet" emergency report, and committed three project skills
(`/bump-cache-version`, `/strip-comments`, `/release-checklist`).

**Lessons.**
- **Don't strip comments with naive regex.** A string- and regex-aware
  character scanner (`/strip-comments`) is the only safe way — a blunt regex
  would have mangled `https://` URLs in strings and JS `/regex/` literals. The
  scanner is idempotent, so it doubles as a guard in `/release-checklist`.
- **Extend the data, compute on the client.** Live turn-back reuses the
  forward/reverse Tobler arrays already computed for `computeSafety`; the server
  just downsamples and returns them aligned to `trackPoints`, and the browser
  does the per-fix recompute — no new endpoint, works offline.
- **`navigator.onLine` is a liar.** It reported a notebook as offline and the
  emergency flow bailed to an SMS modal titled "No internet" while the server
  was perfectly reachable. Fix: always attempt the request; only the genuine
  `fetch` failure path mentions connectivity, and the fallback title is now set
  from the real cause (no contacts / alerts unavailable / unreachable).
- **Bump the cache version every frontend change.** Did it four times by hand
  (v18→v21) before extracting it into a skill — exactly the repetitive,
  easy-to-forget task a skill should own.

## 2026-05-28 — Phase 1-3: ten features in one sitting

Added a light theme, richer analytics (VAM/GAP/splits), route playback,
weather integration, offline tile pre-download, offline-first activity
sync, route comparison + PR badges, emergency SMS fallback, photo
waypoints, and 3D terrain via MapLibre.

**Approach.** Single conversation, ten phased tasks tracked via
`TaskCreate`. Each phase built and compiled clean before moving on.
After Phase 3 finished, an extra-high `/code-review` pass surfaced 15
findings; the eight most severe were fixed before commit.

**Lessons.**
- **Phase the work.** Doing all ten as one giant commit would have been
  un-reviewable. Splitting into phases let the build verify after each
  one and made debugging trivial.
- **Compile early, compile often.** Catching record signature changes
  (added two fields to `RouteStats`) the moment the file was saved
  prevented downstream confusion.
- **Use the code-review skill before committing.** It found:
  - SW message listeners stacking on repeated panel opens
  - Per-activity save inside a loop (500 DB writes on first load)
  - Race condition on async comparison fetch + route switch
  - Stale GPS used for photo timestamps
  - MapLibre CSS link duplicated on retry
- **Don't normalize cache keys without bumping the cache name.** The SW
  switched tile cache key scheme (subdomain → `z.`); existing cache
  entries no longer matched. The cache version bump (v1 → v2) wiped
  them, which is correct but worth flagging.

## 2026-05-27 — README, ARCHITECTURE, DEPLOYMENT docs refresh

Added a comprehensive top-level README, plus standalone ARCHITECTURE and
DEPLOYMENT docs. (Later moved into `docs/` — see the 2026-05-28 reorg.)

## Earlier — PostgreSQL migration

Migrated from H2 file-based to PostgreSQL on Render to get persistence
across deploys. Required:
- `DatabaseConfig` to translate Render's `postgres://` URL to JDBC's
  `jdbc:postgresql://` form
- Dialect selection per database
- Render blueprint (`render.yaml`) to auto-provision a PostgreSQL DB

## Earlier — Gemini integration with model fallback

`GeminiService` tries `gemini-2.5-flash` first, falls back to
`gemini-2.0-flash` on 5xx. API-key errors stop immediately.

**Footgun discovered the hard way.** Don't set `thinkingConfig` at the
top level of a Gemini request — the 2.5-flash REST API silently
rejects it (no error, just empty output). The thinking model's
"thought" parts also need to be skipped when extracting text (iterate
parts backwards).

## Earlier — Resend.com for email

Replaced Gmail SMTP (which silently failed under various Gmail security
states) with Resend.com's HTTP API. Spring's `MailSenderAutoConfiguration`
is excluded in `application.properties` to prevent startup failure when
no SMTP is configured.

Email bodies are ASCII only — em dashes and Unicode caused garbled `?`
characters in plain-text rendering.

## Earlier — Spring Security 7 logout

Spring Security 7 removed `AntPathRequestMatcher`, breaking the old
GET-friendly logout config. Fix: lambda `RequestMatcher` that accepts
any HTTP method.

## Conventions established along the way

- Cache busting via `?v=N` query string on CSS/JS, mirrored by
  `CACHE_NAME = 'hikerAid-vN'` in the service worker. Bumped together.
- Dark theme variables in `:root`, light theme as `[data-theme="light"]`
  overrides — no `prefers-color-scheme` media queries inside component
  rules.
- `tools.jackson.*` imports throughout — never `com.fasterxml.*` (Spring
  Boot 4 / Jackson 3).
- Lazy-load heavy assets (MapLibre) only when the user asks for them.
- Surface offline limitations honestly: pending cards show "Will sync"
  badges, emergency falls back to `sms:` deep-links.
