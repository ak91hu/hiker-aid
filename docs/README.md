# HikerAid Documentation

This directory contains all project documentation, organized by topic.

## General

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | High-level system design, request flows, module responsibilities |
| [features.md](features.md) | Complete catalog of user-facing features with implementation notes |
| [api.md](api.md) | Full HTTP API reference (endpoints, params, responses) |
| [deployment.md](deployment.md) | Local dev setup, Docker, Render deployment, CI/CD |
| [development.md](development.md) | Contributor guide: build, test, conventions, project structure |

## Claude / Agentic Development

Documentation about how this project is built and maintained with the help of
Claude Code (Anthropic's CLI). Useful both for the AI agent itself (context
loading) and for contributors who want to understand the workflow.

| Document | Purpose |
|---|---|
| [claude/working-with-claude.md](claude/working-with-claude.md) | How to drive Claude Code productively on this codebase |
| [claude/agentic-history.md](claude/agentic-history.md) | Major AI-driven feature batches, lessons learned, anti-patterns |
| [claude/skills-and-hooks.md](claude/skills-and-hooks.md) | Custom Claude skills/hooks used during development |

The active project-context file [`/CLAUDE.md`](../CLAUDE.md) stays at the
repository root — that location is a Claude Code convention and moving it
would break automatic context loading.

## Live

Production site: <https://hikeraid.onrender.com>
