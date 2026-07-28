# Development Guide

## Prerequisites
- Java 21+ (matches `pom.xml` `<java.version>21</java.version>`). *Note: If system default `java` is JDK 17, set `JAVA_HOME` to a Java 21+ installation when building/testing.*
- Maven 3.8+
- A working Google OAuth client (see [deployment.md](deployment.md))
- Optional: Gemini API key, Resend API key

## Build & Run

```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Browser: <http://localhost:8080>.

## Testing Frameworks & Execution

### 1. Backend Unit & Integration Tests (JUnit 5 / Spring Security)

`pom.xml` explicitly targets Java 21 (`<java.version>21</java.version>`). When running in environments where the default system Java runtime is JDK 17 (or older), executing standard `mvn test` will result in compilation or runtime fork failures (`release version 21 not supported` or `UnsupportedClassVersionError`). Set `JAVA_HOME` to a JDK 21+ installation before invoking Maven:

**PowerShell (Windows):**
```powershell
$env:JAVA_HOME="C:\Users\Kovács Ákos\.jdks\azul-22.0.2"; mvn clean test
```

**Bash / Linux / macOS:**
```bash
export JAVA_HOME="/path/to/jdk-21"; mvn clean test
```

All 91 test cases run in memory with 0 failures and 0 errors:

| Suite | Tests | Coverage |
|---|---|---|
| `service/GpxParserServiceTest.java` | 8 | GPX parser happy paths |
| `service/GpxParserEdgeCaseTest.java` | 8 | XXE prevention, malformed input, exotic GPX formats |
| `service/RouteAnalysisServiceTest.java` | 13 | Tobler hiking function, 3 m elevation deadband, difficulty scoring, calorie calculation, fitness pace scaling, safety analysis |
| `service/RouteAnalysisAdvancedMetricsTest.java` | 19 | VAM, GAP, per-km splits, live turn-back arrays, pack-weight load factor, explicit pace override, real-data pace self-calibration |
| `service/WeatherServiceTest.java` | 15 | Open-Meteo risk assessment heuristics (thunderstorm, wind, precip, minTemp), LRU cache eviction |
| `controller/GpxApiControllerTest.java` | 8 | `/api/analyze` validation and multipart file upload handling |
| `controller/GpxApiSecurityTest.java` | 7 | XXE payload rejection on analyze endpoints |
| `controller/ActivityComparisonTest.java` | 13 | Route-matching logic, PR detection, lazy endpoint backfilling |

Tests use only in-memory components — no external network calls or database servers required. Spring context tests run with an H2 in-memory store; unit tests instantiate services directly.

#### Running a single test suite or test method:

**PowerShell:**
```powershell
$env:JAVA_HOME="C:\Users\Kovács Ákos\.jdks\azul-22.0.2"; mvn test -Dtest=RouteAnalysisServiceTest
$env:JAVA_HOME="C:\Users\Kovács Ákos\.jdks\azul-22.0.2"; mvn test -Dtest=RouteAnalysisServiceTest#computesPerKmSplits
```

**Bash:**
```bash
JAVA_HOME="/path/to/jdk-21" mvn test -Dtest=RouteAnalysisServiceTest
JAVA_HOME="/path/to/jdk-21" mvn test -Dtest=RouteAnalysisServiceTest#computesPerKmSplits
```

### 2. End-to-End Functional UI Tests (Playwright TypeScript)

The automated functional UI test suite resides in `e2e/`:

```bash
cd e2e
npm install
npx playwright test
```

Features covered by Playwright assertion-heavy tests:
- **Navigation & Screen Transitions**: Verifies upload screen, 2D/3D map viewer, Survival Suite tab, and drawer transitions.
- **3D MapLibre Hazard Shading**: Validates 3D map canvas rendering, pitch control, and GeoJSON avalanche hazard slope color-coding ($<15^\circ$ green, $15^\circ\text{--}30^\circ$ orange, $>30^\circ$ red).
- **Survival Suite Calculation**: Asserts accuracy of AMS hypoxia risk index, dynamic hydration/electrolyte resupply formulas, and optical SAR emergency canvas rendering.
- **PWA & Offline Behavior**: Verifies ServiceWorker caching, tile pre-download modal, storage quota check, and IndexedDB activity sync.
- **SOS Alert System**: Verifies always-on SOS trigger, emergency modal fallback, and SMS deep-link generation.


## Project Layout

```
hikerAid/
├── CLAUDE.md                  Project context for Claude Code (root by convention)
├── README.md                  Top-level overview
├── pom.xml                    Maven build
├── Dockerfile                 Multi-stage JDK 21 build -> JRE 21 Alpine
├── render.yaml                Render blueprint (web + PostgreSQL)
├── .github/workflows/ci.yml   Build verification on push/PR
├── docs/                      All other documentation
│   ├── README.md              Doc index
│   ├── architecture.md
│   ├── features.md
│   ├── api.md
│   ├── deployment.md
│   ├── development.md         (this file)
│   └── claude/                Agentic / Claude Code notes
├── src/
│   ├── main/
│   │   ├── java/com/hikerAid/
│   │   │   ├── config/        Spring Security, DB URL conversion
│   │   │   ├── controller/    REST endpoints
│   │   │   ├── entity/        JPA entities
│   │   │   ├── model/         Plain records used in API responses
│   │   │   ├── repository/    Spring Data interfaces
│   │   │   └── service/       Business logic (parsing, analysis, weather, AI, email)
│   │   └── resources/
│   │       ├── application.properties
│   │       ├── templates/     Thymeleaf (index.html, admin.html)
│   │       └── static/
│   │           ├── css/style.css   Mobile-first dark theme + light variant
│   │           ├── js/app.js       App controller, state, all wiring
│   │           ├── js/map.js       Leaflet map module
│   │           ├── js/elevation.js Chart.js elevation profile
│   │           ├── sw.js           Service worker
│   │           ├── manifest.json   PWA manifest
│   │           └── icons/          PWA icons
│   └── test/
│       └── java/com/hikerAid/
└── target/                    Build output (gitignored)
```

## Conventions

- **No frontend framework.** Vanilla ES6 wrapped in IIFEs. Module pattern with
  exported namespaces (`HikerMap`, `HikerElevation`).
- **No `innerHTML` for user content.** Always `textContent` / `document.createElement`
  to prevent XSS from GPX metadata.
- **Jackson 3 imports.** `tools.jackson.databind`, not `com.fasterxml.*`.
- **Java records for API DTOs.** They serialize cleanly with Jackson 3.
- **CSS variables for theming.** Light theme overrides via `[data-theme="light"]`.
- **Cache busting.** `?v=N` query string on `/js/*.js` and `/css/*.css` in
  `index.html`, mirrored by `CACHE_NAME = 'hikerAid-vN'` in `sw.js`. Bump both
  together with every UI release — the `/bump-cache-version` skill does this.
- **Comment-free source.** Java/JS/CSS are kept free of explanatory comments;
  intent lives in this `docs/` tree and in `CLAUDE.md`, not inline. The only
  intentional exceptions are the security-critical `// XXE prevention` marker in
  `GpxParserService` and the `// package-private for unit testing` markers on
  test-visible methods. The `/strip-comments` skill enforces this; `src/test`
  is exempt and keeps its comments.
- **No new MD files unless asked.** This project ships docs in `docs/`; don't
  scatter ad-hoc notes elsewhere.

## Adding a new feature

1. Update or create model records in `src/main/java/com/hikerAid/model/`
2. Add service logic in `src/main/java/com/hikerAid/service/`
3. Wire a controller endpoint and add it to `SecurityConfig`'s permitAll or
   authenticated matcher
4. Add tests next to existing ones
5. Add frontend wiring in `app.js` / `map.js` / `elevation.js`
6. Bump cache busters with the `/bump-cache-version` skill
7. Strip comments from any new source with the `/strip-comments` skill
8. Update [features.md](features.md) and [api.md](api.md)
9. Run the `/release-checklist` skill (`mvn test`, `node --check`, diff review)
   before committing

## CI / Build

GitHub Actions (`.github/workflows/ci.yml`) builds on every push and PR. It
expects these GitHub Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GEMINI_API_KEY`, `ADMIN_EMAIL`.

The pipeline only verifies that the build and tests pass — Render handles
deployment on its own from `main`.

## Helpful local commands

```bash
mvn -q -DskipTests compile           # quick compile check
mvn test                              # full test suite
mvn -q -DskipTests package            # build jar without tests
mvn dependency:tree                   # what's in the classpath
curl http://localhost:8080/api/health # liveness
```

## Common gotchas

- **First load on Render free tier is ~30 s** (cold start). Subsequent loads
  are fast.
- **PostgreSQL on Render free tier expires every 90 days** — Render emails a
  reminder; just renew.
- **Resend free tier without a verified domain** can only deliver to the
  account-owner's email. Verify a domain at resend.com/domains for production
  use.
- **Don't add `thinkingConfig` to Gemini requests.** It's silently rejected by
  the 2.5-flash REST API and causes empty responses.
- **Keep gradient colors in sync** between `map.js` and `elevation.js`.
- **Email templates: ASCII only.** Em dashes render as `?` in plain-text
  clients.
