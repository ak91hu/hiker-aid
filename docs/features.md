# Features

Complete catalog of user-facing features and their implementation notes.

## Route Analysis

### Tobler's Hiking Function
Slope-aware time estimation: `speed = 6.0 * exp(-3.5 * |slope + 0.05|)`,
clamped to [0.3, 8.0] km/h. Optimal speed at -5% grade. Significantly more
realistic than Naismith's rule on variable terrain.

Implementation: `RouteAnalysisService.toblerSpeed()`.

### Elevation Deadband
GPS noise creates spurious elevation changes. A streak-based deadband
accumulates same-direction elevation deltas and only commits them when the
direction reverses past 3 m. Typical reduction in reported ascent/descent:
20-40 % vs raw point-to-point differencing.

Implementation: `RouteAnalysisService.computeElevationGainLoss()`.

### Difficulty Score (0-100)
Composite of distance, ascent, and max gradient:
```
score = min(distKm * 2, 40) + min(ascent / 50, 40) + min(maxGradient / 2.5, 20)
```
Buckets: Easy (<10), Moderate (10-24), Hard (25-44), Very Hard (45-64), Extreme (65+).

### Calorie Estimate
Accounts for flat-terrain work, eccentric muscle work on descents, and BMR
during the activity. Height-scaled stride efficiency.

### Personalized Pace
Five fitness levels scale Tobler time:

| Level | Factor | Effect |
|---|---|---|
| Beginner | 0.6× | +67 % slower |
| Below avg | 0.8× | +25 % slower |
| Average | 1.0× | baseline |
| Fit | 1.15× | -13 % |
| Very fit | 1.3× | -23 % |

Rest breaks are added at 10 min/hour for hikes over 60 min.

### Pack Weight (Load)
An optional pack/load weight (0-60 kg) on the upload form feeds the analysis:
- **Calories** — carried mass is added to the mechanical work terms
  (`movingMass = weight + pack`) for flat/climb/descent, but **not** to BMR.
- **Pace** — a documented load factor slows Tobler pace,
  `paceFactor *= 1 - min(0.25, (pack/weight) * 0.6)`, applied alongside the
  fitness factor so it flows through time, splits, and the safety/turn-back math.

Implementation: `RouteAnalysisService.loadPaceMultiplier()` and `estimateCalories()`.

### Self-Calibrated Personal Pace
Instead of only self-rating fitness, HikerAid can learn your real pace from your
saved hikes. `GET /api/user/pace` compares each activity's **actual moving time**
(derived from genuine GPS timestamps, with stopped segments and >10 min gaps
excluded) against the Tobler baseline, and distance-weights the ratios into a
single personal pace factor (clamped 0.5-2.0). It needs at least 3 qualifying
timed hikes — otherwise it returns `calibrated:false` and shows nothing (no
fabricated value). When calibrated, a "Use my measured pace" toggle on the
upload form sends an explicit `paceFactor` override to `/api/analyze`. The result
is cached per user, keyed by activity count, so it only recomputes when the set
of activities changes.

Implementation: `RouteAnalysisService.paceCalibrationSample()`, `UserController.personalPace()`.

### Advanced Metrics
- **VAM** (Vertical Ascent Meters per hour) — `totalAscent / movingHours`
- **GAP** (Grade-Adjusted Pace) — flat-equivalent pace using Tobler. Per-segment
  flat-equivalent distance is `d * (toblerSpeed(0) / toblerSpeed(slope))`;
  GAP is total moving time divided by total flat-equivalent distance.
- **Per-km splits** — distance, time, elevation gain/loss, average gradient per
  kilometer. Segment elevation diffs under 0.5 m are filtered as GPS noise.
  Fastest and slowest km highlighted in the splits table.
- **Moving time vs total time** — moving is pure Tobler estimate; total adds
  rest breaks.

## Survival & Technical Niche Suite

An experimental set of planning indicators for mountaineers, high-altitude
trekkers, and remote wilderness travelers. These estimates are not medical
advice, an avalanche forecast, or a substitute for trained judgment and
authoritative local information.

