# HikerAid - Claude Code context

## What this project is

Spring Boot 4.0.6 (Spring Framework 7, Jackson 3, Jakarta EE 11) mobile-first PWA for GPX route analysis with safety-first hiking features. Runs on port 8080 (or `$PORT` on Render).

**Live**: https://hikeraid.onrender.com

**Stack**: Java 21, H2 embedded database (file-based), Google OAuth2, Gemini AI (2.5-flash with 2.0-flash fallback), Resend.com email API, Leaflet 1.9.4, Chart.js 4.5.1, vanilla JS frontend.

**Architecture**: Single Thymeleaf page (`index.html`) + admin page (`admin.html`). Three CSS-toggled screens: `upload-screen`, `loading-screen`, `viewer-screen`. No JS framework - vanilla ES6 IIFEs. `app.js` orchestrates `map.js` and `elevation.js`.

## How to build and run

```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Optional: `GEMINI_API_KEY`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM`.

Note: All API keys must be set via environment variables. No hardcoded defaults.

Health check: `curl http://localhost:8080/api/health`

## Key files

| File | Purpose |
|---|---|
| `config/SecurityConfig.java` | Spring Security + OAuth2 config, endpoint permissions, logout (GET+POST via lambda matcher) |
| `service/GpxParserService.java` | XXE-safe DOM GPX parser; tracks, routes, waypoints, cadence extensions |
| `service/RouteAnalysisService.java` | All maths: Tobler time, safety analysis, difficulty, calories, gradient smoothing |
| `service/GeminiService.java` | Gemini AI client with model fallback chain (2.5-flash -> 2.0-flash), thinking model response parsing |
| `service/CustomOAuth2UserService.java` | Google login -> user creation/update, admin flag, auto-convert pending friend invites |
| `service/EmailService.java` | Resend.com HTTP API for sending emails |
| `controller/GpxApiController.java` | `POST /api/analyze` - main analysis endpoint |
| `controller/ActivityController.java` | CRUD `/api/activities` - user activity persistence |
| `controller/AdminController.java` | Admin dashboard, AI tester, email tester, env status, user/activity management |
| `controller/AiController.java` | `POST /api/ai-analysis`, `GET /api/ai-tip` |
| `controller/FriendController.java` | Friend management + emergency alerts: `/api/friends/**` |
| `controller/UserController.java` | `GET /api/user`, `GET /api/user/stats` |
| `entity/UserEntity.java` | JPA user (Google ID, email, name, avatar, admin flag) |
| `entity/ActivityEntity.java` | JPA activity (GPX data + all stats, linked to user) |
| `entity/FriendshipEntity.java` | JPA friendship (requester, addressee, status PENDING/ACCEPTED) |
| `entity/FriendInviteEntity.java` | JPA invite for non-registered email addresses |
| `static/js/app.js` | Upload, recording, auth, activities, friends, emergency, offline sync, AI, GPS tracking |
| `static/js/map.js` | Leaflet map, gradient segments, safety markers, GPS tracking |
| `static/js/elevation.js` | Chart.js elevation profile with gradient coloring |
| `static/sw.js` | Service worker - cache-first app shell, stale-while-revalidate tiles |

## Database

PostgreSQL on Render (persistent across deploys), H2 file-based for local dev. Tables auto-created via `ddl-auto=update`.

