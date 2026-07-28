# Architecture

## System Overview

```
                    Browser (PWA)                           Server (Spring Boot 4.0.6)
              +------------------------+                +-----------------------------+
              | index.html (Thymeleaf) |                | GpxApiController            |
              | app.js                 |    REST/JSON   | ActivityController          |
              | map.js   (Leaflet)     | <============> | WeatherController           |
              | elevation.js (Chart.js)|                | AdminController             |
              | sw.js    (offline)     |                | AiController                |
              | manifest.json          |                | UserController              |
              +------------------------+                | FriendController            |
                        |                               | TrackingController          |
                        |                               | PublicController            |
                        |                               | RoutePlannerController      |
                        |                               | OverdueAlertService (@Sched)|
                        |                               +-----------------------------+
                        |                                          |
            +-----------+------------+                  +----------+----------+
            |                        |                  |                     |
       IndexedDB                Cache Storage     PostgreSQL/H2          External APIs
       (pending acts +          (app shell +      (users, activities,    Gemini 2.5/2.0 Flash
        photos store)            map tiles)        friends, invites,      Open-Meteo (no key)
                                                   tracking_sessions)     Resend.com email
                                                                          BRouter (routing, no key)
                       Lazy-loaded:                                       Mapzen DEM tiles (3D)
                       - MapLibre GL JS (3D terrain)
                       - Camera capture (compress -> IndexedDB)
```

## Request Flows

### GPX Analysis
```
User uploads .gpx -> POST /api/analyze (multipart)
  -> GpxApiController validates (size, extension, weight range)
  -> GpxParserService.parse() — XXE-safe DOM parsing
  -> RouteAnalysisService.analyzeWithWeight()
     -> cumulative distance (haversine)
     -> elevation gain/loss (3 m deadband filter)
     -> gradient + adaptive smoothing window (~50 m)
     -> Tobler time x fitness pace factor
     -> rest breaks (10 min/h for hikes > 1 h)
     -> difficulty score (0-100)
     -> calorie estimate (height + weight + BMR)
     -> VAM, GAP, per-km splits
     -> safety analysis (sunset, turnaround, point of no return)
     -> subsample track/gradient/profile for the wire
  -> AnalysisResult JSON
```

### Activity Save & Route Comparison
```
User clicks Save -> POST /api/activities (JSON)
  -> ActivityController persists ActivityEntity
  -> Regex-extracts start/end coords from gpxData (TRKPT_PATTERN)
  -> Returns { id }
  -> Client (post-recording flow) links any session photos via IndexedDB

User opens a saved activity:
  -> GET /api/activities/{id}/comparisons
     -> Lazy-backfills missing start/end for legacy rows (batched saveAll)
     -> Filters past activities by Haversine endpoints, distance, gain
     -> Sorts by movingTimeMinutes; flags Personal Best if current is fastest
  -> Frontend renders "vs You" stat card + banner inside Splits panel
```

### Weather
```
User opens Weather panel:
  -> GET /api/weather?lat=X&lon=Y
  -> WeatherService checks LRU cache (512-entry, 1 h TTL)
  -> On miss: RestTemplate -> https://api.open-meteo.com/v1/forecast
     -> Parse current + 24h hourly via Jackson
     -> Apply risk heuristics (thunderstorm, wind, precip, temp -> OK/CAUTION/DANGER)
  -> Frontend renders current strip, 12 h forecast row, colored risk banner
```

### 3D Terrain & Avalanche Slope Shading
```
User toggles 3D View:
  -> Lazy-loads MapLibre GL JS v5.1.0 & CSS on demand
  -> Initializes MapLibre map with Mapzen Terrarium DEM raster-dem tiles
  -> Builds GeoJSON FeatureCollection of slope segments from analyzed track points
  -> Classifies segment hazard by slope angle:
     - Green (#2EA043): slope < 15° (Low risk / safe)
     - Orange (#D97706): 15° <= slope <= 30° (Moderate risk)
     - Red (#DC2626): slope > 30° (High / Avalanche hazard zone)
  -> Adds GeoJSON line-layer with 3D terrain elevation exaggeration (1.5x) and 60° pitch
```

### Offline Tile Pre-Download & Storage Quota
```
User clicks "Download for offline":
  -> Compute route bbox with 10% padding
  -> Enumerate (z, x, y) tiles for zoom 11-15 up to MAX 2500
  -> Quota check: navigator.storage.estimate() verifies available quota
  -> Worker pool (8 concurrent fetches) hits each tile URL
  -> SW intercepts in tileStrategy(), normalizes a/b/c subdomain rotation
     to a single cache key, stores in TILE_CACHE
  -> Live progress bar; cancellable; cache-size readout via MessageChannel
```

### Offline-First Activity Sync
```
User saves while offline:
  -> saveActivity() detects !navigator.onLine or fetch fails
  -> addPending() stores in IndexedDB (pendingActivities)
  -> requestBackgroundSync() registers 'sync-activities'
  -> Pending card appears in activity list immediately

Network returns:
  -> SW 'sync' event fires -> notifyClientsToSync() posts SYNC_ACTIVITIES
  -> visibilitychange fallback for iOS (no background-sync)
  -> Client syncPendingActivities() POSTs each pending entry
  -> Photo cursor links session photos to the new activityId
  -> Remove from IndexedDB on success
```

