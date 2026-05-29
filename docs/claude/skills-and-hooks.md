# Skills and Hooks

This page documents the Claude Code skills and conventions used during
development of HikerAid. Skills are invoked from within a Claude Code
session via `/skill-name`.

## Skills used routinely

### `/code-review`

Multi-angle review of the current diff. Standard rhythm: implement → compile
→ `/code-review` → apply fixes → commit. Effort levels:

| Level | Use |
|---|---|
| `low` / `medium` | A few high-confidence findings — good for routine work |
| `high` / `max` | Broader coverage including uncertain findings |
| `ultra` | Deep multi-agent review in the cloud — slow and expensive, save it for high-stakes branches |
| `xhigh` | Recall mode: surface every plausible bug, ~15 findings, used before tagged releases |

Useful flags:
- `--fix` apply findings to the working tree
- `--comment` post findings as inline PR comments

### `/verify`

Drives the live app and exercises a specific change. Use when CI tests
can't see a regression — most CSS bugs, animation timing, layout breaks
on narrow viewports.

### `/init`

Generates or refreshes the root `CLAUDE.md` from the current codebase. Run
when the documented stack drifts from reality (e.g. after a major
dependency upgrade).

### `/security-review`

Security-focused review of pending changes. Run before merging any change
that touches `SecurityConfig`, the OAuth flow, GPX parsing (XXE risk), or
new external API integrations.

## Skills available but not yet used here

- `/simplify` — diff cleanup pass
- `/loop` — recurring task scheduler
- `/schedule` — cron-style remote agents

## Project skills (`.claude/skills/`)

Custom skills committed to this repo. Invoke with `/skill-name`.

### `/bump-cache-version`

Increments the PWA cache-buster after a frontend change: the `?v=N` query
string on `style.css` and `app.js` in `index.html`, plus `CACHE_NAME` in
`sw.js`, kept in sync. Run it whenever you edit `index.html`,
`static/css/style.css`, any `static/js/*.js`, or `static/sw.js` — otherwise
returning visitors keep the stale service-worker cache.

### `/strip-comments`

Enforces the comment-free `src/main` convention. Bundles
`strip_comments.py`, a character-stateful stripper that removes Java/JS/CSS
comments without touching string/template/regex content, preserves the
`XXE prevention` and `package-private for unit testing` markers, and leaves
`src/test` alone. Idempotent. Run after writing or editing source, then
`mvn -q clean test`.

### `/release-checklist`

Pre-push gate: runs `mvn -q clean test`, `node --check` on changed JS,
reminds you to `/bump-cache-version` for asset edits and `/strip-comments`
for new source, and to review the diff. It never pushes — pushing to `main`
auto-deploys to Render and requires an explicit user request.

## Conventions for new skills

Drop the skill folder in `.claude/skills/<name>/` (project) or
`~/.claude/skills/` (user). Each needs a `SKILL.md` with `name` and
`description` frontmatter; bundle any helper scripts alongside it. Document
it in this file, including:
- The exact slash command
- What it expects in the conversation context
- What kind of output it produces (text? JSON? edits?)
- When to prefer it over a built-in skill

## Hooks

No custom hooks are configured for this project. Hooks would live in
`.claude/settings.json` under the `hooks` key. Add documentation here
before adding one — silent automation is hard to debug.

## See also
- [working-with-claude.md](working-with-claude.md) — prompting style and
  patterns
- [agentic-history.md](agentic-history.md) — log of major AI-driven
  feature batches