### Hypoxia & Acute Mountain Sickness (AMS) Risk Analyzer
Evaluates high-altitude physiological stress by combining maximum elevation, altitude gain above the 2,500 m hypoxia threshold, and Tobler-derived rate of ascent ($m/h$).
- **Risk Indexing:** Categorizes routes into Low Risk ($<2,500\text{ m}$), Moderate/Caution ($2,500\text{--}3,500\text{ m}$), or High Risk/Hypoxia Hazard ($>3,500\text{ m}$).
- **Estimated Summit SpO₂:** Calculates estimated blood oxygen saturation at maximum altitude using standard barometric pressure lapse models ($\text{SpO}_2 \approx 98 - (\text{alt} / 1000) \times 3.5$).
- **Planning prompts:** Provides conservative reminders about staging,
  acclimatization, and seeking qualified medical advice. Medication decisions
  require a clinician.

### Dynamic Wilderness Hydration & Nutrition Resupply
Estimates water, electrolyte, and calorie requirements from user-provided
conditions. Individual needs vary; the values are planning aids, not precise
physiological measurements.
- **Environmental & Load Factors:** Dynamically adjusts targets based on ambient temperature ($-10^\circ\text{C}$ to $+45^\circ\text{C}$), relative humidity ($10\%\text{--}100\%$), carried pack weight load factor, and Tobler effort duration.
- **Intake Formula:** Base water requirement ($0.4\text{ L/h}$) is modulated by heat stress ($\text{temp} > 15^\circ\text{C}$), arid evaporation rates, vertical ascent effort ($0.2\text{ L per }1000\text{ m gain}$), and mechanical pack load.
- **Electrolyte Replenishment:** Quantifies sodium ($\text{Na}^+$) and potassium ($\text{K}^+$) replacement targets to prevent hyponatremia and cramping during endurance efforts.

### Technical Terrain & Avalanche Hazard Matrix
Estimates geometric slope between consecutive GPX points. GPS and elevation
noise can materially affect short segments, and the result does not model
snowpack, aspect, weather, terrain traps, or regional avalanche bulletins.
- **Steep-terrain threshold (>30°):** Quantifies route distance on segments
  exceeding $30^\circ$ as a prompt for further terrain and avalanche-condition
  assessment.
- **Extreme Technical Terrain (>35°):** Measures exposure to Class 3/4 scrambling and extreme slope angles.
- **Slope Angle Distribution Bar:** Renders a color-coded visual distribution bar separating Easy ($<15^\circ$), Moderate ($15^\circ\text{--}30^\circ$), and Technical/Avy ($>30^\circ$) terrain segments.

### Offline SAR Emergency Beacon & QR Code
Generates a highly dense, standardized Search and Rescue (SOS) data payload optimized for satellite messengers (Garmin inReach, ZOLEO, Iridium) or offline scanning by rescue teams.
- **Structured SOS Payload:** Formatted string containing route name, GPS coordinates, maximum altitude, remaining battery status, and estimated effort time.
- **High-Contrast Visual Beacon Canvas:** Renders an optical canvas with high-contrast sync blocks and GPS telemetry that can be held at maximum screen brightness for direct scanning by rescue helicopter cameras without requiring mobile network coverage.

## Safety

### Daylight Margin
Available daylight from start time to sunset, minus a 30-minute safety buffer.
Color: green > 60 min spare, amber 0-60 min, red insufficient.

### Sunset Estimation
Computed from route latitude and day-of-year using simplified solar
declination formula. DST adjustment in spring/autumn windows. Accuracy
±10-15 min; the 30 min buffer compensates.

### Turnaround Point
Furthest point on the route that still allows return before sunset (with
buffer). Marked on the map with a yellow icon.

### Point of No Return
Where remaining forward time becomes shorter than the time to retrace your
steps. Marked with a red exclamation icon.

### Live Turn-Back Guidance
The turnaround math above is computed at planning time; during a GPS-tracked
hike the live-tracking panel makes it dynamic. From the hiker's actual position
(nearest track point), measured pace versus plan, and the current wall clock, it
continuously recomputes:

- **Daylight left** until the sunset-minus-buffer cutoff.
- **Est. finish** time to complete the route at the current measured pace.
- **Turn back** — a traffic-light banner that reads one of:
  - *green* "on track to finish with N of daylight to spare",
  - *amber* "turn back by HH:MM to reach the start before dark" (the latest
    safe turnaround projected from the current position), or
  - *red* "turn back now" / "not enough daylight to return — descend now".

Measured pace is derived from elapsed time versus the planned cumulative time to
the current point (clamped to 0.5x-3x), so the warnings tighten automatically if
the hiker falls behind. The computation is fully client-side using the
`cumForwardMinutes` / `cumReturnMinutes` arrays from `/api/analyze`, so it keeps
working with no signal.

