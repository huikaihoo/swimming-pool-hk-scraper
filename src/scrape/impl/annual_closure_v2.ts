import { parse, strict } from "chrono-node";
import { casual as tcCasual, strict as tcStrict } from "chrono-node/zh/hant";
import { load } from "cheerio";
import {
  extendChronoTcSupport,
  getLocalizedAnnualFacility,
} from "../utils";
import { Lang } from "../types";
import type {
  AnnualClosureOutput,
  ScrapeInput,
  ScrapeOutput,
} from "../types";

const annualClosureHeading: Record<Lang, string> = {
  [Lang.En]: "Temporary Closure for Annual Maintenance",
  [Lang.Tc]: "配合每年維修工程的暫停開放時間",
};
const facilityDateSeparatorPattern = /[:：﹕]/u;

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTextLines(html: string): string[] {
  const lineBreak = "\uE000";
  const htmlWithLineBreaks = html
    .replace(/<br\b[^>]*>/gi, lineBreak)
    .replace(/<\/(?:p|div|li|tr|td|th)\s*>/gi, lineBreak);
  const fragment = load(`<div>${htmlWithLineBreaks}</div>`);

  return fragment("body")
    .text()
    .split(new RegExp(`(?:${lineBreak}|\\r?\\n)`))
    .map((line) => line.trim())
    .filter(Boolean);
}

const tcCasualWithSupport = extendChronoTcSupport(tcCasual);
const tcStrictWithSupport = extendChronoTcSupport(tcStrict);

function parseDateRange(
  line: string,
  lang: Lang,
  reference: { instant: Date; timezone: number },
  options?: { forwardDate?: boolean },
) {
  return lang === Lang.Tc
    ? tcCasualWithSupport.parse(line, reference, options)
    : parse(line, reference, options);
}

function parseStrictDateRange(
  line: string,
  lang: Lang,
  reference: { instant: Date; timezone: number },
  options?: { forwardDate?: boolean },
) {
  return lang === Lang.Tc
    ? tcStrictWithSupport.parse(line, reference, options)
    : strict.parse(line, reference, options);
}

type DateRangeResult = ReturnType<typeof strict.parse>[number];

function getDateRangeConfidence(result: DateRangeResult): number {
  if (!result.end) return -1;

  const components = ["year", "month", "day"] as const;
  return components.reduce(
    (confidence, component) =>
      confidence +
      Number(result.start.isCertain(component)) +
      Number(result.end?.isCertain(component)),
    0,
  );
}

function hasDateRange(
  line: string,
  lang: Lang,
  referenceDate: Date,
): boolean {
  const reference = { instant: referenceDate, timezone: 480 };
  return (
    parseDateRange(line, lang, reference).some((result) => Boolean(result.end)) ||
    parseStrictDateRange(line, lang, reference).some((result) => Boolean(result.end))
  );
}

function groupFacilityAndDateLines(
  lines: string[],
  lang: Lang,
  referenceDate: Date,
): string[] {
  const items: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (
      line &&
      nextLine &&
      !hasDateRange(line, lang, referenceDate) &&
      hasDateRange(nextLine, lang, referenceDate)
    ) {
      items.push(`${line}\n${nextLine}`);
      index += 1;
    } else if (line) {
      items.push(line);
    }
  }

  return items;
}

