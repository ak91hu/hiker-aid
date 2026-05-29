---
name: strip-comments
description: Strip comments from HikerAid's Java/JS/CSS source to keep the comment-free source convention, while preserving the security-critical markers (XXE prevention, package-private for unit testing). Use after writing or editing source files, or when asked to remove or clean up comments. Uses a bundled string- and regex-aware stripper that will not corrupt strings, URLs (https://), or JS regex literals.
---

# Strip comments

HikerAid keeps its `src/main` Java/JS/CSS comment-free; intent lives in
`docs/` and `CLAUDE.md`. Test sources under `src/test` keep their
explanatory comments and are NOT stripped.

## Run

```bash
python .claude/skills/strip-comments/strip_comments.py \
  $(find src/main/java -name '*.java') \
  src/main/resources/static/js/app.js \
  src/main/resources/static/js/map.js \
  src/main/resources/static/js/elevation.js \
  src/main/resources/static/sw.js \
  src/main/resources/static/css/style.css
```

It prints `stripped:`/`unchanged:` per file and only rewrites files that
actually change.

## What it preserves
- Lines whose comment contains `XXE prevention` (`GpxParserService`) or
  `package-private for unit testing` (`ActivityController`, `WeatherService`).
- All string/template/regex content — the scanner is character-stateful, so
  `https://...` inside strings and `/regex/` literals are safe.
- CRLF vs LF line endings; it also drops comment-only lines and collapses the
  leftover blank lines.

## After running
- `node --check` each JS file.
- `mvn -q clean test` to confirm nothing broke.
- `git --no-pager diff` and confirm only comments were removed.
