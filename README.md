# HikerAid

[![CI](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml/badge.svg)](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-Render-46E3B7?logo=render)](https://hikeraid.onrender.com)
[![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.0.6-6DB33F?logo=spring-boot&logoColor=white)](https://spring.io/projects/spring-boot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa&logoColor=white)](#pwa--offline)

**Know when to turn back.** Safety-first GPX route analysis with turnaround time, daylight margin, point of no return, and fitness-personalized Tobler time estimates.

### [Live Demo](https://hikeraid.onrender.com)

> Free. No paywall. Works offline. Sign in with Google to save activities.
>
> *First load may take ~30s if the server is asleep (free tier).*

---

## Features

### Safety Analysis
- **Daylight margin** — how much spare time before dark (green/amber/red indicator)
- **Turnaround point** — furthest you can hike and still make it back before sunset, marked on the map
- **Point of no return** — where continuing forward becomes faster than going back
- **Sunset estimate** — calculated from route latitude and day of year with DST adjustment
- **30-minute safety buffer** — built into all daylight calculations

### Personalized Time Estimates
- **Fitness-adjusted pace** — five levels that scale Tobler's hiking function
- **Rest breaks included** — 10 min/hour for hikes over 1 hour
- **Moving time vs total time** — hover the time card for moving-only estimate

| Fitness Level | Pace Factor | Effect on Time |
|---|---|---|
| Beginner | 0.6x | +67% slower |
| Below average | 0.8x | +25% slower |
| Average | 1.0x | Baseline |
| Fit | 1.15x | 13% faster |
| Very fit | 1.3x | 23% faster |

### Route Analysis
- **Tobler's hiking function** — slope-aware time estimation, not just flat distance
- **Gradient-coloured map** — 8-colour scale from steep downhill to extreme uphill
- **Elevation profile** — interactive Chart.js chart with per-segment gradient colouring, synchronized map cursor on hover
- **Elevation deadband** — 3m threshold filters GPS noise from ascent/descent totals
- **Difficulty scoring** — composite 0-100 score from distance, ascent, and max gradient
- **Calorie estimate** — accounts for flat terrain, climbing, and descent (eccentric work)
- **Heart rate display** — avg/max HR when GPX contains Garmin/TrackPointExtension data
- **Waypoints** — parsed and displayed with type-specific icons
- **Adaptive gradient smoothing** — window scales with GPS point density (~50m)

### GPS Recording
- **Record a hike** — live GPS track recording with real-time distance, time, and elevation
- **Download as GPX** — export recorded track as standard GPX 1.1
- **Analyze after recording** — recorded tracks get the same full analysis as uploaded files

### Activity History (requires Google sign-in)
- **Save activities** — save any analyzed route (uploaded or recorded) with one click
- **Activity list** — all saved activities with summary stats on the home screen
- **Re-analyze** — click any saved activity to view full analysis with current settings
- **Delete** — remove activities with confirmation

### Hiking Friends & Emergency Alerts (requires Google sign-in)
- **Add friends by email** — if registered, sends a friend request; if not, sends an invite email via Resend.com with a direct link to the app
- **Auto-connect on signup** — when an invited person registers, the friendship is created automatically
- **Friend requests** — accept or decline incoming friend requests
- **Emergency button** — visible during live GPS tracking when you have friends; sends your current GPS coordinates to all friends via email
- **Emergency email** — includes latitude (7 decimal places), longitude, GPS accuracy radius, and a direct Google Maps link
- **Smart GPS** — uses live tracking position when available (no extra fix delay); falls back to fresh `getCurrentPosition` with `maximumAge: 0` when not tracking

### PWA / Offline
- **Installable** — add to home screen on Android/iOS/desktop
- **Works offline** — service worker caches app shell and map tiles
- **Share target** — receive .gpx files from the OS share sheet on Android
- **Live GPS tracking** — follow your position on a loaded route in real time
- **Multiple map layers** — Streets, Topo, Satellite, Dark

### AI Performance Analysis (Gemini)
- **Route coaching** — personalized performance summary, key risks, actionable recommendations, and training tips
- **Seasonal hiking tips** — AI-generated safety insight on the homepage, refreshed each visit
- **Context-aware** — AI receives distance, elevation, gradient, difficulty, fitness level, and safety data for targeted advice

### Export
- **Download summary** — text file with all stats + safety analysis
- **Download GPX** — export recorded or uploaded route as .gpx file

---

## Quick Start

### Prerequisites

- Java 21+
- Maven 3.8+
- Google OAuth2 credentials ([setup instructions below](#google-oauth-setup))
- Gemini API key ([get one free](https://aistudio.google.com/apikey))
- Resend.com API key ([free tier: 100 emails/day](https://resend.com)) for friend invites and emergency alerts

### Build and Run

```bash
mvn clean package -DskipTests
java -jar target/hikerAid-1.0.0.jar
```

Open [http://localhost:8080](http://localhost:8080)

Health check: `curl http://localhost:8080/api/health`

---

## Deploy to Render (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ak91hu/hiker-aid)

1. Click the button above, sign in with GitHub
2. Render prompts for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — paste your values
3. Click **Apply** — Render builds the Docker image and starts the service
4. Once live, add `https://<your-app>.onrender.com/login/oauth2/code/google` as an authorized redirect URI in your [Google Cloud OAuth credentials](https://console.cloud.google.com/apis/credentials)

After initial setup, every push to `main` auto-deploys via Render's GitHub integration. The GitHub Actions CI pipeline also verifies every push and PR.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services > Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `http://localhost:8080/login/oauth2/code/google`
4. Store credentials as persistent environment variables:

**Windows (PowerShell — run once, persists across reboots):**
```powershell
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLIENT_ID", "your-id.apps.googleusercontent.com", "User")
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", "your-secret", "User")
```

**Linux / macOS (add to ~/.bashrc or ~/.zshrc):**
```bash
export GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-secret"
```

> Credentials are read from environment variables at startup. They are never stored in source code or version control.

---

## API Reference

### `POST /api/analyze`

Analyze a GPX file. Multipart form data. Public endpoint.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `file` | file | required | .gpx file (max 15 MB) |
| `weight` | number | 70 | Body weight in kg (20-300) |
| `height` | number | 170 | Height in cm (120-220) |
| `fitness` | int | 3 | Fitness level 1-5 |
| `startHour` | int | 8 | Planned start hour (0-23) |
| `startMinute` | int | 0 | Planned start minute (0-59) |

**Response:** `AnalysisResult` JSON containing:
- `stats` — distance, elevation, time, calories, difficulty, heart rate
- `safety` — pace factor, sunset, daylight margin, turnaround, point of no return
- `trackPoints` — `[lat, lon]` array for map rendering
- `gradientSegments` — `[lat1, lon1, lat2, lon2, gradientPct]` for gradient overlay
- `elevationProfile` — `{distanceKm, elevationM, gradientPct}` for chart
- `waypoints` — parsed GPX waypoints

### `GET /api/user`

Returns current authentication status. Public endpoint.

### `GET /api/activities`

List all activities for the logged-in user. Requires authentication.

### `POST /api/activities`

Save a new activity. JSON body with `name`, `gpxData`, and stats fields. Requires authentication. Limits: 15 MB GPX data, 500 activities per user.

### `GET /api/activities/{id}`

Get a saved activity's GPX data. Requires authentication + ownership.

### `DELETE /api/activities/{id}`

Delete a saved activity. Requires authentication + ownership.

### `GET /api/user/stats`

Aggregated stats for logged-in user: total hikes, km, elevation, calories, personal records. Requires authentication.

### `GET /api/friends`

List all friends (accepted), incoming friend requests (pending), and email invites. Requires authentication.

### `POST /api/friends/add`

Add a friend by email. If the email belongs to a registered user, creates a pending friend request. If not registered, sends an invite email. JSON body: `{"email": "..."}`. Requires authentication.

### `POST /api/friends/accept/{id}`

Accept a pending friend request. Requires authentication + must be the addressee.

### `DELETE /api/friends/{id}`

Remove a friendship. Requires authentication + must be a participant.

### `POST /api/friends/emergency`

Send emergency alert to all accepted friends. JSON body: `{"latitude": ..., "longitude": ...}`. Sends an email to each friend with coordinates and a Google Maps link. Requires authentication.

### `POST /api/ai-analysis`

AI route coaching via Gemini 2.5 Flash. Send `{name, stats, safety}` JSON. Returns `{available, analysis}`.

### `GET /api/ai-tip`

Seasonal hiking safety tip from Gemini. Public endpoint.

### `GET /admin`

Admin dashboard (tabbed: Overview, Users, Activities, AI Connector, System). Requires admin role.

### `GET /api/health`

Returns `{"status":"ok","app":"HikerAid","version":"1.0.0"}`.

---

## Project Structure

```
src/main/java/com/hikerAid/
  config/
    SecurityConfig.java              Spring Security + OAuth2, endpoint permissions
  controller/
    GpxApiController.java            POST /api/analyze + GET /api/health
    ActivityController.java          CRUD /api/activities
    AdminController.java             Admin panel page + /api/admin/* endpoints
    AiController.java                POST /api/ai-analysis + GET /api/ai-tip
    FriendController.java            Friends, invites, emergency /api/friends/*
    UserController.java              GET /api/user + /api/user/stats
    HomeController.java              GET / (Thymeleaf page)
    IconController.java              PWA icon fallback (SVG)
  entity/
    UserEntity.java                  JPA user (Google ID, email, name, avatar, admin)
    ActivityEntity.java              JPA activity (GPX data + all stats)
    FriendshipEntity.java            Friendship (requester, addressee, PENDING/ACCEPTED)
    FriendInviteEntity.java          Email invite for non-registered users
  model/
    AnalysisResult.java              API response record (stats + safety)
    RouteStats.java                  Route statistics record
    SafetyAnalysis.java              Safety analysis record
    GpxData.java                     Parsed GPX structure
    TrackPoint.java                  GPS point (lat/lon/ele/time/hr/cad)
    ElevationPoint.java              Elevation profile point
    WaypointData.java                GPX waypoint
  repository/
    UserRepository.java              findByGoogleId, findByEmailIgnoreCase
    ActivityRepository.java          findByUserId, countByUserId, deleteAllByUserId
    FriendshipRepository.java        findAllByUserAndStatus, findPendingForUser
    FriendInviteRepository.java      findByInviteeEmailIgnoreCase
  service/
    GpxParserService.java            XXE-safe DOM GPX parser
    RouteAnalysisService.java        Tobler, safety, difficulty, calories, deadband
    GeminiService.java               Gemini 2.5 Flash API client
    CustomOAuth2UserService.java     Google login -> user sync + admin flag + invite conversion
    EmailService.java                Resend.com API for friend invites + emergency alerts

src/main/resources/
  application.properties             Server, H2 DB, OAuth, Gemini config
  templates/
    index.html                       Main SPA (upload, viewer, recording)
    admin.html                       Admin panel (tabbed dashboard)
  static/
    css/style.css                    Mobile-first dark theme
    js/app.js                        Upload, recording, auth, activities, sync, AI
    js/map.js                        Leaflet map, gradient segments, safety markers
    js/elevation.js                  Chart.js elevation profile
    sw.js                            Service worker (offline PWA)
    manifest.json                    PWA manifest + share target
    icons/icon.svg                   App icon (mountain + first aid cross)
```

---

## Algorithms

### Tobler's Hiking Function

```
speed (km/h) = 6.0 * exp(-3.5 * |slope + 0.05|)
clamped to [0.3, 8.0] km/h
```

Where `slope = vertical / horizontal` (rise/run ratio, not percentage). Optimal speed (~6 km/h) at -5% grade. Significantly more realistic than Naismith's rule on variable terrain.

### Difficulty Score (0-100)

```
score = min(distKm * 2, 40) + min(ascent / 50, 40) + min(maxGradient / 2.5, 20)
```

| Score | Label |
|---|---|
| < 10 | Easy |
| 10-24 | Moderate |
| 25-44 | Hard |
| 45-64 | Very Hard |
| 65+ | Extreme |

### Calorie Estimate

```
heightFactor = 1.0 - (heightCm - 170) * 0.005    (stride efficiency: taller = more efficient)
flat         = weight * distKm * 0.7 * heightFactor
climb        = ascentM * weight * 0.01             (mgh / ~25% muscular efficiency)
descent      = descentM * weight * 0.003           (eccentric muscle work)
bmr          = (10*weight + 6.25*height - 200) / 24 * hours   (basal metabolic rate during hike)
total        = flat + climb + descent + bmr
```

### Elevation Deadband

GPS noise creates spurious elevation changes. The deadband algorithm accumulates elevation in one direction and only counts it when the direction reverses by more than 3 meters. This typically reduces reported ascent/descent by 20-40% compared to raw point-to-point differencing.

### Sunset Estimation

Uses the simplified solar declination formula:
```
declination = -23.45 * cos(360/365 * (dayOfYear + 10))
hourAngle = acos(-tan(latitude) * tan(declination))
sunsetHour = 12 + hourAngle * 12/PI + DST_adjustment
```

Accuracy: ~10-15 minutes. The 30-minute safety buffer compensates for this uncertainty.

---

## Security

| Measure | Implementation |
|---|---|
| XXE prevention | `DocumentBuilderFactory` disables DOCTYPE, external entities |
| XSS prevention | All user data (GPX names, descriptions) rendered via `textContent` |
| OAuth2 | Google sign-in via Spring Security; no passwords stored |
| IDOR protection | Activity endpoints verify user ownership |
| Credential isolation | OAuth secrets from environment variables only |
| Activity limits | 15 MB GPX data cap, 500 activities per user |
| CSRF | API exempt (mitigated by SameSite=Lax session cookies) |
| Friend ownership | Friendship endpoints verify user is a participant |
| Emergency rate limit | Requires accepted friends; coordinate validation; GPS accuracy reported |
| Error handling | Generic messages; no stack traces leaked to client |
| H2 console | Disabled |
| Gemini API key | Server-side only; never sent to browser |

---

## GPX Format Support

- Track points (`<trkpt>`) with elevation, timestamps
- Garmin heart rate extensions (`<gpxtpx:hr>`, `<ns3:hr>`, `<heartrate>`)
- Cadence extensions (`<cad>`, `<gpxtpx:cad>`)
- Route points (`<rtept>`) — treated as track when no `<trk>` present
- Waypoints (`<wpt>`) with name, description, symbol, type
- Multiple track segments within a single track
- GPX 1.0 and 1.1

---

## Gradient Colour Scale

| Colour | Hex | Slope |
|---|---|---|
| Dark blue | `#0077B6` | Steep downhill (< -15%) |
| Blue | `#00B4D8` | Downhill (-8% to -15%) |
| Cyan | `#90E0EF` | Gentle downhill (-2% to -8%) |
| Green | `#74C69D` | Flat (-2% to +2%) |
| Light green | `#B7E4C7` | Easy uphill (2% to 8%) |
| Yellow | `#F9C74F` | Moderate uphill (8% to 15%) |
| Orange | `#F4A261` | Hard uphill (15% to 25%) |
| Red | `#E76F51` | Extreme uphill (> 25%) |

These thresholds are defined in both `map.js` and `elevation.js` and must be kept in sync.

---

## Configuration

`src/main/resources/application.properties`:

| Property | Default | Description |
|---|---|---|
| `server.port` | 8080 | HTTP port |
| `spring.servlet.multipart.max-file-size` | 15MB | Max upload size |
| `server.compression.enabled` | true | Gzip for HTML/CSS/JS/JSON |
| `spring.datasource.url` | `jdbc:h2:file:./data/hikeraid` | Database file location |
| `spring.jpa.hibernate.ddl-auto` | update | Auto-create/update tables |
| `hikerAid.gemini-api-key` | `${GEMINI_API_KEY}` | Gemini API key for AI features |
| `hikerAid.admin-email` | `${ADMIN_EMAIL}` | Email for admin access |
| `hikerAid.resend-api-key` | `${RESEND_API_KEY}` | Resend.com API key for email |
| `hikerAid.resend-from` | `HikerAid <onboarding@resend.dev>` | Email sender address |

---

## License

MIT