function extractAnnualClosureLines(
  html: string,
  lang: Lang,
  referenceDate: Date,
): string[] {
  const $ = load(html);
  const localizedHeading = annualClosureHeading[lang];
  const normalizedHeading = localizedHeading.toLowerCase();
  const headingCandidates = $(
    "h1, h2, h3, h4, h5, h6, [role='heading'], .panel-heading, strong, b",
  ).toArray();
  const allCandidates = $("*").toArray();
  const matchesHeading = (element: (typeof allCandidates)[number]) =>
    normalizeText($(element).text()).toLowerCase() === normalizedHeading;
  const heading =
    headingCandidates.find(matchesHeading) ??
    allCandidates.find(matchesHeading);

  if (!heading) {
    throw new Error(`Could not find "${localizedHeading}" in the HTML.`);
  }

  const boundary = $(heading)
    .closest("section, article, .panel-primary, .panel")
    .get(0);
  let current: typeof heading | undefined = heading;

  while (current) {
    let sibling = $(current).next();
    while (sibling.length) {
      const siblingNode = sibling.get(0);
      const siblingHtml = siblingNode ? $.html(siblingNode) : null;
      const followingLines = siblingHtml
        ? getTextLines(siblingHtml).filter(
            (line) => line.toLowerCase() !== normalizedHeading,
          )
        : [];

      if (followingLines.length > 0) {
        return groupFacilityAndDateLines(followingLines, lang, referenceDate);
      }
      sibling = sibling.next();
    }

    if (boundary && current === boundary) break;
    current = $(current).parent().get(0);
  }

  throw new Error(
    `Could not find text below "${localizedHeading}" in the HTML.`,
  );
}

type ParsedMaintenanceLine = {
  facilities: string;
  maintenance_start_date: string;
  maintenance_end_date: string;
};

function parseMaintenanceDates(
  line: string,
  referenceDate: Date,
  lang: Lang,
): ParsedMaintenanceLine {
  const colonIndex = line.search(facilityDateSeparatorPattern);
  const facilities = colonIndex === -1 ? "" : line.slice(0, colonIndex).trim();
  const rawDateText = colonIndex === -1 ? line : line.slice(colonIndex + 1);
  const reference = {
    instant: referenceDate,
    timezone: 480,
  };
  const options = { forwardDate: true };
  const casualResults = parseDateRange(rawDateText, lang, reference, options);
  const strictResults = parseStrictDateRange(rawDateText, lang, reference, options);
  const result = [...strictResults, ...casualResults]
    .filter((candidate) => Boolean(candidate.end))
    .sort(
      (first, second) =>
        getDateRangeConfidence(second) - getDateRangeConfidence(first),
    )[0];

  if (!result?.end) {
    throw new Error(`Could not parse a start and end date from: ${rawDateText}`);
  }

  const startDate = result.start.date();
  const endDate = result.end.date();
  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error(`End date must be after start date: ${rawDateText}`);
  }

  return {
    facilities,
    maintenance_start_date: startDate.toISOString().slice(0, 10),
    maintenance_end_date: endDate.toISOString().slice(0, 10),
  };
}

export async function scrapeAnnualClosure_v2(
  input: ScrapeInput,
): Promise<ScrapeOutput<AnnualClosureOutput[]>> {
  const closures: AnnualClosureOutput[] = [];
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

    const currentYear = new Date().getFullYear();
    const referenceDate = new Date(Date.UTC(currentYear, 0, 1, 4));
    const maintenanceLines = extractAnnualClosureLines(
      html,
      input.lang,
      referenceDate,
    );
    if (maintenanceLines.length === 0) {
      throw new Error("No annual maintenance table lines were found.");
    }

    for (const line of maintenanceLines) {
      const maintenanceText = line;
      process.stdout.write(`${maintenanceText}\n`);

      try {
        const parsedLine = parseMaintenanceDates(line, referenceDate, input.lang);
        const closure: AnnualClosureOutput = {
          ...getLocalizedAnnualFacility(parsedLine.facilities, input.lang),
          maintenance_start_date: parsedLine.maintenance_start_date,
          maintenance_end_date: parsedLine.maintenance_end_date,
        };
        closures.push(closure);
        process.stdout.write(`${JSON.stringify(closure, null, 2)}\n`);
      } catch (error) {
        console.error(
          "Failed to parse annual maintenance line:",
          error instanceof Error ? error.message : error,
        );
        process.exitCode = 1;
      }
    }
    return { data: closures, html };
  } catch (error) {
    console.error(
      "Failed to scrape Annual Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return { data: closures, ...(html === undefined ? {} : { html }) };
  }
}
