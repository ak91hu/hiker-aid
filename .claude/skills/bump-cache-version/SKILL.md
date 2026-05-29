---
name: bump-cache-version
description: Bump HikerAid's PWA cache-busting version. Use after editing any frontend asset (templates/index.html, static/css/style.css, static/js/*.js, static/sw.js) so returning visitors get the new build instead of a stale service-worker cache. Increments the ?v=N query string on the CSS and JS includes in index.html and the CACHE_NAME in sw.js, keeping them in sync.
---

# Bump cache version

HikerAid is a PWA. The service worker (`src/main/resources/static/sw.js`)
caches the app shell under `CACHE_NAME`, and `index.html` cache-busts its
CSS/JS with a `?v=N` query string. Ship a frontend change without bumping
these and returning users keep the cached old build.

## Steps

1. Find the current version `N` (these are always equal):
   - `CACHE_NAME = 'hikerAid-vN'` in `src/main/resources/static/sw.js`
   - `?v=N` on the `style.css` link and the `app.js` script in
     `src/main/resources/templates/index.html`
2. Increment `N` by one in all three places:
   - `index.html`: `/css/style.css?v=N+1` and `/js/app.js?v=N+1`
   - `sw.js`: `CACHE_NAME = 'hikerAid-v(N+1)'`
3. Do NOT touch `TILE_CACHE` — bump that only when the tile-cache *key scheme*
   changes, not on ordinary asset edits.
4. Verify they match:
   ```bash
   grep -n "css/style.css?v=\|app.js?v=" src/main/resources/templates/index.html
   grep -n "CACHE_NAME =" src/main/resources/static/sw.js
   ```

## Notes
- Only `app.js` is version-tagged in `index.html`; `map.js`/`elevation.js`
  are pulled in via the app shell and are covered by the `CACHE_NAME` bump.
- One increment per shippable change is enough — no need to bump per file.
