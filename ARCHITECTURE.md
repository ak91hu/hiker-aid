# HikerAid Architecture

## System Overview

```
Browser (PWA)                    Server (Spring Boot 4.0.6)
+-----------------+              +---------------------------+
| index.html      |   REST/JSON  | GpxApiController          |
| app.js          | <==========> | ActivityController        |
| map.js (Leaflet)|              | AdminController           |
| elevation.js    |              | AiController              |
| sw.js (offline) |              | UserController            |
+-----------------+              +---------------------------+
       |                                    |
  IndexedDB                          +------+------+
  (offline queue)                    |             |
                              H2 Database    Gemini API
                              (./data/)      (2.5 Flash)
```

## Request Flow

### GPX Analysis
```
User uploads .gpx → POST /api/analyze (multipart)
  → GpxApiController validates (size, extension, weight range)
  → GpxParserService.parse() — XXE-safe DOM parsing
  → RouteAnalysisService.analyzeWithWeight()
    → cumulative distance (haversine)
    → elevation gain/loss (3m deadband filter)
    → gradient computation + adaptive smoothing
    → Tobler time estimate × pace factor
    → rest breaks (10 min/hour for hikes > 1h)
    → difficulty score (0-100)
    → calorie estimate (height + weight + BMR)
    → safety analysis (sunset, turnaround, PNR)
    → subsample track/gradient/profile for frontend
  → Return AnalysisResult JSON
```

### Authentication
```
User clicks "Sign in with Google"
  → Redirect to /oauth2/authorization/google
  → Google consent screen
  → Callback to /login/oauth2/code/google
  → CustomOAuth2UserService.loadUser()
    → Find or create UserEntity by Google ID
    → Set admin flag if email matches ADMIN_EMAIL env var
    → Save to H2
  → Session cookie set
  → Redirect to /
```

### Offline Sync
```
User saves activity while offline:
  → saveActivity() detects !navigator.onLine or fetch fails
  → Activity data stored in IndexedDB (pendingActivities store)
  → Sync badge shows pending count

User comes back online:
  → window 'online' event fires
  → syncPendingActivities() iterates IndexedDB queue
  → POST each to /api/activities
  → Delete from IndexedDB on success
  → Refresh activity list
```

### AI Analysis
```
User clicks AI button in viewer:
  → POST /api/ai-analysis with {name, stats, safety}
  → GeminiService builds structured prompt with route data
  → POST to Gemini 2.5 Flash API
  → Parse response candidates[0].content.parts[0].text
  → Return to frontend → render as markdown in slide-in panel
```

## Data Model

### UserEntity
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | Auto-increment PK |
| google_id | VARCHAR(255) | Unique, from OAuth `sub` claim |
| email | VARCHAR(255) | From Google profile |
| name | VARCHAR(255) | Display name |
| avatar_url | VARCHAR(512) | Google profile picture |
| admin | BOOLEAN | Set when email matches ADMIN_EMAIL |
| created_at | TIMESTAMP | First login time |

### ActivityEntity
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | Auto-increment PK |
| user_id | BIGINT | FK to users |
| name | VARCHAR(255) | Route name from GPX |
| gpx_data | CLOB | Full GPX XML (max 15MB enforced in controller) |
| recorded_at | TIMESTAMP | When saved |
| distance_km, elevation_gain_m, ... | DOUBLE/LONG | Denormalized stats for list display |

## Security Model

| Layer | Mechanism |
|---|---|
| XML parsing | XXE disabled via DocumentBuilderFactory features |
| User content | DOM API (textContent), never innerHTML |
| Authentication | Spring Security OAuth2 with Google |
| Authorization | `authenticated()` for user endpoints, manual `isAdmin()` for admin |
| CSRF | Disabled for /api/** (SameSite=Lax cookie mitigates) |
| Secrets | Environment variables only; .gitignore excludes local overrides |
| Rate limiting | Activity count cap (500/user), GPX size cap (15MB) |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth2 client secret |
| `GEMINI_API_KEY` | No | Gemini AI features (tip + route analysis) |
| `ADMIN_EMAIL` | No | Email that gets admin flag on login |
| `PORT` | No | Server port (default 8080, set by Render) |

## Frontend Module Responsibilities

| Module | Responsibility |
|---|---|
| `app.js` | State management, screen switching, file upload, GPS recording, auth flow, activity CRUD, offline sync queue (IndexedDB), AI panel, export |
| `map.js` | Leaflet map init, gradient polyline rendering, waypoint markers, start/end markers, safety markers (turnaround/PNR), GPS position tracking, layer switching |
| `elevation.js` | Chart.js elevation profile, gradient-colored segments, hover sync with map cursor |
| `sw.js` | Cache-first app shell, stale-while-revalidate map tiles, network-only API calls |

## Key Design Decisions

1. **Tobler over Naismith** — slope-aware time estimation is the core differentiator
2. **Elevation deadband** — 3m threshold prevents GPS noise from inflating gain/loss by 20-40%
3. **Canvas renderer** — `L.canvas()` required for rendering 2000+ gradient polylines without lag
4. **Server-side analysis** — all heavy computation on backend; frontend is display-only
5. **H2 file-based** — zero-config persistence; easy migration to PostgreSQL if needed
6. **IndexedDB offline queue** — activities saved offline sync automatically on reconnect
7. **Current time as start time** — removed manual input; always uses `new Date()` for safety calculations
