import { load } from "cheerio";
import {
  getClairicAnswers,
  getLocalizedAnnualFacility,
  getStringAnswer,
  getTextAnswer,
} from "../utils";
import type { AnnualClosureOutput, ScrapeInput } from "../types";

const annualClosureHeading = "Temporary Closure for Annual Maintenance";

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTextLines(html: string): string[] {
  const separatedHtml = html
    .replace(/<br\b[^>]*\/?\s*>/gi, "\n")
    .replace(
      /<(?:p|div|li|tr|td|th|section|article|ul|ol|h[1-6])\b[^>]*>/gi,
      "\n",
    )
    .replace(
      /<\/(?:p|div|li|tr|td|th|section|article|ul|ol|h[1-6])\s*>/gi,
      "\n",
    );
  const fragment = load(`<div>${separatedHtml}</div>`);

  return fragment("body")
    .text()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractAnnualClosureLines(html: string): string[] {
  const $ = load(html);
  const normalizedHeading = annualClosureHeading.toLowerCase();
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
    throw new Error(`Could not find "${annualClosureHeading}" in the HTML.`);
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
        return followingLines;
      }

      sibling = sibling.next();
    }

    if (boundary && current === boundary) break;
    current = $(current).parent().get(0);
  }

  throw new Error(
    `Could not find text below "${annualClosureHeading}" in the HTML.`,
  );
}

export async function scrapeAnnualClosure_v1(
  input: ScrapeInput,
): Promise<AnnualClosureOutput[]> {
  const cloudflareAccountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareApiToken = Bun.env.CLOUDFLARE_API_TOKEN;

  if (!cloudflareAccountId || !cloudflareApiToken) {
    console.error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env or the environment.",
    );
    process.exitCode = 1;
    return [];
  }

  const closures: AnnualClosureOutput[] = [];
  try {
    const pageResponse = await fetch(input.url);
    if (!pageResponse.ok) {
      throw new Error(
        `Page request failed (HTTP ${pageResponse.status}): ${pageResponse.statusText}`,
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const maintenanceLines = extractAnnualClosureLines(
      await pageResponse.text(),
    );
    if (maintenanceLines.length === 0) {
      throw new Error("No annual maintenance table lines were found.");
    }

    for (const line of maintenanceLines) {
      const maintenanceText = [annualClosureHeading, line].join("\n");
      process.stdout.write(`${maintenanceText}\n`);

      try {
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
              state: maintenanceText,
              reference_date: today,
              options: {
                include_quantiles: true,
                return_state_text: true,
              },
              fields: {
                facilities: {
                  type: "text",
                  instructions:
                    "Extract the physical facility that is undergoing maintenance from the supplied notice.",
                },
                maintenance_start_date: {
                  type: "date",
                  instructions:
                    "Maintenance start date from the supplied notice.",
                },
                maintenance_end_date: {
                  type: "date",
                  instructions:
                    "Maintenance end date from the supplied notice. It must be chronologically after maintenance_start_date.",
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
          process.stdout.write(clairicText);
          if (clairicText && !clairicText.endsWith("\n")) {
            process.stdout.write("\n");
          }
          console.error("Cloudflare returned a non-JSON response.");
          process.exitCode = 1;
          continue;
        }

        if (!clairicResponse.ok) {
          process.stdout.write(`${JSON.stringify(clairicResult, null, 2)}\n`);
          process.exitCode = 1;
          continue;
        }

        try {
          const answers = getClairicAnswers(clairicResult);
          const closure: AnnualClosureOutput = {
            ...getLocalizedAnnualFacility(
              getTextAnswer(answers, "facilities"),
              input.lang,
            ),
            maintenance_start_date: getStringAnswer(
              answers,
              "maintenance_start_date",
            ),
            maintenance_end_date: getStringAnswer(
              answers,
              "maintenance_end_date",
            ),
          };
          closures.push(closure);
          process.stdout.write(`${JSON.stringify(closure, null, 2)}\n`);
        } catch (error) {
          console.error(
            "Failed to read annual maintenance fields from Clairic:",
            error instanceof Error ? error.message : error,
          );
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(
          "Failed to send annual maintenance line to Clairic:",
          error instanceof Error ? error.message : error,
        );
        process.exitCode = 1;
      }
    }
    return closures;
  } catch (error) {
    console.error(
      "Failed to scrape Annual Closure page:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return closures;
  }
}
