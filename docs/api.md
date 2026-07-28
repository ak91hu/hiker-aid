# API Reference

All endpoints are JSON over HTTP unless noted. Authenticated endpoints require
a Google OAuth2 session cookie. Admin endpoints require the session user's
email to match the `ADMIN_EMAIL` env var.

## Public Endpoints

### `GET /api/health`
Liveness probe.

Response: `{"status": "ok", "app": "HikerAid", "version": "1.0.0"}`

### `GET /api/user`
Current session info.

Response (logged in): `{"loggedIn": true, "name": "...", "email": "...", "avatar": "...", "admin": false}`

Response (anonymous): `{"loggedIn": false}`

### `POST /api/analyze`
Analyze a GPX file. **Multipart form data**, not JSON.

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `file` | file | required | `.gpx`, max 15 MB |
| `weight` | double | 70 | 20-300 kg |
| `height` | double | 170 | 120-220 cm |
| `pack` | double | 0 | clamped 0-60 kg; carried load adds to mechanical calories and slows pace |
| `fitness` | int | 3 | clamped to 1-5 |
| `paceFactor` | double | 0 | if > 0, overrides `fitness` with an explicit pace factor (clamped 0.3-3.0); used by the "use my measured pace" toggle |
| `startHour` | int | 8 | 0-23 |
| `startMinute` | int | 0 | 0-59 |

Response shape (`AnalysisResult`):
```json
{
  "name": "Route name from GPX",
  "description": "...",
  "stats": {
    "distanceKm": 12.34, "elevationGainM": 567, "elevationLossM": 580,
    "maxElevationM": 1234, "minElevationM": 200, "maxGradientPct": 25.4,
    "estimatedTimeMinutes": 240, "totalTimeMinutes": 280,
    "difficulty": "Hard", "difficultyScore": 38,
    "estimatedCalories": 1850, "pointCount": 4321, "avgSpeedKmh": 3.1,
    "hasElevationData": true, "hasTimestamps": true,
    "vamMetersPerHour": 142.0, "gradeAdjustedPaceMinPerKm": 14.5
  },
  "trackPoints": [[lat, lon], ...],
  "gradientSegments": [[lat1, lon1, lat2, lon2, gradientPct], ...],
  "elevationProfile": [{"distanceKm": ..., "elevationM": ..., "gradientPct": ...}, ...],
  "waypoints": [{"lat": ..., "lon": ..., "name": "...", "description": "...", "symbol": "..."}, ...],
  "safety": {
    "paceFactor": 1.0, "fitnessLabel": "Average",
    "personalizedMovingMinutes": 240, "personalizedTotalMinutes": 280,
    "sunsetEstimate": "19:45", "availableMinutes": 540,
    "marginMinutes": 230, "daylightSufficient": true,
    "turnaroundDistanceKm": 6.8, "turnaroundTrackIndex": 543,
    "pointOfNoReturnKm": 6.2, "pointOfNoReturnTrackIndex": 487,
    "sunsetMinutes": 1185, "safetyBufferMinutes": 30,
    "cumForwardMinutes": [0, 4, 9, ...], "cumReturnMinutes": [0, 3, 7, ...]
  },
  "splits": [
    {"km": 1, "minutes": 18, "elevationGainM": 45, "elevationLossM": 5, "avgGradientPct": 4.0},
    ...
  ]
}
```

`sunsetMinutes` (minute-of-day of estimated sunset) and the index-aligned
`cumForwardMinutes` / `cumReturnMinutes` arrays (cumulative personalized moving
minutes from the start to, and back from, each downsampled track point) power
the **live turn-back guidance** during GPS tracking — the client recomputes the
daylight margin from the hiker's real position, measured pace, and wall clock
without any further server call.

The `gradientSegments` and `trackPoints` arrays also feed the **3D MapLibre GeoJSON slope hazard shading** engine, mapping per-segment gradient percentages into slope angles to render color-coded 3D hazard lines ($<15^\circ$ green safe, $15^\circ\text{--}30^\circ$ orange moderate, $>30^\circ$ red avalanche hazard zone).


### `GET /api/weather?lat=X&lon=Y`
Open-Meteo weather forecast for a coordinate. Cached server-side for 1 hour
(LRU, 512 entries).

