import { parse } from "chrono-node";
import { load } from "cheerio";
import type {
  ScrapeInput,
  ScrapeOutput,
  WeeklyClosureOutput,
} from "../types";

const weeklyClosureHeading = "Weekly Cleansing Operation";

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTextLines(html: string): string[] {
  const lineBreak = "\uE000";
  const htmlWithLineBreaks = html
    .replace(/<br\s*\/?>/gi, lineBreak)
    .replace(/<\/p\s*>/gi, lineBreak);
  const fragment = load(`<div>${htmlWithLineBreaks}</div>`);

  return fragment("body")
    .text()
    .split(lineBreak)
    .map(normalizeText)
    .filter(Boolean);
}

function extractWeeklyClosureLines(html: string): string[] {
  const $ = load(html);
  const heading = $("h1, h2, h3, h4, h5, h6, [role='heading']")
    .filter((_, element) => normalizeText($(element).text()) === weeklyClosureHeading)
    .first();

  if (heading.length === 0) {
    throw new Error(`Could not find "${weeklyClosureHeading}" in the HTML.`);
  }

  const weeklyDataRow = heading
    .closest("tr")
    .nextAll("tr")
    .filter((_, row) => $(row).find("table td").length > 0)
    .first();

  if (weeklyDataRow.length === 0) {
    throw new Error(`Could not find the table below "${weeklyClosureHeading}".`);
  }

  const cells = weeklyDataRow.find("table").first().find("td").toArray();
  return cells.flatMap((cell) => getTextLines($.html(cell) ?? ""));
}

function extractWeekday(line: string): number | null {
  const result = parse(line).find((candidate) => {
    const weekday = candidate.start.get("weekday");
    return weekday !== null && weekday !== undefined;
  });

  return result?.start.get("weekday") ?? null;
}

export async function scrapeWeeklyClosure_v1(
  input: ScrapeInput,
): Promise<ScrapeOutput<WeeklyClosureOutput>> {
  let html = input.html;
  try {
    if (html === undefined) {
      const pageResponse = await fetch(input.url);
      if (!pageResponse.ok) {
        throw new Error(
          `Page request failed (HTTP ${pageResponse.status}): ${pageResponse.statusText}`,
        );
      }
      html = await pageResponse.text();
    }

    const weeklyLines = extractWeeklyClosureLines(html);
    if (weeklyLines.length === 0) {
      throw new Error("No weekly cleansing operation lines were found.");
    }

    const weekdays: number[] = [];
    for (const line of weeklyLines) {
      process.stdout.write(`${line}\n`);

      try {
        const weekday = extractWeekday(line);
        if (weekday !== null) weekdays.push(weekday);
      } catch (error) {
        console.error(
          "Failed to parse weekly cleansing operation line:",
          error instanceof Error ? error.message : error,
        );
        process.exitCode = 1;
      }
    }
    const result: WeeklyClosureOutput = {
      weekday: weekdays[0] ?? null,
      alt_weekday: weekdays[1] ?? null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return { data: result, html };
  } catch (error) {
    console.error(
      "Failed to scrape Weekly Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return {
      data: { weekday: null, alt_weekday: null },
      ...(html === undefined ? {} : { html }),
    };
  }
}
