import { scrapeOpening_v1 } from "./impl/opening_v1";
import { scrapeOpening_v2 } from "./impl/opening_v2";
import {
  defaultScrapeOption,
  type OpeningOutput,
  type ScrapeInput,
  type ScrapeOption,
  type ScrapeOutput,
} from "./types";

export async function scrapeOpening(
  input: ScrapeInput,
  option: ScrapeOption = defaultScrapeOption,
): Promise<ScrapeOutput<OpeningOutput[]>> {
  return option.withllm ? scrapeOpening_v1(input) : scrapeOpening_v2(input);
}
