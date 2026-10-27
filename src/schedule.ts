import * as fs from "fs";
import * as path from "path";
import { scrapeAnnualClosure } from "./scrape/annual_closure";
import { scrapeOpening } from "./scrape/opening";
import {
  defaultScrapeOption,
  Lang,
  type AnnualClosureOutput,
  type ScrapeInput,
  type ScrapeOption,
  type TempClosureOutput,
} from "./scrape/types";
import type { BasicData, ScheduleData } from "./types";
import { scrapeTempClosure } from "./scrape/temp_closure";
import { scrapeWeeklyClosure } from "./scrape/weekly_closure";

function mergeTempClosures(
  english: TempClosureOutput[],
  traditionalChinese: TempClosureOutput[],
): TempClosureOutput[] {
  const count = Math.max(english.length, traditionalChinese.length);

  return Array.from({ length: count }, (_, index) => {
    const en = english[index];
    const tc = traditionalChinese[index];
    const dateFields = en ?? tc;

    return {
      start_time: dateFields?.start_time ?? null,
      end_time: dateFields?.end_time ?? null,
      ...(en?.facilities_en === undefined
        ? {}
        : { facilities_en: en.facilities_en }),
      ...(tc?.facilities_tc === undefined
        ? {}
        : { facilities_tc: tc.facilities_tc }),
      ...(en?.reason_en === undefined ? {} : { reason_en: en.reason_en }),
      ...(tc?.reason_tc === undefined ? {} : { reason_tc: tc.reason_tc }),
      ...(en?.remarks_en === undefined ? {} : { remarks_en: en.remarks_en }),
      ...(tc?.remarks_tc === undefined ? {} : { remarks_tc: tc.remarks_tc }),
    };
  });
}

function mergeAnnualClosures(
  english: AnnualClosureOutput[],
  traditionalChinese: AnnualClosureOutput[],
): AnnualClosureOutput[] {
  const unmatchedTraditionalChinese = new Set(
    traditionalChinese.map((_, index) => index),
  );
  const closures = english.map((en) => {
    const matchingIndex = traditionalChinese.findIndex(
      (tc, index) =>
        unmatchedTraditionalChinese.has(index) &&
        tc.maintenance_start_date === en.maintenance_start_date &&
        tc.maintenance_end_date === en.maintenance_end_date,
    );
    const tc =
      matchingIndex === -1 ? undefined : traditionalChinese[matchingIndex];
    if (matchingIndex !== -1) {
      unmatchedTraditionalChinese.delete(matchingIndex);
    }

    return {
      maintenance_start_date: en.maintenance_start_date,
      maintenance_end_date: en.maintenance_end_date,
      ...(en.facilities_en === undefined
        ? {}
        : { facilities_en: en.facilities_en }),
      ...(tc?.facilities_tc === undefined
        ? {}
        : { facilities_tc: tc.facilities_tc }),
    };
  });

  for (const index of unmatchedTraditionalChinese) {
    const tc = traditionalChinese[index];
    if (tc) closures.push({ ...tc });
  }

  return closures;
}

export async function saveScheduleData(
  option: ScrapeOption = defaultScrapeOption,
): Promise<void> {
  let data: unknown;
  try {
    data = await Bun.file("data/basic/latest.json").json();
  } catch (error) {
    console.error(
      "Failed to read data/basic/latest.json:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(data)) {
    console.error("data/basic/latest.json must contain a JSON array.");
    process.exitCode = 1;
    return;
  }

  const schedules: ScheduleData[] = [];

  for (const [index, value] of data.entries()) {
    if (typeof value !== "object" || value === null) {
      console.error(`Skipping record ${index + 1}: expected an object.`);
      process.exitCode = 1;
      continue;
    }

    const pool = value as BasicData;
    const name = pool.name_en;
    if (typeof name !== "string" || !name.trim()) {
      console.error(`Skipping record ${index + 1}: name_en is missing.`);
      process.exitCode = 1;
      continue;
    }

    const url = pool.url_en;
    if (typeof url !== "string" || !url.trim()) {
      console.error(`Skipping record ${index + 1}: url_en is missing.`);
      process.exitCode = 1;
      continue;
    }
    const tcUrl = pool.url_tc;
    if (typeof tcUrl !== "string" || !tcUrl.trim()) {
      console.error(`Skipping record ${index + 1}: url_tc is missing.`);
      process.exitCode = 1;
      continue;
    }

    const poolUrl = url.trim();
    const poolTcUrl = tcUrl.trim();
    const englishOption = { ...option, lang: Lang.En };
    const tcOption = { ...option, lang: Lang.Tc };

    console.log(
      `Starting to scrape: [${name.trim()}]\n URL(en): ${poolUrl}\n URL(tc): ${poolTcUrl}`,
    );
    let englishInput: ScrapeInput = { url: poolUrl, lang: Lang.En };
    let tcInput: ScrapeInput = { url: poolTcUrl, lang: Lang.Tc };

    // 1. Scrape opening hours
    const opening = await scrapeOpening(englishInput, englishOption);
    if (opening.html !== undefined) {
      englishInput = { ...englishInput, html: opening.html };
    }

    // 2. Scrape weekly closure
    const weeklyClosure = await scrapeWeeklyClosure(
      englishInput,
      englishOption,
    );
    if (weeklyClosure.html !== undefined) {
      englishInput = { ...englishInput, html: weeklyClosure.html };
    }

    // 3A. Scrape annual closure in English
    const annualClosureEn = await scrapeAnnualClosure(
      englishInput,
      englishOption,
    );
    if (annualClosureEn.html !== undefined) {
      englishInput = { ...englishInput, html: annualClosureEn.html };
    }

    // 3B. Scrape annual closure in Traditional Chinese
    const annualClosureTc = await scrapeAnnualClosure(tcInput, tcOption);
    if (annualClosureTc.html !== undefined) {
      tcInput = { ...tcInput, html: annualClosureTc.html };
    }

    // 4A. Scrape temporary closure in English
    const tempClosureEn = await scrapeTempClosure(englishInput, englishOption);

    // 4B. Scrape temporary closure in Traditional Chineses
    const tempClosureTc = await scrapeTempClosure(tcInput, tcOption);

    schedules.push({
      name_en: name.trim(),
      opening: opening.data,
      weekly_closure: weeklyClosure.data,
      annual_closure: mergeAnnualClosures(
        annualClosureEn.data,
        annualClosureTc.data,
      ),
      temp_closure: mergeTempClosures(tempClosureEn.data, tempClosureTc.data),
    });
  }

  if (process.exitCode) {
    console.error(
      "Schedule data was not saved because one or more pool scrapes failed.",
    );
    return;
  }

  try {
    const dataDir = path.join(process.cwd(), "data", "schedule");
    fs.mkdirSync(dataDir, { recursive: true });

    const dataPath = path.join(dataDir, "latest.json");
    fs.writeFileSync(dataPath, `${JSON.stringify(schedules, null, 2)}\n`);

    console.log(
      `Successfully saved schedules for ${schedules.length} swimming pools to data/schedule/latest.json`,
    );
  } catch (error) {
    console.error(
      "Failed to save schedule data:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  }
}
