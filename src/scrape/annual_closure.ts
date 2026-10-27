import { scrapeAnnualClosure_v1 } from "./impl/annual_closure_v1";
import { scrapeAnnualClosure_v2 } from "./impl/annual_closure_v2";
import {
  defaultScrapeOption,
  ExtractMethod,
  Lang,
  type AnnualClosureOutput,
  type ScrapeInput,
  type ScrapeOutput,
  type ScrapeOption,
} from "./types";

export async function scrapeAnnualClosure(
  input: ScrapeInput,
  option: ScrapeOption = defaultScrapeOption,
): Promise<ScrapeOutput<AnnualClosureOutput[]>> {
  if (
    option.extractMethod === ExtractMethod.Cheerio &&
    option.withllm &&
    option.lang === Lang.En
  ) {
    return { data: await scrapeAnnualClosure_v1(input) };
  }

  return scrapeAnnualClosure_v2(input);
}
