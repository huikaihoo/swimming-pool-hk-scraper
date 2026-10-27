# swimming-pool-hk-scraper

Collects swimming pool admission, facility, and schedule data for Hong Kong swimming pools.

## Preparation

Install Bun and the project dependencies:

```bash
bun install
```

Copy the environment template to create your local configuration:

```bash
cp .env.example .env
```

Fill in credentials only for the extraction methods you plan to use:

| Variable                | Purpose                                                   | When required                                                                                                                                      |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRAWL4AI_API_TOKEN`    | Authenticates requests to the local Crawl4AI service.     | English temporary-closure extraction when `--extractMethod crawl4ai` is selected.                                                                  |
| `CLOUDFLARE_ACCOUNT_ID` | Identifies the Cloudflare account used for AI extraction. | Opening with `--withllm true`, English annual closures with Cheerio and LLM enabled, and English temporary closures with Crawl4AI and LLM enabled. |
| `CLOUDFLARE_API_TOKEN`  | Authenticates requests to Cloudflare AI.                  | Opening with `--withllm true`, English annual closures with Cheerio and LLM enabled, and English temporary closures with Crawl4AI and LLM enabled. |

The default options use Cheerio without an LLM and do not require these credentials.

For Crawl4AI-based temporary-closure extraction, start the local service after setting `CRAWL4AI_API_TOKEN`:

```bash
docker compose up -d crawl4ai
```

## Commands

Run commands through the package start script:

```bash
bun start -- <command> [url] [options]
```

| Command          | Purpose                                                                      | URL required |
| ---------------- | ---------------------------------------------------------------------------- | ------------ |
| `admission`      | Fetch current pool admission status and capacity counts.                     | No           |
| `basic`          | Fetch and combine pool directory details and coordinates.                    | No           |
| `schedule`       | Scrape opening hours and closure information for pools in the basic dataset. | No           |
| `opening`        | Scrape opening hours for one pool.                                           | Yes          |
| `weekly_closure` | Scrape weekly closure information for one pool.                              | Yes          |
| `annual_closure` | Scrape annual maintenance closures for one pool.                             | Yes          |
| `temp_closure`   | Scrape temporary closures for one pool.                                      | Yes          |

Examples:

```bash
bun start -- admission
bun start -- basic
bun start -- schedule
```

Run `basic` before `schedule`; the schedule command reads `data/basic/latest.json`.

## Scraper options

Scraper commands accept these optional settings:

| Option            | Values                | Default   |
| ----------------- | --------------------- | --------- |
| `--extractMethod` | `cheerio`, `crawl4ai` | `cheerio` |
| `--withllm`       | `true`, `false`       | `false`   |
| `--lang`          | `en`, `tc`            | `en`      |

For example:

```bash
bun start -- annual_closure <url> --extractMethod cheerio --withllm false --lang en
bun start -- temp_closure <url> --extractMethod crawl4ai --withllm false --lang en
```

Options that are missing or invalid fall back to the default settings. The extraction method and LLM option affect scraper paths differently; for example, the Crawl4AI service is only needed when using a Crawl4AI-based path.

## Build

Build a standalone executable and run the collection commands:

```bash
bun run build
./swimming-pool-hk-scraper admission
./swimming-pool-hk-scraper basic
./swimming-pool-hk-scraper schedule
```

The executable also accepts the individual scraper commands and their URL and option arguments.

## Data

All output is written under `data/`.

| Dataset                | File                                      | Contents                                                                                                                                                                                                                                        | Update behavior                                                                                                      |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Admission snapshot     | `data/admission/latest.json`              | An object with a millisecond `timestamp` and a `data` array. Each pool has `district`, `name_en`, and `status`; open pools also include `maximumCapacity`, `currentAdmission`, and `allowedAdmission`.                                          | Replaced after each successful fetch.                                                                                |
| Admission history      | `data/admission/<year>/<YYYY-MM-DD>.json` | An array of admission snapshots for that Hong Kong date.                                                                                                                                                                                        | Each successful fetch is appended.                                                                                   |
| Basic pool information | `data/basic/latest.json`                  | An array of pools with English and Traditional Chinese names, addresses, districts, and URLs, plus coordinates as [longitude, latitude] or `null`.                                                                                              | Replaced after each successful run.                                                                                  |
| Schedule               | `data/schedule/latest.json`               | An array of pools with `opening` time ranges, `weekly_closure` weekday fields, `annual_closure` maintenance date ranges, and `temp_closure` time ranges. Closure records include bilingual facility, reason, and remarks fields when available. | Replaced after a successful schedule run. If one or more pool scrapes fail, the run does not save the schedule file. |
