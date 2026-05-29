---
name: release-checklist
description: Pre-push verification for HikerAid before committing or pushing to main, which auto-deploys to Render. Use when about to ship a change. Runs the test suite, syntax-checks the JS, reminds you to bump the PWA cache version for any asset change, and summarizes what will deploy. Does not push on its own.
---

# Release checklist

Pushing to `main` triggers an automatic Render deploy to
https://hikeraid.onrender.com. Walk this before you do.

1. **Backend tests** — `mvn -q clean test`; expect BUILD SUCCESS, 0
   failures/errors. `-q` suppresses the Surefire summary, so confirm totals
   from `target/surefire-reports/*.xml` if unsure.
2. **JS syntax** — `node --check` each changed file under
   `src/main/resources/static/js/` and `static/sw.js`.
3. **Frontend change?** If you touched `index.html`, `style.css`, any
   `js/*.js`, or `sw.js`, run the `bump-cache-version` skill so returning
   users don't get a stale cache.
4. **Comment-free source** — if you added Java/JS/CSS under `src/main`, run
   the `strip-comments` skill.
5. **Review the diff** — `git --no-pager diff --stat`, then skim the full
   diff. Confirm only intended files changed.
6. **Commit and push** — stage by name (never `git add -A`), use a message
   ending in the `Co-Authored-By: Claude ...` trailer, and push **only when
   the user has explicitly asked**. The deploy is user-facing.