### Off-Route Deviation Warning
During a GPS-tracked hike, the tracking panel shows an amber banner when the
hiker strays from the planned line. Distance is the real perpendicular distance
to the nearest route segment (`HikerMap.distanceToRouteMeters()`); the threshold
is `max(75 m, 1.5 × GPS accuracy)` so a noisy fix never false-alarms. It clears
automatically once back on route. Fully client-side, real GPS only.

### Live Location Sharing (LiveTrack)
While tracking, "Share live location" starts a `TrackingSession` and produces a
public `/live/{token}` link. The hiker's browser pushes real GPS pings; the
public page polls every 15 s and shows the hiker's **actual last position**, ETA
context, and timestamps on a map. Until the first ping arrives it shows an
explicit "waiting for first GPS fix" state — never a guessed point. Polling stops
once the session ends. All session timestamps are stored and compared as UTC
`Instant`s so behavior is timezone-correct regardless of server or device zone.

### Automatic Overdue Alert (Check-In)
Before setting off, the hiker can set an expected return time. `OverdueAlertService`
runs every 60 s (`@Scheduled`, `@EnableScheduling`); when an active session passes
its expected-return instant, it emails every accepted friend the hiker's last
known position via Resend. The sent-flag is set before emailing so a failure
cannot spam the alert every minute. Requires `RESEND_API_KEY`.

### Emergency Alert
- **Always-on SOS button.** A red floating SOS button appears on every screen
  the moment you sign in (it does not wait for friends or a route) — emergency
  sending is the app's primary goal, so the trigger is always one tap away. It
  is also surfaced in the live-tracking panel and friends list.
- Sends current GPS coordinates (7-decimal lat/lon, accuracy in meters, Google
  Maps deep-link) to each accepted friend's email via Resend.
- **The send always attempts the server first** and reacts to the real result —
  it never pre-judges connectivity from `navigator.onLine` (which is unreliable
  on laptops and was the cause of false "no internet" reports).
- **Cause-aware fallback modal.** When the alert can't be emailed, a modal opens
  with an `sms:?body=...` deep-link, a Google Maps link, and "Copy emergency
  message", titled by the actual reason:
  - *No emergency contacts* — you have no accepted friends to email yet.
  - *Alerts unavailable* — the server has no `RESEND_API_KEY`.
  - *Server unreachable* / *No internet* — the request genuinely failed (the
    latter only when the browser also reports offline).

  The SMS path works on cellular voice/SMS where data is dead, and covers the
  no-friends case too — your coordinates still get out.

## Route Planning

### Draw-a-Route Planner (snap-to-trail)
"Plan a Route" enters a map-drawing mode: tap to drop waypoints and HikerAid
snaps them to actual trails and paths. Routing is proxied server-side through
the public **BRouter** instance (`POST /api/route/plan`, profiles hike/trek/walk)
— no API key, matching the env-vars-only convention, and server-side to avoid
CORS. The snapped GPX (with BRouter elevations) is drawn live; "Analyze" feeds it
straight into the standard `/api/analyze` pipeline so every stat and safety
metric comes for free. Undo/clear and live distance readout included.

Implementation: `RoutePlannerController`, planner block in `app.js`.

### Multi-Day Staging
The "Multi-day Plan" panel splits a route into daily stages by an
hours-of-hiking-per-day budget. Stages are derived from the real per-km splits
(distance, moving time, ascent, descent per day) — no fabricated data. Useful
for thru-hikes and hut-to-hut trips.

## Map & Visualization

### Gradient-Colored Track
Track segments colored by slope (8 stops from deep blue for steep down to
red for extreme up). Rendered with `L.canvas()` — required for performance
with 2000+ polylines.

### Elevation Profile
Interactive Chart.js chart with gradient-coloured line segments. Hover syncs
with a map marker via `HikerElevation.setHoverCallback()`.

### Route Playback
Play/pause button + 1×/2×/4× speed control inside the elevation panel header.
Animates a marker along the track polyline via `requestAnimationFrame`, with
the elevation cursor highlighted in sync (`chart.setActiveElements()` +
`chart.update('none')` for low-cost frame updates).

### Map Layer Switcher
Streets (OSM), Topo (OpenTopoMap), Satellite (ArcGIS), Dark (Carto). Selected
via a popover panel in the viewer header.

