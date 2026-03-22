# Noas Agent Guide

## Overview

Noas is a small Node/Express service for Nostr account management and NIP-05
verification. It stores NIP-49 encrypted private keys, relay lists, and profile
images, and exposes both API endpoints and a lightweight browser UI.

Primary entrypoints:
- `src/index.js`: Express app setup, CORS, static assets, server startup
- `src/routes.js`: HTTP routes and behavior
- `src/config.js`: environment parsing and runtime config
- `src/public/index.html`: public landing page and account portal docs/UI
- `README.md`: operator and API documentation
- `test-api.sh`: HTTP integration coverage for documented behavior

## Working Rules

- Use semantic commits for any commit you create.
  Examples: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`
- Preserve unrelated user changes in the worktree. Do not revert or overwrite
  edits you did not make unless explicitly asked.
- Prefer small, consistent changes that keep docs, UI copy, and tests aligned
  with actual runtime behavior.

## Route And Behavior Changes

If you change routes, request/response behavior, auth flow, onboarding flow,
verification flow, or other user-visible API behavior, update the corresponding
documentation in the same pass:

- `src/public/index.html`
- `README.md`
- `test-api.sh`

This is a standing requirement, not an optional cleanup step.

## Validation

When behavior changes, verify the most relevant local checks you can run for the
change, typically from `package.json` or `justfile`.
