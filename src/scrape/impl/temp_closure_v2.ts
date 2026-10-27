import { isValid, parseISO } from "date-fns";
import { getLocalizedTempClosureFields } from "../utils";
import type { ScrapeInput, TempClosureOutput } from "../types";

const closureSchema = {
  name: "Swimming Pool Temporary Closures",
  baseSelector: "div.panel-primary table.table-bordered.table-striped tbody tr",
  fields: [
    { name: "date_time", selector: "td:nth-child(1)", type: "text" },
    { name: "facilities", selector: "td:nth-child(2)", type: "text" },
    { name: "reason", selector: "td:nth-child(3)", type: "text" },
    { name: "remarks", selector: "td:nth-child(4)", type: "text" },
  ],
};

type CrawlResult = {
  success?: boolean;
  error_message?: string;
  extracted_content?: string;
};

type CrawlResponse = {
  success?: boolean;
  detail?: unknown;
  error?: unknown;
  results?: CrawlResult[];
};

type ClosureRow = {
  date_time?: unknown;
  facilities?: unknown;
  reason?: unknown;
  remarks?: unknown;
};

type ClosureDateTime = Pick<TempClosureOutput, "start_time" | "end_time">;

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

function parseDateTimeRange(value: string): ClosureDateTime {
  const normalized = value.replace(/\u00a0/g, " ").trim();
  const untilFurtherNotice = normalized.match(
    /^(.*?)\s*(?:[-–—]\s*)?until further notice$/i,
  );

  if (untilFurtherNotice) {
    const startValue = (untilFurtherNotice[1] ?? "").trim();
    const startTime =
      !startValue || /^(?:temporarily\s+)?closed$/i.test(startValue)
        ? null
        : parseDateTime(startValue);
    return { start_time: startTime, end_time: null };
  }

  const match = normalized.match(
    /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*[-–—]\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/,
  );

  if (!match) {
    throw new Error(`Unexpected closure date and time format: ${normalized}`);
  }

  const capture = (index: number): string => {
    const group = match[index];
    if (group === undefined) {
      throw new Error(`Missing date and time capture at index ${index}.`);
    }
    return group;
  };

  return {
    start_time: formatHongKongDateTime(
      capture(1),
      capture(2),
      capture(3),
      capture(4),
      capture(5),
    ),
    end_time: formatHongKongDateTime(
      capture(6),
      capture(7),
      capture(8),
      capture(9),
      capture(10),
    ),
  };
}

function parseDateTime(value: string): string {
  const match = value
    .trim()
    .match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Unexpected closure date/time format: ${value}`);
  }

  const capture = (index: number): string => {
    const group = match[index];
    if (group === undefined) {
      throw new Error(`Missing date and time capture at index ${index}.`);
    }
    return group;
  };

  return formatHongKongDateTime(
    capture(1),
    capture(2),
    capture(3),
    capture(4),
    capture(5),
  );
}

function parseClosureRows(
  extractedContent: string,
  lang: ScrapeInput["lang"],
): TempClosureOutput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractedContent);
  } catch {
    throw new Error("Crawl4AI returned invalid extracted JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Crawl4AI extracted content was not a JSON array.");
  }

  const rows = parsed as ClosureRow[];
  const hasNoRelatedNotice = rows.some((row) =>
    Object.values(row).some(
      (value) =>
        typeof value === "string" &&
        value.trim().toLowerCase() === "no related notice",
    ),
  );
  if (hasNoRelatedNotice) return [];

  const notices: TempClosureOutput[] = [];
  let previousDateTime: ClosureDateTime | undefined;

  for (const [index, row] of rows.entries()) {
    if (
      typeof row.date_time !== "string" ||
      typeof row.facilities !== "string" ||
      typeof row.reason !== "string"
    ) {
      throw new Error(`Crawl4AI returned an incomplete closure row at index ${index}.`);
    }

    let currentDateTime: ClosureDateTime;
    if (row.date_time.trim()) {
      currentDateTime = parseDateTimeRange(row.date_time);
      previousDateTime = currentDateTime;
    } else if (previousDateTime) {
      currentDateTime = previousDateTime;
    } else {
      throw new Error(
        "Closure table row has no date/time and no preceding date/time to reuse.",
      );
    }

    const remarks = typeof row.remarks === "string" ? row.remarks.trim() : "";
    notices.push({
      ...currentDateTime,
      ...getLocalizedTempClosureFields(
        row.facilities.trim(),
        row.reason.trim(),
        /^n\/a$/i.test(remarks) ? "" : remarks,
        lang,
      ),
    });
  }

  return notices;
}

export async function scrapeTempClosure_v2(
  input: ScrapeInput,
): Promise<TempClosureOutput[]> {
  const crawl4aiToken = Bun.env.CRAWL4AI_API_TOKEN;
  if (!crawl4aiToken) {
    console.error("CRAWL4AI_API_TOKEN is not set in .env or the environment.");
    process.exitCode = 1;
    return [];
  }

  try {
    const response = await fetch("http://localhost:11235/crawl", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${crawl4aiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [input.url],
        crawler_config: {
          cache_mode: "BYPASS",
          extraction_strategy: {
            type: "JsonCssExtractionStrategy",
            params: { schema: closureSchema },
          },
        },
      }),
    });

    const responseText = await response.text();
    let result: CrawlResponse;
    try {
      result = JSON.parse(responseText) as CrawlResponse;
    } catch {
      throw new Error(`Crawl4AI returned invalid JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const detail = result.detail ?? result.error ?? response.statusText;
      throw new Error(
        `Crawl4AI request failed (HTTP ${response.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
      );
    }

    const crawlResult = result.results?.[0];
    if (!result.success || !crawlResult) {
      throw new Error("Crawl4AI did not return a crawl result.");
    }
    if (!crawlResult.success) {
      throw new Error(
        crawlResult.error_message ?? "Crawl4AI failed to crawl the page.",
      );
    }
    if (typeof crawlResult.extracted_content !== "string") {
      throw new Error("Crawl4AI response did not contain extracted JSON.");
    }

    const closures = parseClosureRows(crawlResult.extracted_content, input.lang);
    process.stdout.write(`${JSON.stringify(closures, null, 2)}\n`);
    return closures;
  } catch (error) {
    console.error(
      "Failed to scrape Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return [];
  }
}
