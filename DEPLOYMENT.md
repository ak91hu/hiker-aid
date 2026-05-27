# HikerAid Deployment Guide

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
```

**Linux/macOS (add to ~/.bashrc):**
```bash
export GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-secret"
export GEMINI_API_KEY="your-gemini-key"
export ADMIN_EMAIL="your-email@gmail.com"
```

### Build and Run
```bash
mvn clean package
java -jar target/hikerAid-1.0.0.jar
```

Open http://localhost:8080

### Google OAuth Redirect URI (local)
Add to Google Cloud Console > Credentials > OAuth Client:
```
http://localhost:8080/login/oauth2/code/google
```

## Production (Render)

### One-Click Deploy
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ak91hu/hiker-aid)

### Manual Setup
1. Create Web Service on render.com, connect GitHub repo
2. Runtime: Docker, Plan: Free, Region: Frankfurt
3. Add environment variables in Render dashboard:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | your OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | your OAuth client secret |
| `GEMINI_API_KEY` | your Gemini API key |
| `ADMIN_EMAIL` | admin user's Google email |

4. Add production OAuth redirect URI:
```
https://hikeraid.onrender.com/login/oauth2/code/google
```

### Auto-Deploy
Every push to `main` triggers automatic deployment via Render's GitHub integration.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`):
- Triggers on push/PR to `main`
- Sets up Java 21 with Maven cache
- Runs `mvn clean package` with secrets from GitHub Secrets
- Verifies JAR output

### GitHub Secrets Required
| Secret | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | CI build |
| `GOOGLE_CLIENT_SECRET` | CI build |
| `GEMINI_API_KEY` | CI build |
| `ADMIN_EMAIL` | CI build |

## Docker

```bash
docker build -t hikeraid .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GEMINI_API_KEY=... \
  -e ADMIN_EMAIL=... \
  hikeraid
```

Multi-stage build: JDK 21 Alpine (compile) -> JRE 21 Alpine (runtime, ~180MB image).

## Database

H2 file-based at `./data/hikeraid`. Tables auto-created on first run.

On Render free tier, the filesystem is ephemeral — data resets on each deploy. For persistent data, upgrade to a Render disk or switch to PostgreSQL.

## Health Check

```bash
curl http://localhost:8080/api/health
# {"status":"ok","app":"HikerAid","version":"1.0.0"}
```

## Troubleshooting

| Issue | Fix |
|---|---|
| `redirect_uri_mismatch` on Google login | Add the exact URL to OAuth Authorized Redirect URIs |
| AI features not working | Check `GEMINI_API_KEY` env var is set; test in admin panel |
| Admin link not showing | Check `ADMIN_EMAIL` matches your Google email; re-login after setting |
| Activities lost after deploy | Render free tier has ephemeral storage; expected behavior |
| `Circular placeholder reference` | Don't name properties the same as env vars (use `hikerAid.` prefix) |
