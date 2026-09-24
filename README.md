# HikerAid

[![CI](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml/badge.svg)](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-Render-46E3B7?logo=render)](https://hikeraid.onrender.com)
[![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.0.6-6DB33F?logo=spring-boot&logoColor=white)](https://spring.io/projects/spring-boot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa&logoColor=white)](docs/features.md#offline--pwa)

**Know when to turn back.** Safety-first GPX route analysis with turnaround
time, daylight margin, point of no return, and fitness-personalized Tobler
time estimates. Plus a snap-to-trail route planner, live location sharing with
automatic overdue alerts, weather, offline maps, 3D terrain, route comparison,
photo waypoints, and AI coaching.

### [Live Demo](https://hikeraid.onrender.com)

> Free. No paywall. Works offline. Sign in with Google to save activities.
>
> *First load may take ~30 s if the server is asleep (free tier).*

---

## At a glance

| Pillar | Highlights |
|---|---|
| **Safety & Survival** | Sunset estimate · 30 min buffer · turnaround point · point of no return · **live turn-back countdown** · **off-route deviation warning** · **always-on SOS button** · emergency alerts to friends · **automatic overdue check-in alert** · **Survival Suite (AMS Hypoxia Risk Analyzer, Dynamic Wilderness Resupply & Electrolyte Demand, Technical Terrain & 3D Avalanche Slope Angle Hazard Matrix, Offline SAR Emergency Beacon & Optical Scan Canvas)** |
| **Analytics** | Tobler time scaled to your fitness · **self-calibrated personal pace** learned from your real recorded times · **pack-weight load factor** · VAM · grade-adjusted pace · per-km splits · route comparison vs your past attempts with PR badge |
| **Planning** | **Draw-a-route planner** with snap-to-trail routing (public BRouter, no API key) · **multi-day staging** by hours/day · **printable / PDF safety card** |
| **Maps** | Gradient-colored track · interactive elevation profile · 4 base layers (Streets/Topo/Satellite/Dark) · **3D terrain view** (MapLibre GL JS v5.1.0 + Mapzen Terrarium DEM) with **3D GeoJSON slope degree hazard shading** (<15° green safe, 15–30° orange moderate, >30° red avalanche hazard) · animated route playback |
| **Offline** | Service-worker app shell · stale-while-revalidate tile cache with subdomain normalization · **offline tile downloader** with status & quota estimation · **IndexedDB background sync** for offline activity saves |
| **Weather** | Open-Meteo current + 12 h forecast · risk banner (OK/Caution/Danger) based on wind, precip, temp, thunderstorm |
| **AI** | Gemini 2.5 Flash route coaching with fallback to 2.0 Flash · seasonal safety tip on the home screen |
| **Social** | Add friends by email (auto-invite via Resend) · accept requests · emergency alert to all friends · **public share links** for routes · **live location sharing (LiveTrack)** with a public follow page |
| **Capture** | Live GPS recording → GPX export (any analyzed route) · **photo waypoints** with GPS-tagged map markers · save to your account |
| **Theming** | Light + dark themes with `prefers-color-scheme` and `localStorage` |

Full feature catalogue: [`docs/features.md`](docs/features.md).

---

## Quick start

```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Open <http://localhost:8080>.

Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional:
`GEMINI_API_KEY`, `RESEND_API_KEY`, `ADMIN_EMAIL`. Setup details in
[`docs/deployment.md`](docs/deployment.md).

Health check: `curl http://localhost:8080/api/health`.

---

## Build and Testing Execution

### Backend Unit & Integration Tests (Java 21)

`pom.xml` targets Java 21 (`<java.version>21</java.version>`). If your default system `java` environment is JDK 17 (or older), executing `mvn test` directly will fail due to unsupported class release targets. To execute the backend test suite successfully, set `JAVA_HOME` to a JDK 21+ installation.

**PowerShell (Windows):**
```powershell
$env:JAVA_HOME="C:\Users\Kovács Ákos\.jdks\azul-22.0.2"; mvn clean test
```

**Bash / Linux / macOS:**
```bash
export JAVA_HOME="/path/to/jdk-21"; mvn clean test
```

Verifies route-analysis mathematics, Tobler hiking speed, elevation deadband
filtering, XXE protection, activity comparisons, weather-risk heuristics, and
security controllers. Test counts change as the suite evolves; use the Maven
summary as the authoritative result.

### End-to-End Functional UI Tests (Playwright TypeScript)

Run the Playwright E2E functional test suite in the `e2e/` directory:

```bash
cd e2e
npm ci
npx playwright install chromium
npm test
```

Executes end-to-end browser tests verifying screen transitions, statistical calculations, modal interactivity, canvas rendering, 3D MapLibre avalanche slope shading, SOS emergency alerts, and PWA offline behavior.

---

## Resource Optimization & Container JVM Flags

HikerAid is configured for modest RAM and CPU consumption on
memory-constrained container hosts:

- **Dockerfile Memory-Constrained JVM Flags**:
  - `-XX:+UseSerialGC` — Minimizes GC thread memory overhead for single-core/low-RAM containers.
  - `-XX:MaxRAMPercentage=75.0` — Restricts the JVM heap to 75% of the
    container memory available to the JVM, leaving headroom for native memory.
  - `-XX:MaxMetaspaceSize=128m` — Caps metaspace memory allocation.
  - `-XX:+TieredCompilation` & `-XX:TieredStopAtLevel=1` — Speeds up startup time and reduces JIT memory footprint.
  - `-Xss512k` — Reduces thread stack size to conserve memory.
  - `-XX:+ExitOnOutOfMemoryError` — Terminates the JVM on OOM so the hosting
    platform can apply its configured restart policy.
- **Static Asset GZIP Compression (`application.properties`)**:
  - `server.compression.enabled=true`
  - `server.compression.mime-types=text/html,text/xml,text/plain,text/css,text/javascript,application/javascript,application/json,application/xml,image/svg+xml`
  - `server.compression.min-response-size=1024`
- **HTTP Cache-Control Headers (`application.properties`)**:
  - `spring.web.resources.cache.cachecontrol.max-age=7d`
  - `spring.web.resources.cache.cachecontrol.must-revalidate=true`

---

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ak91hu/hiker-aid)

Render builds from the included multi-stage `Dockerfile` (`eclipse-temurin:21-jre-alpine`) and auto-provisions PostgreSQL via `render.yaml`. Production deploys start only after the GitHub Actions checks pass.

---

## Documentation

| Topic | Where |
|---|---|
| Feature catalogue | [`docs/features.md`](docs/features.md) |
| HTTP API reference | [`docs/api.md`](docs/api.md) |
| Architecture & data model | [`docs/architecture.md`](docs/architecture.md) |
| Local dev, build, tests | [`docs/development.md`](docs/development.md) |
| Deploy to Render / Docker | [`docs/deployment.md`](docs/deployment.md) |
| Working with Claude Code | [`docs/claude/working-with-claude.md`](docs/claude/working-with-claude.md) |
| Claude skills & hooks | [`docs/claude/skills-and-hooks.md`](docs/claude/skills-and-hooks.md) (project skills live in [`.claude/skills/`](.claude/skills)) |
| Claude session context | [`CLAUDE.md`](CLAUDE.md) (auto-loaded by Claude Code) |

---

## Stack

Java 21 (LTS) · Spring Boot 4.0.6 (Spring Framework 7, Jackson 3, Jakarta EE 11) ·
PostgreSQL (Render) / H2 (local) · Spring Security OAuth2 (Google) ·
Thymeleaf · Vanilla JS · Leaflet 1.9.4 · MapLibre GL 5.1.0 ·
Chart.js 4.5.1 · Open-Meteo · BRouter (snap-to-trail routing, no key) ·
Gemini 2.5/2.0 Flash · Resend.com email.

---

## Algorithms

### Tobler's hiking function
```
speed (km/h) = 6.0 * exp(-3.5 * |slope + 0.05|), clamped to [0.3, 8.0]
```
Optimal ~6 km/h at -5 % grade. Significantly more realistic than Naismith's
rule on variable terrain. This is the intentional differentiator — see
[`docs/features.md`](docs/features.md#toblers-hiking-function).

### Difficulty (0-100)
```
score = min(distKm*2, 40) + min(ascent/50, 40) + min(maxGradient/2.5, 20)
```
Easy < 10 · Moderate 10-24 · Hard 25-44 · Very Hard 45-64 · Extreme 65+.

### Calorie estimate
```
heightFactor = clamp(1.0 - (heightCm - 170)*0.005, 0.85, 1.15)
movingMass = weight + max(0, pack)          // carried load adds mechanical cost, not BMR
flat    = movingMass * distKm * 0.7 * heightFactor
climb   = ascentM * movingMass * 0.01
descent = descentM * movingMass * 0.003
bmr     = (10*weight + 6.25*heightCm - 200) / 24 * hours
total   = flat + climb + descent + bmr
```
Pack load also slows pace: `paceFactor *= 1 - min(0.25, (pack/weight) * 0.6)`.

### Elevation deadband
3 m streak-based deadband filters GPS noise; typical 20-40 % reduction in
reported ascent/descent versus raw point-to-point differencing.

### Sunset estimation
Solar declination formula with DST adjustment. Accuracy ±10-15 min; the
30 min safety buffer compensates.

Full detail: [`docs/features.md`](docs/features.md) and
[`docs/architecture.md`](docs/architecture.md).

---

## Hazard & Gradient Color Scales

### 3D MapLibre GeoJSON Slope Angle Hazard Scale

| Slope Angle | Color | Hazard Category | Description |
|---|---|---|---|
| `< 15°` | Green (`#2EA043`) | Lower slope-angle exposure | Flat to gentle route segment; this is not an avalanche forecast |
| `15° – 30°` | Orange (`#D97706`) | Moderate slope angle | Transitional mountain terrain |
| `> 30°` | Red (`#DC2626`) | Steep terrain | Terrain where avalanche assessment may be necessary in snow conditions |

### 2D Gradient Track Color Scale

| Color | Hex | Slope |
|---|---|---|
| Dark blue | `#0077B6` | Steep down (< -15 %) |
| Blue | `#00B4D8` | Down (-8 to -15 %) |
| Cyan | `#90E0EF` | Gentle down (-2 to -8 %) |
| Green | `#74C69D` | Flat (-2 to +2 %) |
| Light green | `#B7E4C7` | Easy up (2-8 %) |
| Yellow | `#F9C74F` | Moderate up (8-15 %) |
| Orange | `#F4A261` | Hard up (15-25 %) |
| Red | `#E76F51` | Extreme up (> 25 %) |

Defined in both `map.js` and `elevation.js` — keep in sync.

---

## License

MIT
