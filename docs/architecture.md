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
                        |                               +-----------------------------+
                        |                                          |
            +-----------+------------+                  +----------+----------+
            |                        |                  |                     |
       IndexedDB                Cache Storage     PostgreSQL/H2          External APIs
       (pending acts +          (app shell +      (users, activities,    Gemini 2.5/2.0 Flash
        photos store)            map tiles)        friends, invites)      Open-Meteo (no key)
                                                                          Resend.com email
                                                                          Mapzen DEM tiles
                       Lazy-loaded:                                       (3D terrain)
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
  -> Frontend renders current strip, 12 h forecast row, coloured risk banner
```

### Offline Tile Pre-Download
```
User clicks "Download for offline":
  -> Compute route bbox with 10% padding
  -> Enumerate (z, x, y) tiles for zoom 11-15 up to MAX 2500
  -> Quota check: navigator.storage.estimate()
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

### Authentication
```
User clicks "Sign in with Google"
  -> Redirect to /oauth2/authorization/google
  -> Google consent
  -> Callback to /login/oauth2/code/google
  -> CustomOAuth2UserService.loadUser()
     -> Find or create UserEntity by Google sub
     -> Set admin flag if email matches ADMIN_EMAIL
     -> Convert any pending FriendInvites into FriendshipEntity (PENDING)
  -> Session cookie set, redirect to /
```

### AI Performance Analysis
```
User clicks AI button -> POST /api/ai-analysis with {name, stats, safety}
  -> GeminiService builds structured prompt
  -> Try gemini-2.5-flash, fallback to gemini-2.0-flash on 5xx
  -> Extract text from candidate parts (iterate backwards, skip 'thought' parts)
  -> Return text -> frontend renders as markdown in slide-in panel
```

## Data Model

### users
| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | |
| google_id | VARCHAR(255) UNIQUE | OAuth `sub` claim |
| email | VARCHAR(255) | From Google |
| name | VARCHAR(255) | Display name |
| avatar_url | VARCHAR(512) | Google profile picture URL |
| admin | BOOLEAN | True when email matches ADMIN_EMAIL |
| created_at | TIMESTAMP | First login |

### activities
| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | |
| user_id | BIGINT FK | |
| name | VARCHAR(255) | Route name from GPX |
| recorded_at | TIMESTAMP | When saved |
| gpx_data | CLOB | Full GPX XML, max 15 MB |
| distance_km, elevation_gain_m, elevation_loss_m, max_elevation_m, min_elevation_m | DOUBLE | Denormalized stats |
| moving_time_minutes, total_time_minutes | BIGINT | |
| calories | DOUBLE | |
| difficulty | VARCHAR(32) | "Easy" / "Hard" / ... |
| difficulty_score | INTEGER | 0-100 |
| avg_speed_kmh | DOUBLE | |
| **start_lat, start_lon, end_lat, end_lon** | DOUBLE | For route matching; back-filled lazily on first comparison query |

### friendships
| Column | Type |
|---|---|
| id | BIGINT PK |
| requester_id | BIGINT FK |
| addressee_id | BIGINT FK |
| status | VARCHAR ("PENDING" / "ACCEPTED") |
| created_at | TIMESTAMP |

### friend_invites
| Column | Type |
|---|---|
| id | BIGINT PK |
| inviter_id | BIGINT FK |
| invitee_email | VARCHAR(255) |
| created_at | TIMESTAMP |

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
| Error responses | Generic messages, no stack traces leaked |
| Logout | Lambda `RequestMatcher` accepts any HTTP method (Spring Security 7 removed `AntPathRequestMatcher`) |

## Frontend Module Map

| File | Responsibility |
|---|---|
| `app.js` | State management, screen switching, file upload, GPS recording, auth, activity CRUD, offline sync (IndexedDB), AI panel, weather panel, splits panel, theme toggle, playback, photo capture, 3D toggle, offline tile downloader |
| `map.js` | Leaflet init, gradient polyline rendering, waypoint markers, safety markers, GPS tracking, layer switching, photo markers |
| `elevation.js` | Chart.js elevation profile, gradient-coloured segments, hover sync, programmatic highlight for playback |
| `sw.js` | App shell network-first; tile cache stale-while-revalidate with subdomain normalization; MessageChannel API for clear/size; background-sync handler |

## Key Design Decisions

1. **Tobler over Naismith** — slope-aware time estimation is the core differentiator.
2. **Elevation deadband (3 m)** — eliminates 20-40 % spurious gain from GPS noise.
3. **`L.canvas()` renderer** — required for performance with 2000+ gradient polylines.
4. **Server-side analysis** — all heavy maths on the backend; frontend is display-only.
5. **PostgreSQL on Render, H2 in local/test** — same JPA layer; switch driven by env vars.
6. **IndexedDB offline queue + background-sync** — activities saved offline reach the server when the network returns, even if the user has closed the tab.
7. **Lazy-loaded MapLibre** — 3D terrain stays out of the initial bundle until the user actually toggles it on.
8. **MessageChannel for SW comms** — avoids listener accumulation that would happen with `addEventListener('message', ...)` on every operation.
9. **LinkedHashMap LRU for weather cache** — bounded memory without bringing in a cache library.
10. **Vanilla JS, no framework** — keeps the bundle small and the moving parts few. Module pattern with namespaces.

## Environment Variables

See [deployment.md](deployment.md#environment-variables).
