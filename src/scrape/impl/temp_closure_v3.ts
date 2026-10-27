import { load } from "cheerio";
import { isValid, parseISO } from "date-fns";
import { getLocalizedTempClosureFields } from "../utils";
import { Lang } from "../types";
import type {
  ScrapeInput,
  ScrapeOutput,
  TempClosureOutput,
} from "../types";

type ClosureDateTime = Pick<TempClosureOutput, "start_time" | "end_time">;
const closureDateTimePattern = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/;

function formatHongKongDateTime(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
): string {
  const localDateTime = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
  const parsedDate = parseISO(localDateTime);
  if (!isValid(parsedDate)) {
    throw new Error(`Invalid date and time: ${localDateTime}`);
  }

  return localDateTime;
}

function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`Missing date and time capture at index ${index}.`);
  }
  return value;
}

function parseDateTime(value: string): string {
  const match = value.trim().match(closureDateTimePattern);
  if (!match) {
    throw new Error(`Unexpected closure date/time format: ${value}`);
  }

  return formatHongKongDateTime(
    capture(match, 1),
    capture(match, 2),
    capture(match, 3),
    capture(match, 4),
    capture(match, 5),
  );
}

function parseDateTimeRange(value: string): ClosureDateTime {
  const normalized = value.trim();
  const untilFurtherNotice = normalized.match(
    /^(.*?)\s*(?:[-–—]\s*)?(?:until further notice|直至另行通告(?:為止)?|直至另行通知(?:為止)?)$/i,
  );

  if (untilFurtherNotice) {
    const startValue = (untilFurtherNotice[1] ?? "").trim();
    const startTime =
      startValue && closureDateTimePattern.test(startValue)
        ? parseDateTime(startValue)
        : null;
    return { start_time: startTime, end_time: null };
  }

  const match = normalized.match(
    /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s*[-–—]\s*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unexpected closure date and time format: ${value}`);
  }

  return {
    start_time: parseDateTime(capture(match, 1)),
    end_time: parseDateTime(capture(match, 2)),
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHtmlText(value: string): string {
  const htmlWithSeparators = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<(?:p|div|li)\b[^>]*>/gi, " ")
    .replace(/<\/(?:p|div|li)\s*>/gi, " ");
  const fragment = load(`<div>${htmlWithSeparators}</div>`);
  return normalizeText(fragment("body").text());
}

function extractClosureNotices(
  html: string,
  lang: ScrapeInput["lang"],
): TempClosureOutput[] {
  const $ = load(html);
  const notices: TempClosureOutput[] = [];
  const rows = $(
    "div.panel-primary table.table-bordered.table-striped tbody tr",
  );
  const tableRows = rows.toArray();

  if (!rows.length) {
    throw new Error("Could not find the temporary closure table in the HTML.");
  }

  const table = $("div.panel-primary table.table-bordered.table-striped").first();
  const getColumnCount = (row: (typeof tableRows)[number]) =>
    $(row)
      .children("td, th")
      .toArray()
      .reduce((count, cell) => {
        const span = Number.parseInt($(cell).attr("colspan") ?? "1", 10);
        return count + (Number.isFinite(span) && span > 0 ? span : 1);
      }, 0);
  const headerColumnCount = table
    .find("thead tr")
    .toArray()
    .reduce((count, row) => Math.max(count, getColumnCount(row)), 0);
  const tableColumnCount = Math.max(
    headerColumnCount,
    ...tableRows.map(getColumnCount),
  );
  const dataRows = tableRows.filter((row) => {
    const cells = $(row).children("td");
    return !(
      cells.length === 1 &&
      getColumnCount(row) >= tableColumnCount
    );
  });
  if (dataRows.length === 0) return [];

  let previousDateTime: ClosureDateTime | undefined;

  dataRows.forEach((row) => {
    const cells = $(row).children("td");
    if (cells.length === 0) return;
    if (cells.length < 4) {
      throw new Error("Closure table row did not contain all expected columns.");
    }

    const dateTime = normalizeText(cells.eq(0).text());
    const facilities = normalizeText(cells.eq(1).text());
    const reason = normalizeText(cells.eq(2).text());
    const rawRemarks = normalizeHtmlText(cells.eq(3).html() ?? "");
    const remarks =
      /^n\/a$/i.test(rawRemarks) ||
      (lang === Lang.Tc && rawRemarks === "不適用")
        ? ""
        : rawRemarks;
    let currentDateTime: ClosureDateTime;

    if (dateTime) {
      currentDateTime = parseDateTimeRange(dateTime);
      previousDateTime = currentDateTime;
    } else if (previousDateTime) {
      currentDateTime = previousDateTime;
    } else {
      throw new Error(
        "Closure table row has no date/time and no preceding date/time to reuse.",
      );
    }

    notices.push({
      ...currentDateTime,
      ...getLocalizedTempClosureFields(facilities, reason, remarks, lang),
    });
  });

  return notices;
}

export async function scrapeTempClosure_v3(
  input: ScrapeInput,
): Promise<ScrapeOutput<TempClosureOutput[]>> {
  let html = input.html;
  try {
    if (html === undefined) {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(
          `Page request failed (HTTP ${response.status}): ${response.statusText}`,
        );
      }
      html = await response.text();
    }

    const notices = extractClosureNotices(html, input.lang);
    process.stdout.write(`${JSON.stringify(notices, null, 2)}\n`);
    return { data: notices, html };
  } catch (error) {
    console.error(
      "Failed to scrape Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return { data: [], ...(html === undefined ? {} : { html }) };
  }
}
