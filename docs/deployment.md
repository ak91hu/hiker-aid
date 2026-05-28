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
Every push to `main` triggers automatic deployment via Render's GitHub
integration. The Docker image is rebuilt, the JAR is repackaged, and the
service rolls over.

## Database

PostgreSQL on Render (persistent across deploys) via `render.yaml`'s blueprint
auto-provisioning. H2 file-based for local dev when no `DATABASE_URL` is set
(see `DatabaseConfig.java` for the switch logic).

Tables are auto-created/updated via Hibernate `ddl-auto=update`. Never drops
columns or tables — additive only.

> **Render free-tier PostgreSQL expires every 90 days.** You'll get a renewal
> email; just click renew.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`):
- Triggers on push and PR to `main`
- Sets up Java 21 with Maven cache
- Runs `mvn clean package`
- Verifies the JAR output

### GitHub Secrets Required
| Secret | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | CI build |
| `GOOGLE_CLIENT_SECRET` | CI build |
| `GEMINI_API_KEY` | CI build |
| `ADMIN_EMAIL` | CI build |
| `RESEND_API_KEY` | CI build |

## Docker

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

Multi-stage build: JDK 21 Alpine (compile) -> JRE 21 Alpine (runtime, ~180 MB
image).

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