| Table | Key columns |
|---|---|
| `users` | id, google_id (unique), email, name, avatar_url, admin, created_at |
| `activities` | id, user_id (FK), name, gpx_data (CLOB), all stats fields, recorded_at |
| `friendships` | id, requester_id (FK), addressee_id (FK), status (PENDING/ACCEPTED), created_at |
| `friend_invites` | id, inviter_id (FK), invitee_email, created_at |

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/analyze` | public | Analyze GPX file (multipart) |
| GET | `/api/health` | public | Health check |
| GET | `/api/user` | public | Current auth status + profile |
| GET | `/api/user/stats` | user | Aggregated activity stats |
| GET | `/api/ai-tip` | public | Seasonal hiking tip from Gemini |
| POST | `/api/ai-analysis` | public | Route performance analysis from Gemini |
| GET/POST/DELETE | `/api/activities/**` | user | Activity CRUD (max 500/user, 15MB GPX) |
| GET | `/api/friends` | user | List friends, pending requests, invites |
| POST | `/api/friends/add` | user | Add friend by email (or send invite via Resend) |
| POST | `/api/friends/accept/{id}` | user | Accept pending friend request |
| DELETE | `/api/friends/{id}` | user | Remove friend |
| POST | `/api/friends/emergency` | user | Send emergency alert with coordinates + accuracy to all friends |
| GET | `/api/logout` | public | Logout (lambda matcher accepts GET+POST; Spring Security 7 removed AntPathRequestMatcher) |
| GET | `/admin` | admin | Admin panel page |
| GET | `/api/admin/stats` | admin | System stats |
| GET | `/api/admin/users` | admin | All users list |
| GET | `/api/admin/activities` | admin | Recent activities (100) |
| DELETE | `/api/admin/users/{id}` | admin | Delete user + activities |
| DELETE | `/api/admin/activities/{id}` | admin | Delete activity |
| POST | `/api/admin/test-ai` | admin | Test Gemini API connection |
| POST | `/api/admin/test-email` | admin | Send test email via Resend (accepts `{email}` body) |
| GET | `/api/admin/env-status` | admin | Environment variable status |

### Analyze params

| Param | Type | Default | Description |
|---|---|---|---|
| `file` | multipart | required | .gpx file (max 15 MB) |
| `weight` | double | 70 | Body weight kg (20-300) |
| `height` | double | 170 | Height cm (120-220) |
| `fitness` | int | 3 | 1=Beginner(0.6x) 2=Below avg(0.8x) 3=Average(1.0x) 4=Fit(1.15x) 5=Very fit(1.3x) |
| `startHour` | int | current | Start hour (0-23); frontend sends current time |
| `startMinute` | int | current | Start minute (0-59) |

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | **yes** | none | Google OAuth2 |
| `GOOGLE_CLIENT_SECRET` | **yes** | none | Google OAuth2 |
| `ADMIN_EMAIL` | no | empty | Email that gets admin role |
| `GEMINI_API_KEY` | no | empty | Gemini AI features |
| `RESEND_API_KEY` | no | hardcoded default | Resend.com email delivery |
| `RESEND_FROM` | no | `HikerAid <onboarding@resend.dev>` | Email sender address |

Note: Resend free tier without verified domain can only send to the account owner (`hikeraid@gmail.com`). Verify domain at resend.com/domains to send to any recipient.

## Important constants (RouteAnalysisService)

```java
MAX_GRADIENT_SEGMENTS = 2000
MAX_ELEVATION_PROFILE_POINTS = 500
MAX_TRACK_POINTS = 5000
ELEVATION_DEADBAND_M = 3.0
SAFETY_BUFFER_MINUTES = 30
```

Gradient smoothing: adaptive window (~50m), not fixed 5-point.

## Core algorithms

### Tobler's hiking function
```
speed = 6.0 * exp(-3.5 * |slope + 0.05|)   // clamped [0.3, 8.0] km/h
```
Do NOT change to Naismith's rule - Tobler is the intentional differentiator.

### Calorie estimate (uses height)
```
heightFactor = clamp(1.0 - (heightCm - 170) * 0.005, 0.85, 1.15)
flat    = weight * distKm * 0.7 * heightFactor
climb   = ascentM * weight * 0.01
descent = descentM * weight * 0.003
bmr     = (10*weight + 6.25*height - 200) / 24 * hours
total   = flat + climb + descent + bmr
```

### Difficulty score (0-100)
```
min(distKm*2, 40) + min(ascent/50, 40) + min(maxGrad/2.5, 20)
```
Easy(<10), Moderate(10-24), Hard(25-44), Very Hard(45-64), Extreme(65+).

### Gradient colours (keep in sync: map.js + elevation.js)
```
<-15% #0077B6 | <-8% #00B4D8 | <-2% #90E0EF | <+2% #74C69D
<+8% #B7E4C7 | <+15% #F9C74F | <+25% #F4A261 | >=25% #E76F51
```

## Email system

**Provider**: Resend.com HTTP API (`POST https://api.resend.com/emails`).
No SMTP. The `spring-boot-starter-mail` dependency is NOT used. Mail autoconfiguration is excluded in `application.properties`.

**Three email types**:
1. Friend invite - sent when adding a non-registered user by email
2. Emergency alert - sent to all accepted friends with GPS coordinates (lat/lon 7 decimal places + accuracy meters) and Google Maps link
3. Admin test - sent from admin panel Email tab

**Email template rules**: ASCII only in email bodies - no em dashes, no Unicode. Use plain hyphens. All emails include `https://hikeraid.onrender.com` link.

## Gemini AI integration

**Model fallback**: Tries `gemini-2.5-flash` first, falls back to `gemini-2.0-flash` on 503/server error. API key errors (401/403) stop immediately.

**Thinking model handling**: Gemini 2.5 Flash is a thinking model. Response `parts` array may contain thinking parts (with `thought: true`) before the actual text. `extractText()` iterates parts backwards, skipping thinking parts, to get the real output.

**Do NOT use `thinkingConfig`** at request top level - it's not a valid Gemini REST API field and causes silent 400 errors. Just set `maxOutputTokens` high enough (2048+ for tips, 4096 for analysis).

## GPS and emergency system

**`lastGpsPosition`**: Module-level variable in `app.js`, updated by both live tracking `watchPosition` and recording `watchPosition` callbacks.

**Emergency flow**:
1. If `lastGpsPosition` exists and is < 30s old, use it immediately (no extra GPS fix delay)
2. Otherwise, call `getCurrentPosition` with `maximumAge: 0` (guaranteed fresh fix), `timeout: 15000`
3. POST to `/api/friends/emergency` with `{latitude, longitude, accuracy}`
4. Backend sends email to each accepted friend via Resend with formatted coordinates, accuracy, and Google Maps link

## Security

- XXE prevention: 3 `setFeature` calls + `setExpandEntityReferences(false)` in GpxParserService
- XSS: all user content via `textContent`/DOM API, never `innerHTML`
- CSRF: disabled for `/api/**`, mitigated by SameSite=Lax
- IDOR: activity + friendship endpoints verify user ownership
- Credentials: env vars only, never in source (except default API keys for dev convenience)
- Activity limits: 15MB GPX, 500 per user
- Admin: manual `isAdmin()` check in AdminController
- Error messages: generic, no stack traces
- Logout: lambda `RequestMatcher` accepting any HTTP method (Spring Security 7 removed `AntPathRequestMatcher`)

## Things to preserve

- `renderer: L.canvas()` on Leaflet map - critical for 2000+ gradient polylines
- XXE prevention in GpxParserService - the three `setFeature` calls
- Elevation deadband (3m) in `computeElevationGainLoss`
- Safety buffer 30 min before sunset (`SAFETY_BUFFER_MINUTES`)
- PWA share target in `manifest.json`
- Gradient colours must match in both `map.js` and `elevation.js`
- Jackson 3 imports: `tools.jackson.databind` (not `com.fasterxml`)
- `spring.autoconfigure.exclude=...MailSenderAutoConfiguration` - prevents startup failure (no SMTP configured)
- Admin panel JS: use `\uXXXX` escape sequences for Unicode chars in `textContent` calls, not raw Unicode or HTML entities
- Email bodies: ASCII only, no em dashes or Unicode chars (cause garbled `?` in plain text emails)
- Gemini: iterate response parts backwards to skip thinking model reasoning
- Logout: lambda matcher, not `AntPathRequestMatcher` (removed in Spring Security 7)

## Frontend structure (app.js)

The upload screen has three sections visible when logged in:
1. **User panel** (`#user-panel`): avatar, name, email, admin badge, logout, sync button, stats grid (5 colored cards: hikes/km/climbed/kcal/friends)
2. **User content** (`#user-content`): tabbed card with "My Activities" and "Friends" tabs. Tab switching via `.uc-tab` click handlers
3. **AI tip card** (`#ai-tip-card`): seasonal hiking tip from Gemini, or "API key required" message

State variables: `routeData`, `currentGpxText`, `currentUser`, `gpsWatchId`, `isTracking`, `lastGpsPosition`, `hasFriends`, recording state vars.

## Deployment

- **Render**: auto-deploys from GitHub `main` branch via `render.yaml`
- **Docker**: multi-stage build in `Dockerfile` (JDK 21 build -> JRE 21 Alpine)
- **CI**: GitHub Actions `.github/workflows/ci.yml` builds on push/PR
- **Secrets**: GitHub Secrets for CI, Render env vars for production, Windows user env vars for local dev
- **Live URL**: https://hikeraid.onrender.com (Render free tier, cold starts ~30s)

## Past issues and fixes (avoid repeating)

| Issue | Root cause | Fix |
|---|---|---|
| AI tip truncated mid-sentence | `thinkingConfig` at top level caused 400; thinking tokens consumed `maxOutputTokens` | Remove `thinkingConfig`, increase `maxOutputTokens`, parse parts backwards |
| Emails not delivered (SMTP) | Gmail SMTP auth issues, silent exception swallowing | Switched to Resend.com HTTP API |
| Garbled chars in emails (`?`) | Em dash (U+2014) in plain text body | ASCII only in email templates |
| Logout broken | Spring Security 7 removed `AntPathRequestMatcher`, GET not matched | Lambda `RequestMatcher` matching any method |
| Admin panel shows raw `&#NNNN;` | `textContent` doesn't render HTML entities | Use `\uXXXX` JS escape sequences |
| Gemini 503 "high demand" | Single model, no fallback | Model chain: 2.5-flash -> 2.0-flash |
| User stats not visible | Stats in subtle inline row, hidden when 0 activities | Colored card grid, always visible |
