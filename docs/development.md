# Development Guide

## Prerequisites
- Java 21+ (matches `pom.xml` `<java.version>`)
- Maven 3.8+
- A working Google OAuth client (see [deployment.md](deployment.md))
- Optional: Gemini API key, Resend API key

## Build & Run

```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Browser: <http://localhost:8080>.

## Tests

```bash
mvn test
```

Test layout under `src/test/java/com/hikerAid/`:

| Suite | Coverage |
|---|---|
| `service/GpxParserServiceTest.java` | GPX parser happy paths |
| `service/GpxParserEdgeCaseTest.java` | XXE prevention, malformed input, exotic GPX flavours |
| `service/RouteAnalysisServiceTest.java` | Tobler, deadband, difficulty, calories, splits, VAM, GAP |
| `service/WeatherServiceTest.java` | Open-Meteo risk assessment heuristics, cache behaviour |
| `controller/GpxApiControllerTest.java` | `/api/analyze` validation and happy path |
| `controller/GpxApiSecurityTest.java` | XXE on the analyze endpoint |
| `controller/ActivityComparisonTest.java` | Route-matching logic, PR detection, lazy backfill |

Tests use only the in-memory components — no real network or database. Spring
context tests run with an H2 in-memory store; pure unit tests instantiate the
service directly.

### Running a single test

```bash
mvn test -Dtest=RouteAnalysisServiceTest
mvn test -Dtest=RouteAnalysisServiceTest#computesPerKmSplits
```

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
  `index.html`. Bump with every UI release.
- **Service worker cache version.** `CACHE_NAME = 'hikerAid-vN'` in `sw.js`.
  Bump with every shell change.
- **No new MD files unless asked.** This project ships docs in `docs/`; don't
  scatter ad-hoc notes elsewhere.

## Adding a new feature

1. Update or create model records in `src/main/java/com/hikerAid/model/`
2. Add service logic in `src/main/java/com/hikerAid/service/`
3. Wire a controller endpoint and add it to `SecurityConfig`'s permitAll or
   authenticated matcher
4. Add tests next to existing ones
5. Add frontend wiring in `app.js` / `map.js` / `elevation.js`
6. Bump the `?v=N` cache busters in `index.html` and `CACHE_NAME` in `sw.js`
7. Update [features.md](features.md) and [api.md](api.md)
8. Run `mvn test` and `mvn package`

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
- **Keep gradient colours in sync** between `map.js` and `elevation.js`.
- **Email templates: ASCII only.** Em dashes render as `?` in plain-text
  clients.
