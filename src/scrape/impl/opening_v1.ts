import { load } from "cheerio";
import { Lang } from "../types";
import type { OpeningOutput, ScrapeInput, ScrapeOutput } from "../types";
import { getClairicAnswers, getNullableStringAnswer } from "../utils";

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

export async function scrapeOpening_v1(
  input: ScrapeInput,
): Promise<ScrapeOutput<OpeningOutput[]>> {
  const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = Bun.env.CLOUDFLARE_API_TOKEN;
  let html = input.html;
  const openings: OpeningOutput[] = [];

  if (input.lang !== Lang.En) {
    console.error("Opening schedule scraping supports English only.");
    process.exitCode = 1;
    return { data: openings, ...(html === undefined ? {} : { html }) };
  }

  if (!accountId || !apiToken) {
    console.error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env or the environment.",
    );
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

    const fields = Object.fromEntries(
      [1, 2, 3].flatMap((session) =>
        ["start", "end"].map((boundary) => [
          `session_${session}_${boundary}_time`,
          {
            type: "time",
            instructions: `Extract the ${boundary} time of opening session ${session}. Use the session time, not a session break. Infer AM or PM from the stated range; nn means noon. Each session starts and ends will not overlap with other sessions.`,
          },
        ]),
      ),
    );

    for (const candidate of extractOpeningScheduleCandidates(html)) {
      const state = [candidate.title, ...candidate.lines].join("\n");
      process.stdout.write(`${state}\n`);

      const clairicResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/clairic`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "clairic", state, fields }),
        },
      );
      const clairicText = await clairicResponse.text();
      let clairicResult: unknown;
      try {
        clairicResult = JSON.parse(clairicText);
      } catch {
        process.stdout.write(clairicText);
        if (clairicText && !clairicText.endsWith("\n")) {
          process.stdout.write("\n");
        }
        throw new Error("Cloudflare returned a non-JSON response.");
      }

      process.stdout.write(`${JSON.stringify(clairicResult, null, 2)}\n`);
      if (!clairicResponse.ok) {
        throw new Error(
          `Cloudflare opening schedule request failed (HTTP ${clairicResponse.status}).`,
        );
      }

      let sessions: OpeningOutput[];
      try {
        const answers = getClairicAnswers(clairicResult);
        sessions = [];
        for (const session of [1, 2, 3]) {
          const startTime = getNullableStringAnswer(
            answers,
            `session_${session}_start_time`,
          );
          const endTime = getNullableStringAnswer(
            answers,
            `session_${session}_end_time`,
          );
          if (startTime === null && endTime === null) continue;
          if (startTime === null || endTime === null) {
            throw new Error(
              `Clairic returned an incomplete opening session ${session}.`,
            );
          }
          sessions.push({ start_time: startTime, end_time: endTime });
        }
      } catch (error) {
        console.error(
          "Invalid opening schedule response; checking an earlier table column:",
          error instanceof Error ? error.message : error,
        );
        continue;
      }

      if (sessions.length === 0) {
        console.error(
          "No opening sessions in the response; checking an earlier table column.",
        );
        continue;
      }

      const uniqueSessions = new Map(
        sessions.map((session) => [
          `${session.start_time}/${session.end_time}`,
          session,
        ]),
      );
      const uniqueSessionValues = [...uniqueSessions.values()];
      openings.push(...uniqueSessionValues);
      process.stdout.write(`${JSON.stringify(uniqueSessionValues, null, 2)}\n`);
      return { data: openings, html };
    }

    throw new Error(
      'Could not find a valid session schedule in any "Opening Schedule Information" table column.',
    );
  } catch (error) {
    console.error(
      "Failed to scrape opening schedule:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return { data: openings, ...(html === undefined ? {} : { html }) };
  }
}