Response:
```json
{
  "latitude": 47.5, "longitude": 19.0, "timezone": "Europe/Budapest",
  "current": {"tempC": 12.4, "precipMm": 0.0, "windKmh": 8.2, "weatherCode": 1, "description": "Mostly clear"},
  "hourly": [{"time": "2026-05-28T15:00", "tempC": ..., "precipMm": ..., "windKmh": ..., "weatherCode": ..., "description": "..."}, ...],
  "risk": {"level": "OK|CAUTION|DANGER", "summary": "Conditions look favorable..."}
}
```

Error: `503` with `{"error": "Weather service unavailable"}` if Open-Meteo
fails. Returns `400` for invalid coordinates.

### `POST /api/ai-analysis`
Gemini 2.5 Flash performance coaching for a route. JSON body:
```json
{"name": "...", "stats": {...}, "safety": {...}}
```
Response: `{"available": true, "analysis": "markdown text"}` or
`{"available": false}` if Gemini key is not configured.

### `GET /api/ai-tip`
Seasonal hiking safety tip from Gemini. Response:
`{"available": true|false, "tip": "..."}`

### `POST /api/route/plan`
Snap-to-trail routing proxy to the public BRouter instance (no API key). JSON body:
```json
{"points": [[lat, lon], [lat, lon], ...], "mode": "hike|trek|walk"}
```
2-50 points, coordinates validated. Returns `{"gpx": "<gpx>...</gpx>"}` (BRouter
GPX with elevations) or `502` with `{"error": "..."}` if no route is found or the
service is unavailable. Feed the returned GPX back into `/api/analyze`.

### `GET /api/public/route/{token}`
Read a publicly shared route. Response: `{"name": "...", "gpxData": "..."}` or
`404` if the token is unknown/revoked.

### `GET /api/public/track/{token}`
Read a live-tracking session. Response:
```json
{
  "active": true, "hikerName": "Alex", "routeName": "...",
  "startedAt": "2026-05-31T08:00:00Z", "lastUpdate": "2026-05-31T09:12:00Z",
  "expectedReturn": "2026-05-31T17:00:00Z",
  "hasFix": true, "lat": 47.5, "lon": 19.0, "accuracy": 12.0
}
```
All timestamps are UTC `Instant`s. `hasFix` is `false` with null `lat`/`lon`
until the first real ping arrives — no synthesized position. `404` if unknown.

### `GET /api/logout`
Logs the user out and redirects to `/`. Lambda `RequestMatcher` accepts
both GET and POST.

## Authenticated Endpoints

### `GET /api/user/stats`
Aggregated stats for the current user. Response:
`{"totalActivities": ..., "totalKm": ..., "totalGainM": ..., "totalCalories": ...}`

### `GET /api/user/pace`
Self-calibrated personal pace from the user's real recorded times vs the Tobler
baseline. Response when calibrated:
`{"calibrated": true, "paceFactor": 1.12, "samples": 7}`; otherwise
`{"calibrated": false, "samples": 1, "needed": 3}`. Result is cached per user and
recomputed only when the activity count changes.

### `GET /api/activities`
List the current user's activities (no GPX data, just summaries).

### `POST /api/activities`
Save a new activity. JSON body matches the stats portion of `AnalysisResult`
plus `gpxData`. Limits: 15 MB GPX, 500 activities per user.

On save, the controller extracts the route's start/end coordinates from the
GPX via regex and stores them in dedicated columns for later route matching.

Response: `{"id": <new_id>}`

### `GET /api/activities/{id}`
Returns `{"id": ..., "name": "...", "gpxData": "..."}` if the activity belongs
to the current user.

### `DELETE /api/activities/{id}`
Deletes the activity if owned by the current user.

### `POST /api/activities/{id}/share`
Create (or return existing) a public share token for an owned activity.
Response: `{"token": "...", "url": "/route/<token>"}`.

### `DELETE /api/activities/{id}/share`
Revoke the share token. Response: `{"revoked": true}`.

