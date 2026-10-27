import { load } from "cheerio";
import { Lang } from "../types";
import type { OpeningOutput, ScrapeInput, ScrapeOutput } from "../types";
import { getClairicAnswers, getNullableStringAnswer } from "../utils";

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

    const lines = table
      .find("tr")
      .toArray()
      .flatMap((row) => {
        const cell = $(row)
          .children("td")
          .toArray()
          .reverse()
          .find((element) => /session/i.test($(element).text()));
        if (!cell) return [];

        const cellHtml = ($(cell).html() ?? "")
          .replace(/<br\b[^>]*>/gi, "\n")
          .replace(/<\/(?:p|div|li)\s*>/gi, "\n");
        const fragment = load(`<div>${cellHtml}</div>`);
        return fragment("body")
          .text()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      });

    if (lines.length === 0) {
      throw new Error(`Could not find a session column below "${title}".`);
    }

    return [title, ...lines].join("\n");
  });
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

    for (const state of extractOpeningSchedules(html)) {
      process.stdout.write(`${state}\n`);
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
        console.error("Cloudflare returned a non-JSON response.");
        process.exitCode = 1;
        continue;
      }

      process.stdout.write(`${JSON.stringify(clairicResult, null, 2)}\n`);
      if (!clairicResponse.ok) {
        process.exitCode = 1;
        continue;
      }

      const answers = getClairicAnswers(clairicResult);
      const sessions: OpeningOutput[] = [];
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

      openings.push(...sessions);
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
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
