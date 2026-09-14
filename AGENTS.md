# Agent Instructions

## Repository boundary

- Work only in this repository unless a task explicitly names an external contract source.
- The `mean-weasel/bugdrop` repository is authoritative for the hosted widget, Worker, and protocol.
  Cross-repository assumptions must be recorded in `docs/protocol.md` and protected by fixtures or
  tests here.
- `@bugdrop/browser` is a loader/controller. Never copy the hosted widget implementation into this
  repository.
- `@bugdrop/server` is server-only. Never introduce server credentials, raw subjects, repository
  selectors, labels, or privileged flow configuration into the browser package.

## Changes

- Pin dependency versions exactly and commit `package-lock.json`.
- Keep shared wire contracts versioned in `packages/contracts`.
- Run `npm run validate` before declaring a change complete.
- Before completion, identify and attempt the strongest realistic failure mode. For security
  boundary changes, run `npm run test:security` and report the evidence.
- Do not publish, deploy, or create credentials from this repository without explicit approval.

## Search hygiene

- Determine the repository boundary with `git rev-parse --show-toplevel`.
- Prefer `rg` and `rg --files`, and exclude generated, dependency, cache, and sibling-worktree
  directories.