### 3D Terrain View & Avalanche Slope Hazard Shading
A second interactive map instance powered by MapLibre GL JS (v5.1.0) with terrain enabled via Mapzen's Terrarium DEM raster-dem tiles (encoded as RGB elevation triplets).
- **3D GeoJSON Slope Angle Hazard Shading:** The GPX track line is dynamically transformed into a GeoJSON FeatureCollection where each segment is color-coded by its calculated slope angle to highlight avalanche hazards in 3D perspective:
  - **Green (`#2EA043`)** — Gentle route-segment slope ($<15^\circ$); not a
    declaration that surrounding terrain is safe.
  - **Orange (`#D97706`)** — Moderate slope ($15^\circ\text{--}30^\circ$), cautionary gradient.
  - **Red (`#DC2626`)** — Avalanche Hazard Zone ($>30^\circ$), prime starting angle for dry slab avalanches.
- **Rendering & Interaction:** Features a terrain exaggeration factor of $1.5\times$, a fixed pitch of $60^\circ$, hillshade overlays, and high-contrast start/end markers. MapLibre JS and CSS bundles are lazy-loaded only when the user toggles 3D mode, maintaining a lightweight initial page payload.

## Offline / PWA

### Service Worker Caching
- App shell (HTML/CSS/JS, Leaflet, Chart.js) cached on install
- Map tiles cached with stale-while-revalidate strategy
- Tile cache key normalizes `a.tile`, `b.tile`, `c.tile` subdomain rotation so identical tiles land in a single cache entry
- API calls are network-only to guarantee data consistency

### Enhanced Tile Pre-Download for Offline Use
The "Download for offline" feature allows hikers to pre-cache map tiles for remote routes:
1. Computes the route's bounding box plus 10 % spatial buffer.
2. Enumerates tiles across zoom levels 11–15 (capped at 2500 tiles ≈ 50 MB).
3. **Storage Quota Check:** Invokes `navigator.storage.estimate()` prior to download to ensure available storage before filling cache.
4. **Worker Pool Execution:** Concurrently fetches tiles with 8 parallel worker connections; ServiceWorker intercepts and commits each tile to `TILE_CACHE`.
5. **Live Status & Management:** Provides a live percentage progress bar, cancel control, cache clearance button, and cache size reporting via `MessageChannel` pings.

### Offline-First Activity Sync & IndexedDB
- Save while offline → activity payload stored immediately in IndexedDB (`pendingActivities` store).
- Yellow-bordered pending card appears in the activity list with full offline functionality.
- Background-sync API (`reg.sync.register('sync-activities')`) registers automatic background retries when network connectivity is restored.
- SW `sync` event handler messages open clients; clients automatically flush pending items to `/api/activities`.
- `visibilitychange` polling fallback guarantees synchronization on iOS devices where ServiceWorker background-sync is unsupported.
- Live sync badge on the navigation header displays pending upload counts.

### Installable PWA
Standard Web App Manifest (`manifest.json`) with share-target intent on Android (allowing users to open `.gpx` files directly from OS file managers or messaging apps into HikerAid).

## Resource Optimization & Container Hosting

### Container JVM Arguments
Configured in `Dockerfile` (`eclipse-temurin:21-jre-alpine`) for low-memory
container hosts:
- `-XX:+UseSerialGC`: Lowers Garbage Collector thread allocation and memory overhead.
- `-XX:MaxRAMPercentage=75.0`: Restricts JVM heap allocation to 75% of memory
  available to the JVM, leaving headroom for native allocations.
- `-XX:MaxMetaspaceSize=128m`: Prevents unbounded metaspace growth.
- `-XX:+TieredCompilation` & `-XX:TieredStopAtLevel=1`: Accelerates startup speed and reduces JIT memory usage.
- `-Xss512k`: Halves thread stack allocation.
- `-XX:+ExitOnOutOfMemoryError`: Terminates the JVM on an out-of-memory error;
  restart behavior is controlled by the hosting platform.

### Compression & Caching Headers
Configured in `application.properties`:
- GZIP compression enabled for responses $> 1024\text{ B}$ across all text and JSON MIME types (`server.compression.enabled=true`).
- 7-day browser HTTP caching for static resources (`spring.web.resources.cache.cachecontrol.max-age=7d`, `must-revalidate=true`).


## Activities & History

