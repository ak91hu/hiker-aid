# HikerAid

[![CI](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml/badge.svg)](https://github.com/ak91hu/hiker-aid/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/deploy-Render-46E3B7?logo=render)](https://hikeraid.onrender.com)
[![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.0.6-6DB33F?logo=spring-boot&logoColor=white)](https://spring.io/projects/spring-boot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa&logoColor=white)](docs/features.md#offline--pwa)

**Know when to turn back.** Safety-first GPX route analysis with turnaround
time, daylight margin, point of no return, and fitness-personalised Tobler
time estimates. Plus weather, offline maps, 3D terrain, route comparison,
photo waypoints, and AI coaching.

### [Live Demo](https://hikeraid.onrender.com)

> Free. No paywall. Works offline. Sign in with Google to save activities.
>
> *First load may take ~30 s if the server is asleep (free tier).*

---

## At a glance

| Pillar | Highlights |
|---|---|
| **Safety** | Sunset estimate · 30 min buffer · turnaround point · point of no return · **live turn-back countdown** that recomputes from your real pace and the clock while tracking · **always-on SOS button** on every screen once signed in · emergency alerts to friends (with offline SMS fallback) |
| **Analytics** | Tobler time scaled to your fitness · VAM · grade-adjusted pace · per-km splits · route comparison vs your past attempts with PR badge |
| **Maps** | Gradient-coloured track · interactive elevation profile · 4 base layers (Streets/Topo/Satellite/Dark) · **3D terrain** (MapLibre + Mapzen DEM) · animated route playback |
| **Offline** | Service-worker app shell · stale-while-revalidate tile cache · **download tiles for any route in advance** · background-sync of offline activity saves |
| **Weather** | Open-Meteo current + 12 h forecast · risk banner (OK/Caution/Danger) based on wind, precip, temp, thunderstorm |
| **AI** | Gemini 2.5 Flash route coaching with fallback to 2.0 Flash · seasonal safety tip on the home screen |
| **Social** | Add friends by email (auto-invite via Resend) · accept requests · emergency alert to all friends |
| **Capture** | Live GPS recording → GPX export · **photo waypoints** with GPS-tagged map markers · save to your account |
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

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ak91hu/hiker-aid)

Renders builds from the included `Dockerfile`, auto-provisions PostgreSQL
via `render.yaml`, and redeploys on every push to `main`.

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

Java 21 · Spring Boot 4.0.6 (Spring Framework 7, Jackson 3, Jakarta EE 11) ·
PostgreSQL (Render) / H2 (local) · Spring Security OAuth2 (Google) ·
Thymeleaf · Vanilla JS · Leaflet 1.9.4 · MapLibre GL 4.7.1 ·
Chart.js 4.5.1 · Open-Meteo · Gemini 2.5/2.0 Flash · Resend.com email.

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
flat    = weight * distKm * 0.7 * heightFactor
climb   = ascentM * weight * 0.01
descent = descentM * weight * 0.003
bmr     = (10*weight + 6.25*heightCm - 200) / 24 * hours
total   = flat + climb + descent + bmr
```

### Elevation deadband
3 m streak-based deadband filters GPS noise; typical 20-40 % reduction in
reported ascent/descent versus raw point-to-point differencing.

### Sunset estimation
Solar declination formula with DST adjustment. Accuracy ±10-15 min; the
30 min safety buffer compensates.

Full detail: [`docs/features.md`](docs/features.md) and
[`docs/architecture.md`](docs/architecture.md).

---

## Gradient colour scale

| Colour | Hex | Slope |
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
