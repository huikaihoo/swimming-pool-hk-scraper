import { load } from "cheerio";
import { parse, type ParsedComponents } from "chrono-node";
import { Lang } from "../types";
import type { OpeningOutput, ScrapeInput, ScrapeOutput } from "../types";

function extractOpeningSchedules(html: string): string[] {
  const $ = load(html);
  const headings = $("h1, h2, h3, h4, h5, h6, [role='heading'], .panel-heading")
    .filter((_, element) =>
      $(element).text().trim().endsWith("Opening Schedule Information"),
    )
    .toArray();

  if (headings.length === 0) {
    throw new Error(
      'Could not find an "Opening Schedule Information" heading.',
    );
  }

  return headings.map((heading) => {
    const title = $(heading).text().trim();
    const table = $(heading).closest("tr").next().find("table").first();
    if (table.length === 0) {
      throw new Error(`Could not find the table below "${title}".`);
    }

    const rows = table.find("tr").toArray();
    const getCellLines = (cell: string): string[] => {
      const cellHtml = cell
        .replace(/<br\b[^>]*>/gi, "\n")
        .replace(/<\/(?:p|div|li)\s*>/gi, "\n");
      return load(`<div>${cellHtml}</div>`)("body")
        .text()
        .split(/\r?\n/)
        .filter((line) => line.trim());
    };
    const sessionLines = rows.flatMap((row) => {
      const cell = $(row)
        .children("td")
        .toArray()
        .reverse()
        .find((element) => /session/i.test($(element).text()));
      return cell ? getCellLines($(cell).html() ?? "") : [];
    });
    const tableLines = rows.flatMap((row) =>
      $(row)
        .children("td, th")
        .toArray()
        .flatMap((cell) => getCellLines($(cell).html() ?? "")),
    );
    const lines = sessionLines.length > 0 ? sessionLines : tableLines;

    if (lines.length === 0) {
      throw new Error(`Could not find a session column below "${title}".`);
    }

    return [title, ...lines].join("\n");
  });
}

function formatTime(components: ParsedComponents): string {
  const hour = components.get("hour");
  const minute = components.get("minute");
  const second = components.get("second") ?? 0;
  if (hour === null || minute === null) {
    throw new Error("Chrono returned an incomplete opening time.");
  }

  return [hour, minute, second]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export async function scrapeOpening_v2(
  input: ScrapeInput,
): Promise<ScrapeOutput<OpeningOutput[]>> {
  let html = input.html;
  const openings: OpeningOutput[] = [];

  if (input.lang !== Lang.En) {
    console.error("Opening schedule scraping supports English only.");
    process.exitCode = 1;
    return { data: openings, ...(html === undefined ? {} : { html }) };
  }

  try {
    if (html === undefined) {
      const pageResponse = await fetch(input.url);
      if (!pageResponse.ok) {
        throw new Error(`Page request failed (HTTP ${pageResponse.status}).`);
      }
      html = await pageResponse.text();
    }

    for (const state of extractOpeningSchedules(html)) {
      process.stdout.write(`${state}\n`);
      const [, ...lines] = state.split(/\r?\n/);
      const sessionLines = lines.flatMap((line, index) => {
        if (!/session/i.test(line) || /break/i.test(line)) return [];
        if (!/:\s*$/.test(line)) return [line];
        const nextLine = lines[index + 1];
        return nextLine && !/session|break/i.test(nextLine) ? [nextLine] : [];
      });
      const openingLines = sessionLines.length > 0 ? sessionLines : lines;
      const sessions = openingLines.flatMap((line): OpeningOutput[] => {
        if (/break/i.test(line)) return [];
        const result = parse(line).find(
          (candidate) =>
            candidate.end &&
            candidate.start.isCertain("hour") &&
            candidate.end.isCertain("hour"),
        );
        if (!result?.end) return [];
        return [{
          start_time: formatTime(result.start),
          end_time: formatTime(result.end),
        }];
      });

      const uniqueSessions = new Map(
        sessions.map((session) => [
          `${session.start_time}/${session.end_time}`,
          session,
        ]),
      );
      const uniqueSessionValues = [...uniqueSessions.values()];
      openings.push(...uniqueSessionValues);
      process.stdout.write(`${JSON.stringify(uniqueSessionValues, null, 2)}\n`);
    }

    return { data: openings, html };
  } catch (error) {
    console.error(
      "Failed to scrape opening schedule:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return { data: openings, ...(html === undefined ? {} : { html }) };
  }
}