### Personal Activity Storage (requires Google sign-in)
- Save analyzed routes (uploaded or recorded) to your account
- Activity list with summary stats on the home screen
- Re-analyze any saved activity (re-runs the analysis pipeline)
- Delete with confirmation
- Aggregated stats: total hikes, km, ascent, calories, friend count

### Route Comparison & Personal Bests
When viewing a saved activity, the backend finds past attempts on the same
route by matching:
- Start point Haversine < 200 m
- End point Haversine < 200 m
- Distance within 10 %
- Elevation gain within 25 % (when both > 50 m)

If your current time is the fastest across all matches → "PR!" badge.
Otherwise → "vs avg" banner showing minutes faster/slower than the average
past attempt. Endpoint coordinates are extracted from the GPX on save and
lazily back-filled for legacy activities (batched `saveAll()` per request).

### Photo Waypoints (recording flow only, local-only)
- "Photo" button in the recording overlay opens the camera (mobile) or file
  picker (desktop)
- Client-side compression to 1280 px JPEG, quality 0.78
- Stored as data URLs in IndexedDB (`photos` object store, indexed by
  `sessionId` and `activityId`)
- Linked to the server activity ID after save via cursor.update
- Display: camera-emoji markers on the map, tap opens a modal with the photo
  plus coordinates and timestamp
- Discarded recording deletes orphaned photos

## AI Features (Gemini)

### Performance Analysis
"AI" button in the viewer header. Sends `{name, stats, safety}` to Gemini
2.5 Flash via `/api/ai-analysis`. Response is rendered as markdown in a
slide-in panel with sections: Performance Summary, Key Risks, Recommendations,
Training Tip. Model fallback chain: 2.5-flash → 2.0-flash on 503.

### Seasonal Hiking Tip
On the home screen: one short, actionable seasonal safety tip from Gemini,
refreshed each visit (`/api/ai-tip`).

## Weather (Open-Meteo)

"Weather" button in the viewer header opens a side panel:
- Current conditions at the route start (temp, precip, wind)
- 12-hour hourly forecast (scrollable strip)
- WMO weather code descriptions
- Risk banner (OK / CAUTION / DANGER) based on heuristics:
  thunderstorm → DANGER; wind > 40 km/h → DANGER; wind > 25 → CAUTION;
  precipitation > 5 mm → DANGER; minTemp < -5 °C → DANGER

Server-side cache: 1-hour TTL, 512-entry LRU eviction (no API key required —
Open-Meteo is free for non-commercial use).

## Friends

### Friend Management
- Add by email — registered users get a friend request, unregistered get an
  invite email via Resend
- Auto-connect on signup — when an invited person registers, the friendship
  is created automatically by `CustomOAuth2UserService`
- Accept/decline incoming requests
- Remove friends

### Friend Invites
Persisted in `friend_invites` table until the invitee registers. Invite emails
are ASCII-only (em dashes get garbled in some plain-text clients).

## Theme

Light theme available via:
- Floating toggle (top-right on upload screen)
- Header button in the viewer
- Respects `prefers-color-scheme` on first load
- Persisted in localStorage under `hikerAid_theme`
- Theme is applied before paint via inline `<head>` script — no flash of dark
  on light reload
- Updates `<meta name="theme-color">` so the mobile status bar matches

## Recording

Live GPS recording with `watchPosition`. Real-time UI shows distance, duration,
altitude, and pace. Generates a standard GPX 1.1 document on stop. Saved
recordings link back to any captured photos via the recording session ID.

## Sharing & Export

- **Public share links** — share any saved activity via a read-only
  `/route/{token}` link (`POST/DELETE /api/activities/{id}/share`). The shared
  page reuses the full analysis viewer with owner-only controls hidden; the owner
  can revoke the token at any time.
- **Download GPX** — exports the loaded, recorded, *or saved* route as `.gpx`
  (for upload to Strava/Garmin/Fit). Two-way Strava/Fit sync is intentionally not
  built (would require fabricated/OAuth-gated data and a third-party app
  registration).
- **Printable / PDF safety card** — the print button renders a paper-friendly
  card (stats, sunset/daylight margin, turnaround, point of no return, endpoint
  coordinates) via a `@media print` stylesheet; "Save as PDF" from the print
  dialog. An offline paper backup that fits the safety theme.
- **Download summary** — plain-text report of all stats + safety analysis.