### `GET /api/activities/{id}/comparisons`
Returns past activities that match the same route (Haversine endpoints < 200 m,
distance within 10 %, elevation gain within 25 %). Legacy activities without
start/end coords are lazy-backfilled and batch-saved.

Response:
```json
{
  "matches": [{"id": ..., "name": "...", "recordedAt": "...", "distanceKm": ..., "movingTimeMinutes": ..., "elevationGainM": ...}, ...],
  "matchCount": 3,
  "isPersonalBest": true,
  "avgMinutes": 215,
  "currentMinutes": 198
}
```

### `GET /api/friends`
Friends + incoming requests + pending email invites:
```json
{
  "friends":         [{"id": ..., "name": "...", "email": "...", "avatar": "..."}, ...],
  "incoming":        [{"id": ..., "name": "...", "email": "...", "avatar": "..."}, ...],
  "pendingInvites":  [{"id": ..., "email": "..."}, ...]
}
```

### `POST /api/friends/add`
JSON body: `{"email": "..."}`. If the email belongs to a registered user,
creates a `PENDING` friendship request. Otherwise sends an invite email and
records a `FriendInviteEntity`.

### `POST /api/friends/accept/{id}`
Accept a pending request (current user must be the addressee).

### `DELETE /api/friends/{id}`
Remove a friendship or decline a pending request. Current user must be a
participant.

### `DELETE /api/friends/invite/{id}`
Cancel a pending email invite the current user sent.

### `POST /api/friends/emergency`
JSON body: `{"latitude": ..., "longitude": ..., "accuracy": ...}`. Emails
each accepted friend with the coordinates, accuracy radius, and a Google Maps
link.

The frontend falls back to an SMS deep-link modal if this endpoint fails or
the device is offline.

### `POST /api/track/start`
Start a live-tracking session. JSON body (both optional):
`{"routeName": "...", "expectedReturn": "<UTC ISO instant>"}`. Deactivates any
prior active sessions for the user. Response: `{"token": "...", "url": "/live/<token>"}`.

### `POST /api/track/{token}/ping`
Push a real GPS position to the owner's session. JSON body:
`{"latitude": ..., "longitude": ..., "accuracy": ...}`. Owner-only.

### `POST /api/track/{token}/stop`
End a live-tracking session. Owner-only.

> If `expectedReturn` is set and passes while the session is still active, a
> `@Scheduled` job (`OverdueAlertService`, every 60 s) emails accepted friends the
> last known position. See [features.md](features.md#automatic-overdue-alert-check-in).

## Pages (Thymeleaf SPA)

| Path | Purpose |
|---|---|
| `/route/{token}` | Read-only public viewer for a shared route (`shared-mode`) |
| `/live/{token}` | Public live-tracking follow page (`live-mode`, polls every 15 s) |

## Admin Endpoints

All under `/api/admin/**`. Require the session email to match `ADMIN_EMAIL`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin` | Admin dashboard page |
| GET | `/api/admin/stats` | System stats |
| GET | `/api/admin/users` | All users |
| GET | `/api/admin/activities` | Most recent 100 activities |
| DELETE | `/api/admin/users/{id}` | Delete user + their activities |
| DELETE | `/api/admin/activities/{id}` | Delete an activity |
| POST | `/api/admin/test-ai` | Live Gemini connectivity test |
| POST | `/api/admin/test-email` | Send test email to a specified address (JSON: `{"email": "..."}`) |
| GET | `/api/admin/env-status` | Per-env-var presence/absence flags |

## OAuth Routes (Spring Security)

| Path | Purpose |
|---|---|
| `/oauth2/authorization/google` | Initiates Google login |
| `/login/oauth2/code/google` | OAuth callback (must be registered in Google Cloud Console) |

## Service Worker Messages

The page communicates with the service worker via `MessageChannel`:

| Outbound `type` | Reply `type` | Purpose |
|---|---|---|
| `CLEAR_TILE_CACHE` | `TILE_CACHE_CLEARED` | Wipe offline tile cache |
| `TILE_CACHE_SIZE` | `TILE_CACHE_SIZE_RESULT` (with `bytes`) | Estimate cached tile bytes |
| (SW push) | `SYNC_ACTIVITIES` | SW asks client to flush pending IndexedDB activities |
