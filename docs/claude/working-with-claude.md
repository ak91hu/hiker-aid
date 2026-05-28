# Working with Claude on HikerAid

This project is developed with the assistance of [Claude Code](https://docs.claude.com/en/docs/claude-code/overview),
Anthropic's terminal-based coding agent. This page documents the conventions
that work well on this codebase, so future sessions (and human contributors
collaborating with the AI) can be productive quickly.

## Context loading

- The root-level [`CLAUDE.md`](../../CLAUDE.md) is loaded automatically by
  Claude Code on every session. It contains a compact project overview, the
  full API and endpoint list, key files, environment variables, things to
  preserve, and a "past issues and fixes" table.
- Keep `CLAUDE.md` lean: the goal is one screenful of orientation, not full
  documentation. Anything large lives in [`docs/`](../).
- The MEMORY system lives at `~/.claude/projects/C--hikerAid/memory/` and is
  separate from this repo. Memories there cover things like personal
  preferences and recurring feedback.

## Prompting style that works well here

- **Be specific about the surface area.** "Update the splits panel to show
  fastest km in green" works better than "make splits prettier."
- **Specify the change depth.** For surgical edits, ask for `Edit`-style
  changes. For sweeping work, ask for a plan first.
- **Reference files by path.** `src/main/resources/static/js/app.js` beats
  "the frontend JS file."
- **Demand a build step.** Always ask Claude to run `mvn -q -DskipTests
  compile` (or full `mvn test`) after Java changes. Ask for a manual smoke
  test for UI changes.

## Slash commands used in this project

- `/code-review` — multi-angle review of the current diff. `medium` is a good
  default; `xhigh` for big features. Pass `--fix` to apply the findings.
- `/verify` — drive the app locally and exercise a specific change. Useful
  when CI tests can't see the bug (e.g. CSS regressions).
- `/init` — generate or refresh `CLAUDE.md` if the project has drifted from
  what's documented there.

## Patterns that scale

### Phased feature work
Big features are split into named phases with shippable PR-sized chunks
(P1.1, P1.2, ... P3.4). This makes it easy to interrupt, redirect, or
parallelise. The first big batch (May 2026) used this structure for the
ten features that became Phases 1-3 — see
[agentic-history.md](agentic-history.md).

### Task lists during multi-step work
`TaskCreate` is used at the start of any multi-step request to make
progress visible. Tasks are marked `in_progress` as work starts and
`completed` immediately upon finish (not batched). This protects against
context resets and surfaces blockers.

### Code review before commit
The standard rhythm for non-trivial change:
1. Implement
2. `mvn -q -DskipTests compile`
3. `/code-review` (medium for most cases)
4. Apply the highest-severity fixes
5. Commit with a HEREDOC message that explains *why*

## Anti-patterns specific to this codebase

- **Don't change Tobler's formula.** It's the intentional differentiator vs
  Naismith's rule. Tweak constants, not the model.
- **Don't add `thinkingConfig` to Gemini requests.** The 2.5-flash REST API
  silently rejects it and returns empty responses.
- **Don't use `innerHTML` for any user-controlled data.** GPX names and
  descriptions go through `textContent` only — XSS comes from GPX as easily
  as from form input.
- **Don't change Jackson imports back to `com.fasterxml.*`.** Spring Boot
  4 / Jackson 3 uses `tools.jackson.*`. Mixing them silently breaks
  serialization.
- **Don't move `CLAUDE.md` out of the root.** Claude Code auto-loads from
  the repo root; moving it breaks context loading.
- **Don't add em dashes or Unicode to email body strings.** Plain-text
  rendering in some clients turns them into `?`.

## Commit etiquette

- One commit per logical change, even if multiple files touch
- HEREDOC message body: short imperative subject, optional body explaining
  *why*, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer
- Never use `git commit --amend` unless explicitly requested — pre-commit
  hook failures mean the prior commit is still intact; fix and add a new
  commit
- Never `git push --force` to main

## When Claude gets it wrong

The diff is always the source of truth. If Claude reports "done" but the
diff doesn't match the claim, redirect with specifics ("you only changed
the JS — the CSS still has the old value at line 42"). Don't accept
"completed" status without verification.
