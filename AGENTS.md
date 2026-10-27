# Agent guidance

## Project

This is a Bun and TypeScript CLI. `src/index.ts` dispatches the commands; workflows and saved data types live in `src/`, while reusable pool scrapers live in `src/scrape/`.

## Commands

| Purpose                         | Command                                  |
| ------------------------------- | ---------------------------------------- |
| Install dependencies            | `bun install`                            |
| Run a command                   | `bun start -- <command> [url] [options]` |
| Build the standalone executable | `bun run build`                          |

## File map

| Path                                                  | Purpose                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `src/index.ts`                                        | CLI arguments, command dispatch, and usage output                   |
| `src/admission.ts`, `src/basic.ts`, `src/schedule.ts` | Data-fetching and persistence workflows                             |
| `src/scrape/*.ts`                                     | Public scraper functions and shared scraper types/helpers           |
| `src/scrape/impl/`                                    | Versioned scraper implementations                                   |
| `src/types.ts`                                        | Persisted admission, basic, and schedule data shapes                |
| `scripts/crawl.sh`                                    | Fetch a page through Crawl4AI and print its HTML for inspection     |
| `scripts/crawl_md.sh`                                 | Fetch a page through Crawl4AI and print its Markdown for inspection |
| `README.md`                                           | User-facing commands, options, and output formats                   |

## Skills

- For a CLI command, follow [add-command](.agents/skills/add-command/SKILL.md).
- For a pool scraper, follow [add-scrape-function](.agents/skills/add-scrape-function/SKILL.md).

## Project conventions

- Keep scraper functions and their shared types in `src/scrape/`. Keep `save...Data` workflows, such as admission, basic, and schedule persistence, outside that directory.
- Use the existing `ScrapeOption` spelling and `ScrapeInput` / `ScrapeOutput<T>` contracts.
- Keep scraper implementations in `src/scrape/impl/` and route them through a public function in `src/scrape/` when following the versioned scraper pattern.
- Use `scripts/crawl.sh <url>` or `scripts/crawl_md.sh <url>` to inspect page structure/content while developing or debugging scrapers. They require the local Crawl4AI service and `CRAWL4AI_API_TOKEN` (from the environment or `.env`).
- Preserve the existing command and output conventions. Update the README when a change adds a user-facing command, option, or saved data shape.
- Keep changes within the requested scope; do not overwrite, stage, or revert unrelated existing work.
