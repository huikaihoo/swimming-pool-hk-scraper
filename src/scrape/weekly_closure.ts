import { scrapeWeeklyClosure_v1 } from "./impl/weekly_closure_v1";
import {
  defaultScrapeOption,
  type ScrapeInput,
  type ScrapeOutput,
  type ScrapeOption,
  type WeeklyClosureOutput,
} from "./types";

export async function scrapeWeeklyClosure(
  input: ScrapeInput,
  option: ScrapeOption = defaultScrapeOption,
): Promise<ScrapeOutput<WeeklyClosureOutput>> {
  return scrapeWeeklyClosure_v1(input);
}
