import {
  getClairicAnswers,
  getLocalizedTempClosureFields,
  getNullableStringAnswer,
  getTextAnswer,
} from "../utils";
import type { ScrapeInput, TempClosureOutput } from "../types";

function extractClosureNotice(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.includes("Notice of Temporary Closure"),
  );

  if (start === -1) {
    throw new Error(
      'Could not find "Notice of Temporary Closure" in Markdown.',
    );
  }

  const photoLine = lines.findIndex(
    (line, index) => index > start && line.includes("**Photo**"),
  );
  const end = photoLine === -1 ? lines.length : photoLine;
  return lines.slice(start, end).join("\n");
}

export async function scrapeTempClosure_v1(
  input: ScrapeInput,
): Promise<TempClosureOutput[]> {
  const crawl4aiToken = Bun.env.CRAWL4AI_API_TOKEN;
  const cloudflareAccountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareApiToken = Bun.env.CLOUDFLARE_API_TOKEN;

  if (!crawl4aiToken) {
    console.error("CRAWL4AI_API_TOKEN is not set in .env or the environment.");
    process.exitCode = 1;
    return [];
  }
  if (!cloudflareAccountId || !cloudflareApiToken) {
    console.error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env or the environment.",
    );
    process.exitCode = 1;
    return [];
  }

  try {
    const response = await fetch("http://localhost:11235/md", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${crawl4aiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: input.url }),
    });

    const responseText = await response.text();
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Crawl4AI returned invalid JSON (HTTP ${response.status}).`,
      );
    }

    if (!response.ok) {
      const detailValue = result.detail ?? result.error;
      const detail =
        typeof detailValue === "string"
          ? detailValue
          : JSON.stringify(detailValue ?? response.statusText);
      throw new Error(
        `Crawl4AI request failed (HTTP ${response.status}): ${detail}`,
      );
    }

    if (typeof result.markdown !== "string") {
      throw new Error("Crawl4AI response did not contain Markdown.");
    }

    const markdown = result.markdown;
    const notice = extractClosureNotice(markdown);
    if (/no related notice/i.test(notice)) {
      process.stdout.write("[]\n");
      return [];
    }

    const clairicResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/@cf/cloudflare/clairic`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "clairic",
          state: notice,
          fields: {
            start_time: {
              type: "datetime",
              instructions:
                "Extract the starting date and time from the Date & Time cell as an ISO 8601 datetime in Hong Kong local time.",
            },
            end_time: {
              type: "datetime",
              instructions:
                "Extract the ending date and time from the Date & Time cell as an ISO 8601 datetime in Hong Kong local time.",
            },
            facilities: {
              type: "text",
              instructions:
                "Extract the Facilities cell.",
            },
            reason: {
              type: "text",
              instructions:
                "Extract the Reason cell only. Do not include Remarks.",
            },
            remarks: {
              type: "text",
              instructions:
                "Extract the Remarks cell. Return an empty value when it is N/A or empty.",
            },
          },
        }),
      },
    );

    const clairicText = await clairicResponse.text();
    let clairicResult: unknown;
    try {
      clairicResult = JSON.parse(clairicText);
    } catch {
      process.stdout.write(notice);
      if (notice && !notice.endsWith("\n")) {
        process.stdout.write("\n");
      }
      process.stdout.write(clairicText);
      if (clairicText && !clairicText.endsWith("\n")) {
        process.stdout.write("\n");
      }
      console.error("Cloudflare returned a non-JSON response.");
      process.exitCode = 1;
      return [];
    }

    const answers = getClairicAnswers(clairicResult);
    const closure: TempClosureOutput = {
      start_time: getNullableStringAnswer(answers, "start_time"),
      end_time: getNullableStringAnswer(answers, "end_time"),
      ...getLocalizedTempClosureFields(
        getTextAnswer(answers, "facilities"),
        getTextAnswer(answers, "reason"),
        getTextAnswer(answers, "remarks"),
        input.lang,
      ),
    };

    process.stdout.write(notice);
    if (notice && !notice.endsWith("\n")) {
      process.stdout.write("\n");
    }
    process.stdout.write(`${JSON.stringify([closure], null, 2)}\n`);

    if (!clairicResponse.ok) process.exitCode = 1;
    return [closure];
  } catch (error) {
    console.error(
      "Failed to scrape Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return [];
  }
}
