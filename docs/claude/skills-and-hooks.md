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

## Conventions for new skills

If you write a custom skill for this project, drop the `.md` file in
`~/.claude/skills/` (user) or `.claude/skills/` (project). Document it
here, including:
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