### Resource Optimization & JVM Container Architecture
```
Container Host (e.g. Render Free Tier 512 MB RAM):
  -> Java 21 JRE Alpine base image (eclipse-temurin:21-jre-alpine)
  -> JVM Runtime Arguments:
     -XX:+UseSerialGC              (minimal GC thread memory footprint)
     -XX:MaxRAMPercentage=75.0     (heap capped to ~384 MB on 512 MB host)
     -XX:MaxMetaspaceSize=128m     (metaspace memory cap)
     -XX:+TieredCompilation        (fast JIT compilation)
     -XX:TieredStopAtLevel=1       (reduces JIT compiler memory overhead)
     -Xss512k                      (reduced stack size per thread)
     -XX:+ExitOnOutOfMemoryError   (immediate container restart on OOM)
  -> HTTP Compression & Caching:
     server.compression.enabled=true (GZIP for JSON/HTML/CSS/JS > 1024 B)
     spring.web.resources.cache.cachecontrol.max-age=7d (7-day static cache)
```

## Security Model

| Layer | Mechanism |
|---|---|
| XML parsing | `DocumentBuilderFactory` disables DOCTYPE + external entities + entity expansion |
| User-rendered text | DOM API only (`textContent`), never `innerHTML` |
| Authentication | Spring Security OAuth2 with Google as the sole provider |
| Authorization | `authenticated()` for user endpoints; manual `isAdmin()` check for admin endpoints |
| IDOR | Activity and friendship endpoints verify ownership against the session user |
| CSRF | Disabled for `/api/**`; mitigated by SameSite=Lax session cookies |
| Secrets | Read from environment variables; never in source or version control |
| Rate / size limits | 15 MB GPX cap; 500 activities per user |
| Emergency endpoint | Requires at least one accepted friend; coordinates validated; accuracy reported |
| Live tracking | `/api/track/**` owner-checked; public read (`/api/public/track/{token}`) exposes only first name + last position, never a synthesized point |
| Share / live tokens | Unguessable `SecureRandom` 12-byte URL-safe tokens; owner can revoke share tokens |
| Route planner proxy | `/api/route/plan` calls a fixed upstream (BRouter) with server-built, range-validated params — not a general open proxy |
| Error responses | Generic messages, no stack traces leaked |
| Logout | Lambda `RequestMatcher` accepts any HTTP method (Spring Security 7 removed `AntPathRequestMatcher`) |

## Frontend Module Map

| File | Responsibility |
|---|---|
| `app.js` | State management, screen switching, file upload, GPS recording, auth, activity CRUD, offline sync (IndexedDB), AI panel, weather panel, splits panel, multi-day panel, theme toggle, playback, photo capture, 3D toggle, offline tile downloader, route planner, live-share + public live/share viewers, personal-pace toggle, off-route warning, printable card |
| `map.js` | Leaflet init, gradient polyline rendering, waypoint markers, safety markers, GPS tracking, layer switching, photo markers, distance-to-route (deviation), clear-route (planner) |
| `elevation.js` | Chart.js elevation profile, gradient-colored segments, hover sync, programmatic highlight for playback |
| `sw.js` | App shell network-first; tile cache stale-while-revalidate with subdomain normalization; MessageChannel API for clear/size; background-sync handler |

## Key Design Decisions

1. **Tobler over Naismith** — slope-aware time estimation is the core differentiator.
2. **Elevation deadband (3 m)** — eliminates 20-40 % spurious gain from GPS noise.
3. **`L.canvas()` renderer** — required for performance with 2000+ gradient polylines.
4. **Server-side analysis** — all heavy maths on the backend; frontend is display-only.
5. **PostgreSQL on Render, H2 in local/test** — same JPA layer; switch driven by env vars.
6. **IndexedDB offline queue + background-sync** — activities saved offline reach the server when the network returns, even if the user has closed the tab.
7. **Lazy-loaded MapLibre & GeoJSON 3D Avalanche Shading** — 3D terrain and slope hazard overlay stay out of the initial bundle until the user toggles 3D view.
8. **MessageChannel for SW comms** — avoids listener accumulation that would happen with `addEventListener('message', ...)` on every operation.
9. **LinkedHashMap LRU for weather cache** — bounded memory without bringing in a cache library.
10. **Vanilla JS, no framework** — keeps the bundle small and the moving parts few. Module pattern with namespaces.
11. **No fabricated data** — only real measured or transparently computed values; explicit empty states ("no fix yet", `calibrated:false`) instead of guesses. Heart rate is intentionally omitted (not measured).
12. **UTC `Instant`s for tracking timestamps** — check-in/overdue comparisons and live-page display are timezone-correct regardless of server (UTC on Render) or device zone.
13. **BRouter proxied server-side, no key** — snap-to-trail routing without CORS issues or an API key, consistent with the env-vars-only rule.
14. **`@Scheduled` overdue alerts** — a single in-process scheduler (`@EnableScheduling`) checks active sessions every 60 s; the sent-flag is set before emailing so failures can't spam.
15. **Personal pace cached by activity count** — `/api/user/pace` parses GPX only when the user's activity set changes, keeping the dashboard load cheap.
16. **Container resource tuning** — Serial GC and a 75% `MaxRAMPercentage` reduce JVM overhead on memory-constrained hosts; platform monitoring and load testing remain necessary.

## Environment Variables

See [deployment.md](deployment.md#environment-variables).
