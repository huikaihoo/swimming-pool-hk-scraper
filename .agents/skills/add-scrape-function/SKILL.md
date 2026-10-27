---
name: add-scrape-function
description: Add a typed swimming-pool scraper and connect its implementation to the existing scraper and schedule architecture when needed.
---

# Add a scrape function

Use this skill when adding a scraper for pool admission, opening hours, or closure information. If the scraper also needs its own CLI command, follow [add-command](../add-command/SKILL.md) for the CLI work.

## Inspect the source page

Before writing extraction logic, inspect representative source pages and identify the actual structure, labels, language variants, and empty/error states.

- Use `scripts/crawl.sh <url>` to retrieve Crawl4AI's HTML or `scripts/crawl_md.sh <url>` to retrieve its Markdown. These are agent aids for understanding page structure/content and for debugging parser mismatches.
- Both scripts require the local Crawl4AI service and `CRAWL4AI_API_TOKEN`, read from the environment or the repository `.env` file. The service can be started with `docker compose up -d crawl4ai` after local configuration is set up.
- Treat script output as inspection evidence. The scripts do not define the runtime parser's implementation; follow the requested extraction path and neighboring scraper conventions.

## Location and shape

- Put public scraper functions and shared scrape types/helpers in `src/scrape/`. Keep `save...Data` functions and dataset persistence in top-level workflow modules such as `src/admission.ts`, `src/basic.ts`, or `src/schedule.ts`.
- Follow the existing versioned pattern: put an implementation in `src/scrape/impl/<name>_vN.ts`, then expose a typed public function from `src/scrape/<name>.ts`. Keep implementation selection in that public function and base it on `ScrapeOption` when options affect the path.
- Use `ScrapeInput` (`url`, `lang`, optional `html`) and `ScrapeOutput<T>` where they fit the function's contract. Add the scrape-specific output type to `src/scrape/types.ts`; use `ScrapeOption` exactly as spelled.
- For a URL-based scraper, follow neighboring direct-fetch Cheerio implementations unless the requested extraction path calls for another existing backend. Reuse helpers in `src/scrape/utils.ts` when their behavior matches the new data.

## Data and schedule integration

- Preserve language boundaries. `schedule` keeps English and Traditional Chinese inputs separate; do not overwrite one language's page HTML with the other's.
- Return fetched HTML in `ScrapeOutput.html` when a later schedule step can reuse that page. Check `src/schedule.ts` before deciding whether the new scraper should participate in schedule aggregation.
- If schedule aggregation is in scope, add the function call and result field in `src/schedule.ts`, update `ScheduleData` in `src/types.ts`, and preserve the established result order and bilingual field conventions.
- Keep saved-data behavior outside `src/scrape/`. Document any new user-facing command or persisted dataset shape in `README.md`.

## Reliability and debugging

- Match the selected scraper's return shape and failure conventions. Validate page structure and parsed values before returning them; report failures consistently with adjacent implementations instead of silently treating malformed input as an empty successful result.
- When parsing fails or results look wrong, use the crawl scripts to inspect the source content and compare it with the parser's assumptions before adding exceptions.
- Prefer rules based on source structure and validated fields over pool-specific hardcoded exceptions.
- Keep the change scoped to the new scraper and integrations required by the request.
