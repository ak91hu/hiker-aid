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

### Advanced Metrics
- **VAM** (Vertical Ascent Meters per hour) — `totalAscent / movingHours`
- **GAP** (Grade-Adjusted Pace) — flat-equivalent pace using Tobler. Per-segment
  flat-equivalent distance is `d * (toblerSpeed(0) / toblerSpeed(slope))`;
  GAP is total moving time divided by total flat-equivalent distance.
- **Per-km splits** — distance, time, elevation gain/loss, average gradient per
  kilometre. Segment elevation diffs under 0.5 m are filtered as GPS noise.
  Fastest and slowest km highlighted in the splits table.
- **Moving time vs total time** — moving is pure Tobler estimate; total adds
  rest breaks.

## Safety

### Daylight Margin
Available daylight from start time to sunset, minus a 30-minute safety buffer.
Colour: green > 60 min spare, amber 0-60 min, red insufficient.

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

## Map & Visualization

### Gradient-Coloured Track
Track segments coloured by slope (8 stops from deep blue for steep down to
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

### 3D Terrain View
A second map instance using MapLibre GL JS with terrain enabled via Mapzen's
free Terrarium DEM tiles (encoded as RGB triplets). Hillshade layer plus the
route as a GeoJSON LineString with start/end circle markers. Camera pitched
to 60° with 1.5× terrain exaggeration. MapLibre JS/CSS is lazy-loaded only on
first toggle to keep the initial bundle small.

## Offline / PWA

### Service Worker Caching
- App shell (HTML/CSS/JS, Leaflet, Chart.js) cached on install
- Map tiles cached with stale-while-revalidate
- Tile cache key normalizes a./b./c. subdomain rotation so the same tile
  fetched via any rotation lands in one cache entry
- API calls are network-only (no caching of mutable data)

### Tile Pre-Download for Offline Use
"Download for offline" button in the layer panel:
1. Computes the route's bounding box plus 10 % padding
2. Enumerates tiles for zoom 11-15 (cap 2500 tiles ≈ 50 MB)
3. Quota check via `navigator.storage.estimate()` before starting
4. Worker pool of 8 concurrent fetches; SW intercepts and caches each tile
5. Live progress bar, cancellable, "Clear cache" button
6. Cache size reported via SW `MessageChannel` ping

### Offline-First Activity Sync
- Save while offline → activity queued in IndexedDB (`pendingActivities`)
- Yellow-bordered pending card appears in the activity list immediately
- Background-sync API (`reg.sync.register('sync-activities')`) registered for
  retry on network return
- SW `sync` event handler messages clients; clients flush the queue
- `visibilitychange` polling fallback for iOS (no background-sync support)
- Sync badge on the user panel shows pending count

### Installable
Standard PWA manifest with share-target intent on Android (receive .gpx
files from the OS share sheet).

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

## Export

- Download GPX — exports the loaded or recorded route as `.gpx`
- Download summary — plain-text report of all stats + safety analysis
