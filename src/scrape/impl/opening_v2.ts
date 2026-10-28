import { load } from "cheerio";
import { parse, type ParsedComponents } from "chrono-node";
import { Lang } from "../types";
import type { OpeningOutput, ScrapeInput, ScrapeOutput } from "../types";

type OpeningScheduleCandidate = {
  title: string;
  lines: string[];
};

function extractOpeningScheduleCandidates(
  html: string,
): OpeningScheduleCandidate[] {
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

  const candidates: OpeningScheduleCandidate[] = [];
  const seenTables = new Set<object>();
  const getCellLines = (cell: string): string[] => {
    const cellHtml = cell
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li)\s*>/gi, "\n");
    return load(`<div>${cellHtml}</div>`)("body")
      .text()
      .split(/\r?\n/)
      .filter((line) => line.trim());
  };

  for (const heading of headings.reverse()) {
    const title = $(heading).text().trim();
    const tables = $(heading).closest("tr").next().find("table").toArray();
    const leafTables = tables.filter(
      (table) => $(table).find("table").length === 0,
    );
    const scheduleTables = (leafTables.length > 0 ? leafTables : tables).reverse();

    for (const table of scheduleTables) {
      if (seenTables.has(table)) continue;
      seenTables.add(table);

      const rows = $(table).find("tr").toArray();
      const grid: Array<Array<number | undefined>> = [];
      const cells: Array<{ lines: string[]; rowIndex: number }> = [];

      rows.forEach((row, rowIndex) => {
        const rowCells = $(row).children("td, th").toArray();
        let columnIndex = 0;

        for (const cell of rowCells) {
          while (grid[rowIndex]?.[columnIndex] !== undefined) columnIndex++;

          const cellIndex = cells.length;
          cells.push({
            lines: getCellLines($(cell).html() ?? ""),
            rowIndex,
          });

          const parsedColSpan = Number.parseInt(
            $(cell).attr("colspan") ?? "1",
            10,
          );
          const parsedRowSpan = Number.parseInt(
            $(cell).attr("rowspan") ?? "1",
            10,
          );
          const colSpan =
            Number.isFinite(parsedColSpan) && parsedColSpan > 0
              ? parsedColSpan
              : 1;
          const rowSpan =
            Number.isFinite(parsedRowSpan) && parsedRowSpan > 0
              ? parsedRowSpan
              : 1;

          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
            const targetRow = rowIndex + rowOffset;
            grid[targetRow] ??= [];
            for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
              grid[targetRow]![columnIndex + columnOffset] = cellIndex;
            }
          }

          columnIndex += colSpan;
        }
      });

      const columnCount = grid.reduce(
        (max, row) => Math.max(max, row.length),
        0,
      );

      for (let columnIndex = columnCount - 1; columnIndex >= 0; columnIndex--) {
        const lines: string[] = [];
        const seenCells = new Set<number>();

        grid.forEach((row, rowIndex) => {
          const cellIndex = row[columnIndex];
          if (cellIndex === undefined || seenCells.has(cellIndex)) return;

          const cell = cells[cellIndex];
          if (!cell || cell.rowIndex !== rowIndex) return;

          seenCells.add(cellIndex);
          lines.push(...cell.lines);
        });

        if (lines.length > 0) candidates.push({ title, lines });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      'Could not find a table below "Opening Schedule Information".',
    );
  }

  return candidates;
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

function parseOpeningSessions(lines: string[]): OpeningOutput[] {
  const sessionLines = lines.flatMap((line, index) => {
    if (!/session/i.test(line) || /break|closed/i.test(line)) return [];
    if (!/:\s*$/.test(line)) return [line];
    const nextLine = lines[index + 1];
    return nextLine && !/session|break|closed/i.test(nextLine)
      ? [nextLine]
      : [];
  });
  const openingLines = sessionLines.length > 0 ? sessionLines : lines;
  const sessions = openingLines.flatMap((line): OpeningOutput[] => {
    if (/break|closed/i.test(line)) return [];
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

  if (
    sessions.length === 0 ||
    (sessionLines.length > 0 && sessions.length !== openingLines.length)
  ) {
    return [];
  }

  const uniqueSessions = new Map(
    sessions.map((session) => [
      `${session.start_time}/${session.end_time}`,
      session,
    ]),
  );
  return [...uniqueSessions.values()];
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

    let selectedCandidate: OpeningScheduleCandidate | undefined;
    let sessions: OpeningOutput[] = [];

    for (const candidate of extractOpeningScheduleCandidates(html)) {
      const parsedSessions = parseOpeningSessions(candidate.lines);
      if (parsedSessions.length === 0) continue;

      selectedCandidate = candidate;
      sessions = parsedSessions;
      break;
    }

    if (!selectedCandidate) {
      throw new Error(
        'Could not find a valid session schedule in any "Opening Schedule Information" table column.',
      );
    }

    process.stdout.write(
      `${selectedCandidate.title}\n${selectedCandidate.lines.join("\n")}\n`,
    );
    openings.push(...sessions);
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);

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
