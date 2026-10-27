import type { Chrono } from "chrono-node";
import { Lang, type AnnualClosureOutput, type TempClosureOutput } from "./types";

export function extendChronoTcSupport(chrono: Chrono): Chrono {
  const configuredChrono = chrono.clone();
  configuredChrono.refiners.push({
    refine(context, results) {
      const refinedResults: typeof results = [];

      for (let index = 0; index < results.length; index += 1) {
        const current = results[index];
        const next = results[index + 1];
        if (!current) continue;
        if (!next) {
          refinedResults.push(current);
          continue;
        }

        const textBetween = context.text.slice(
          current.index + current.text.length,
          next.index,
        );
        if (!/^\s*(?:至|到)(?:翌|次|來|来)\s*$/u.test(textBetween)) {
          refinedResults.push(current);
          continue;
        }

        const currentYear = current.start.get("year");
        if (!next.start.isCertain("year") && currentYear !== null) {
          next.start.imply("year", currentYear + 1);
        }

        const merged = current.clone();
        merged.end = next.start;
        merged.text = `${current.text}${textBetween}${next.text}`;
        refinedResults.push(merged);
        index += 1;
      }

      return refinedResults;
    },
  });

  return configuredChrono;
}

export function getLocalizedTempClosureFields(
  facilities: string,
  reason: string,
  remarks: string,
  lang: Lang,
): Partial<TempClosureOutput> {
  if (lang === Lang.Tc) {
    return {
      facilities_tc: facilities,
      reason_tc: reason,
      remarks_tc: remarks,
    };
  }

  return {
    facilities_en: facilities,
    reason_en: reason,
    remarks_en: remarks,
  };
}

export function getLocalizedAnnualFacility(
  facilities: string,
  lang: Lang,
): Partial<AnnualClosureOutput> {
  return lang === Lang.Tc
    ? { facilities_tc: facilities }
    : { facilities_en: facilities };
}

export function getClairicAnswers(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Clairic response was not an object.");
  }

  const response = value as Record<string, unknown>;
  const result =
    typeof response.result === "object" && response.result !== null
      ? (response.result as Record<string, unknown>)
      : response;
  const answers =
    typeof result.answers === "object" && result.answers !== null
      ? (result.answers as Record<string, unknown>)
      : null;

  if (!answers) {
    throw new Error("Clairic response did not contain answers.");
  }

  return Object.fromEntries(
    Object.entries(answers).map(([key, answer]) => {
      if (
        typeof answer === "object" &&
        answer !== null &&
        "value" in answer
      ) {
        return [key, (answer as { value: unknown }).value];
      }

      return [key, answer];
    }),
  );
}

export function getStringAnswer(
  answers: Record<string, unknown>,
  key: string,
): string {
  const value = answers[key];
  if (typeof value !== "string") {
    throw new Error(`Clairic response did not contain string field "${key}".`);
  }
  return value;
}

export function getTextAnswer(
  answers: Record<string, unknown>,
  key: string,
): string {
  const value = answers[key];
  return typeof value === "string" ? value : "";
}

export function getNullableStringAnswer(
  answers: Record<string, unknown>,
  key: string,
): string | null {
  const value = answers[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Clairic response did not contain string field "${key}".`);
  }
  return value;
}
