# HikerAid — Claude Code context

## What this project is

Spring Boot 3.3.4 app serving a mobile-first PWA for GPX route analysis. Runs on port 8080. No database — fully stateless; analysis happens in-memory per request.

## How to build and run

```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Health check: `curl http://localhost:8080/api/health`

## Key files to know

| File | Purpose |
|---|---|
| `service/GpxParserService.java` | DOM-based GPX parser; XXE-safe; handles tracks, routes, waypoints, Garmin HR extensions |
| `service/RouteAnalysisService.java` | All maths: Tobler time, difficulty score, calorie estimate, gradient smoothing, profile/segment building |
| `model/AnalysisResult.java` | The API response record — what the frontend receives |
| `static/js/map.js` | Leaflet map; gradient segment colouring; GPS marker; layer switching |
| `static/js/elevation.js` | Chart.js elevation profile; per-segment colours; hover callback |
| `static/js/app.js` | Upload flow, GPS tracking, UI state, localStorage offline cache |
| `static/sw.js` | Service worker — cache-first app shell, stale-while-revalidate tiles |

## Important constants (RouteAnalysisService)

```java
MAX_GRADIENT_SEGMENTS = 2000   // subsampled for map rendering
MAX_ELEVATION_PROFILE_POINTS = 500
MAX_TRACK_POINTS = 5000        // sent to frontend for GPS tracking
```

Gradient smoothing: adaptive rolling average (~50m window) before sending segments to the frontend.

Elevation deadband: 3m threshold filters GPS noise from ascent/descent totals.

## Tobler's hiking function

```java
speed_kmh = 6.0 * Math.exp(-3.5 * Math.abs(slope + 0.05))
// slope = vertical / horizontal (rise/run, NOT percentage)
// clamped to [0.3, 8.0] km/h
```

Do not change this to Naismith's rule — Tobler is the intentional differentiator.

## Difficulty score formula

```
score = min(distKm × 2, 40) + min(ascent / 50, 40) + min(maxGradPct / 2.5, 20)
```

Labels: Easy (<10), Moderate (10–24), Hard (25–44), Very Hard (45–64), Extreme (65+).

## Gradient colour thresholds (same in map.js and elevation.js — keep in sync)

```
< -15%  →  #0077B6  (steep downhill)
< -8%   →  #00B4D8
< -2%   →  #90E0EF
< +2%   →  #74C69D  (flat)
< +8%   →  #B7E4C7
< +15%  →  #F9C74F
< +25%  →  #F4A261
  ≥25%  →  #E76F51  (extreme uphill)
```

These thresholds exist in two places: `map.js:gradientColor()` and `elevation.js:gradientColor()`. If you change one, change both.

## Frontend architecture

Single Thymeleaf page (`index.html`) with three CSS-toggled screens: `upload-screen`, `loading-screen`, `viewer-screen`. No JS framework — vanilla ES6 IIFEs. `app.js` orchestrates the other two modules.

## API contract

`POST /api/analyze` — multipart form data. Returns `AnalysisResult` JSON. File size limit: 15 MB.

| Param | Type | Default | Description |
|---|---|---|---|
| `file` | multipart | required | .gpx file |
| `weight` | double | 70 | Body weight in kg (20–300) |
| `fitness` | int | 3 | Fitness level 1–5 (Beginner→Very fit) |
| `startHour` | int | 8 | Planned start hour (0–23) |
| `startMinute` | int | 0 | Planned start minute (0–59) |

## Safety analysis (niche differentiator)

The `SafetyAnalysis` record in the response contains:
- **Pace factor**: Tobler speed multiplier from fitness level (0.6–1.3)
- **Sunset estimate**: approximate local sunset from route latitude + day of year
- **Daylight margin**: spare time (positive) or shortfall (negative) in minutes
- **Turnaround point**: furthest distance where a round trip still fits in daylight
- **Point of no return**: distance where continuing forward is faster than going back

Pace factors: Beginner=0.6, Below avg=0.8, Average=1.0, Fit=1.15, Very fit=1.3.
Safety buffer: 30 minutes before sunset.
Sunset calculation uses simplified solar declination + rough DST adjustment.

## Things to preserve

- No user accounts, no database — keep it stateless
- `renderer: L.canvas()` on the Leaflet map — do not remove; critical for performance with 2000 gradient polylines
- XXE prevention in `GpxParserService` — the three `setFeature` calls must stay
- PWA share target in `manifest.json` allows receiving `.gpx` files from the OS share sheet on Android
- Elevation deadband (3m) in `computeElevationGainLoss` — do not remove, prevents GPS noise inflation
- Safety buffer of 30 minutes before sunset — hardcoded in `SAFETY_BUFFER_MINUTES`
