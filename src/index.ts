import { saveAdmissionData } from "./admission";
import { scrapeAnnualClosure } from "./scrape/annual_closure";
import { saveBasicData } from "./basic";
import { saveScheduleData } from "./schedule";
import {
  defaultScrapeOption,
  ExtractMethod,
  Lang,
  type ScrapeOption,
} from "./scrape/types";
import { scrapeTempClosure } from "./scrape/temp_closure";
import { scrapeWeeklyClosure } from "./scrape/weekly_closure";
import { scrapeOpening } from "./scrape/opening";

const command = process.argv[2];
const url = process.argv[3];
const scrapeOptionUsage =
  "[--extractMethod <cheerio|crawl4ai>] [--withllm <true|false>] [--lang <en|tc>]";

function getScrapeOption(args: string[]): ScrapeOption {
  const option: { extractMethod: string; withllm: boolean; lang: string } = {
    ...defaultScrapeOption,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (value === undefined) return defaultScrapeOption;

    switch (args[index]) {
      case "--extractMethod":
        option.extractMethod = value;
        break;
      case "--withllm":
        if (value !== "true" && value !== "false") {
          return defaultScrapeOption;
        }
        option.withllm = value === "true";
        break;
      case "--lang":
        option.lang = value;
        break;
      default:
        return defaultScrapeOption;
    }
    index += 1;
  }

  const extractMethod = Object.values(ExtractMethod).find(
    (method) => method === option.extractMethod,
  );
  const lang = Object.values(Lang).find((value) => value === option.lang);
  if (!extractMethod || !lang) return defaultScrapeOption;

  return { extractMethod, withllm: option.withllm, lang };
}

function hasUrl(commandName: string): boolean {
  if (url) return true;
  console.error(`Usage: swimming-pool-hk-scraper ${commandName} <url>`);
  process.exitCode = 2;
  return false;
}

const scrapeOptionIndex = command === "schedule" ? 3 : 4;
const scrapeOption = getScrapeOption(process.argv.slice(scrapeOptionIndex));

const startedAt = performance.now();

switch (command) {
  case "admission":
    await saveAdmissionData();
    break;
  case "basic":
    await saveBasicData();
    break;
  case "schedule":
    await saveScheduleData(scrapeOption);
    break;
  case "opening": {
    if (!hasUrl(command)) break;
    await scrapeOpening(
      { url: url!, lang: scrapeOption.lang },
      scrapeOption,
    );
    break;
  }
  case "weekly_closure": {
    if (!hasUrl(command)) break;
    await scrapeWeeklyClosure(
      { url: url!, lang: scrapeOption.lang },
      scrapeOption,
    );
    break;
  }
  case "annual_closure": {
    if (!hasUrl(command)) break;
    await scrapeAnnualClosure(
      { url: url!, lang: scrapeOption.lang },
      scrapeOption,
    );
    break;
  }
  case "temp_closure": {
    if (!hasUrl(command)) break;
    await scrapeTempClosure(
      { url: url!, lang: scrapeOption.lang },
      scrapeOption,
    );
    break;
  }
  default:
    console.error(
      `Usage: swimming-pool-hk-scraper <admission|basic|schedule|opening|weekly_closure|annual_closure|temp_closure> [url] ${scrapeOptionUsage}`,
    );
    process.exitCode = 1;
}

console.log(
  `Processing time: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`,
);
