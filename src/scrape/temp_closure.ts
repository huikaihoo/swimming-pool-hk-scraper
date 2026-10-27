import { scrapeTempClosure_v1 } from "./impl/temp_closure_v1";
import { scrapeTempClosure_v2 } from "./impl/temp_closure_v2";
import { scrapeTempClosure_v3 } from "./impl/temp_closure_v3";
import {
  defaultScrapeOption,
  ExtractMethod,
  Lang,
  type ScrapeOption,
  type ScrapeInput,
  type ScrapeOutput,
  type TempClosureOutput,
} from "./types";

export async function scrapeTempClosure(
  input: ScrapeInput,
  option: ScrapeOption = defaultScrapeOption,
): Promise<ScrapeOutput<TempClosureOutput[]>> {
  if (
    option.extractMethod === ExtractMethod.Crawl4AI &&
    option.lang === Lang.En
  ) {
    const data = option.withllm
      ? await scrapeTempClosure_v1(input)
      : await scrapeTempClosure_v2(input);
    return { data };
  }

  return scrapeTempClosure_v3(input);
}
