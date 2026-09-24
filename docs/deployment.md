# Deployment Guide

## Local Development

### Prerequisites
- Java 21+
- Maven 3.8+

### Environment Variables (set once, persist across reboots)

**Windows PowerShell:**
```powershell
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLIENT_ID", "your-id.apps.googleusercontent.com", "User")
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", "your-secret", "User")
[System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your-gemini-key", "User")
[System.Environment]::SetEnvironmentVariable("ADMIN_EMAIL", "your-email@gmail.com", "User")
[System.Environment]::SetEnvironmentVariable("RESEND_API_KEY", "your-resend-key", "User")
```

**Linux/macOS (add to ~/.bashrc):**
```bash
export GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-secret"
export GEMINI_API_KEY="your-gemini-key"
export ADMIN_EMAIL="your-email@gmail.com"
export RESEND_API_KEY="your-resend-key"
```

### Build and Run
```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Open <http://localhost:8080>.

### Google OAuth Redirect URI (local)
Add to Google Cloud Console > Credentials > OAuth Client:
```
http://localhost:8080/login/oauth2/code/google
```

## Production (Render)

### One-Click Deploy
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ak91hu/hiker-aid)

### Manual Setup
1. Create a Web Service on render.com, connect the GitHub repo
2. Runtime: Docker, Plan: Free, Region: Frankfurt (or your choice)
3. Add environment variables in the Render dashboard:

| Key | Required | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `ADMIN_EMAIL` | no | Email that gets admin role on login |
| `GEMINI_API_KEY` | no | Enables AI features |
| `RESEND_API_KEY` | no | Enables friend invites + emergency emails |
| `RESEND_FROM` | no | Sender address; defaults to `HikerAid <onboarding@resend.dev>` |
| `DATABASE_URL` | auto | Render auto-injects when using `render.yaml` |

4. Add the production OAuth redirect URI:
```
https://hikeraid.onrender.com/login/oauth2/code/google
```

### Auto-Deploy
`render.yaml` sets `autoDeployTrigger: checksPass`. Render's GitHub integration
waits for this repository's GitHub Actions checks to pass before deploying a
push to the linked branch. The checks build and test the Java app, run browser
journeys, build the production Docker image, and start it to verify `/api/health`. Render then
builds the same commit from the repository. The Render service also uses
`/api/health` as its deployment health check.

## Database

PostgreSQL on Render (persistent across deploys) via `render.yaml`'s blueprint
auto-provisioning. H2 file-based for local dev when no `DATABASE_URL` is set
(see `DatabaseConfig.java` for the switch logic).

Tables are auto-created/updated via Hibernate `ddl-auto=update`. Never drops
columns or tables — additive only.

Render plans, retention policies, and renewal terms can change. Check the
current Render documentation before relying on a particular plan for
persistent production data, and maintain an independent backup.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`):
- Triggers on push and PR to `main`
- Runs `mvn verify` on Java 21
- Publishes Surefire XML reports as a 14-day artifact, including on test failure
- Runs Playwright journeys in Chromium, Firefox, WebKit, and Mobile Chrome;
  publishes browser diagnostics as a 14-day artifact
- Builds and starts the production Docker image and checks `/api/health`
- Requires all three jobs to pass in a final quality gate before Render deploys

The CI container smoke check uses placeholder Google OAuth values and does not
need production secrets in GitHub Actions. Set production environment values in
the Render dashboard or through the Render Blueprint's `sync: false` prompts.

## Docker & Container JVM Optimization

```bash
docker build -t hikeraid .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GEMINI_API_KEY=... \
  -e ADMIN_EMAIL=... \
  -e RESEND_API_KEY=... \
  hikeraid
```

Multi-stage Docker build: `eclipse-temurin:21-jdk-alpine` (builder) -> `eclipse-temurin:21-jre-alpine` (runtime, lightweight ~180 MB image).

### Memory-Constrained JVM Runtime Flags

The `Dockerfile` configures JVM parameters intended for small container
instances:

| JVM Flag | Purpose & Impact |
|---|---|
| `-XX:+UseSerialGC` | Switches to single-threaded GC, saving memory overhead compared to G1/Parallel GC on single-core hosts |
| `-XX:MaxRAMPercentage=75.0` | Caps the Java heap at 75% of memory available to the JVM, reserving headroom for native allocations |
| `-XX:MaxMetaspaceSize=128m` | Caps metaspace memory allocation to avoid native memory exhaustion |
| `-XX:+TieredCompilation -XX:TieredStopAtLevel=1` | Stops JIT compilation at C1 to favor startup time and a smaller compiler footprint over peak throughput |
| `-Xss512k` | Halves per-thread stack memory allocation from default 1024k |
| `-XX:+ExitOnOutOfMemoryError` | Fails fast on OOM; recovery depends on the hosting platform's restart policy |

### HTTP Asset Compression & Cache Control

Configured in `src/main/resources/application.properties` for host resource optimization:
- **GZIP Compression**: `server.compression.enabled=true`, min response size 1024 B across text/JSON/CSS/JS/SVG MIME types.
- **Browser Cache Control**: `spring.web.resources.cache.cachecontrol.max-age=7d`, `must-revalidate=true` for 7-day browser caching of static UI assets.


## Health Check

```bash
curl http://localhost:8080/api/health
# {"status":"ok","app":"HikerAid","version":"1.0.0"}
```

## Service-Worker Cache Versioning

When you change anything in `static/`, bump:
- `?v=N` query strings in `src/main/resources/templates/index.html`
- `CACHE_NAME = 'hikerAid-vN'` in `src/main/resources/static/sw.js`

The activate handler deletes any cache name not in `{CACHE_NAME, TILE_CACHE}`.

## Troubleshooting

| Issue | Fix |
|---|---|
| `redirect_uri_mismatch` on Google login | Add the exact callback URL to OAuth Authorized Redirect URIs in Google Cloud Console |
| AI features not working | Check `GEMINI_API_KEY`; test in admin panel > AI Connector tab |
| Admin link not showing | `ADMIN_EMAIL` must match your Google email exactly; re-login after setting |
| Emergency email lands in spam | Verify a domain at resend.com/domains; set `RESEND_FROM` to use it |
| `Circular placeholder reference` on startup | Don't name properties the same as env vars; use `hikerAid.` prefix |
| Offline tiles disappear after deploy | Expected — bumping `TILE_CACHE` version wipes old tiles (subdomain-key changes) |
| Render free tier cold start ~30 s | Expected; subsequent requests are fast |
| PostgreSQL connection refused | Render free-tier instance hibernates with no traffic; first connection wakes it |
