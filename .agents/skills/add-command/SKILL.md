---
name: add-command
description: Add a command to this repository's Bun CLI, including argument handling, dispatch, usage output, and README documentation.
---

# Add a CLI command

Use this skill when adding a new command to the swimming-pool scraper executable.

## Entry points

- `src/index.ts` reads the command from `process.argv[2]`, handles URL and scraper options, dispatches commands in a `switch`, and prints the fallback usage.
- `src/admission.ts`, `src/basic.ts`, and `src/schedule.ts` contain data-fetching or aggregation workflows. Reusable scraper functions belong under `src/scrape/` instead; see [add-scrape-function](../add-scrape-function/SKILL.md).
- `package.json` runs `src/index.ts` for `bun start` and builds that same entry point for the standalone executable. A new command normally needs no new package script.

## Add the command

1. Put the command's workflow in the existing top-level workflow module that owns it, or add a focused module under `src/` when the command owns a separate workflow.
2. Add a `case` to the `src/index.ts` switch. Use `hasUrl()` for a URL-required command and retain the current usage/error behavior unless the request requires a change.
3. Follow the current argument layout: command at `process.argv[2]`, URL at `[3]` when required, and options after the URL. `schedule` accepts scraper options directly after its command. Reuse `getScrapeOption()` and the shared `ScrapeOption` defaults/enums for scraper options; do not create a parallel parser.
4. Add the command and a representative invocation to the README Commands section. If it writes a new dataset or changes a saved shape, update the README Data section too.

Keep changes limited to the requested command. Avoid changing existing commands' argument behavior or adding options that were not requested.
