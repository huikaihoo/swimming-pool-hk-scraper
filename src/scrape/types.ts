export enum ExtractMethod {
  Cheerio = "cheerio",
  Crawl4AI = "crawl4ai",
}

export enum Lang {
  En = "en",
  Tc = "tc",
}

export interface ScrapeOption {
  extractMethod: ExtractMethod;
  withllm: boolean;
  lang: Lang;
}

export interface ScrapeInput {
  url: string;
  lang: Lang;
  html?: string;
}

export interface ScrapeOutput<T> {
  data: T;
  html?: string;
}

export interface TempClosureOutput {
  start_time: string | null;
  end_time: string | null;
  facilities_en?: string;
  facilities_tc?: string;
  reason_en?: string;
  reason_tc?: string;
  remarks_en?: string;
  remarks_tc?: string;
}

export interface AnnualClosureOutput {
  maintenance_start_date: string;
  maintenance_end_date: string;
  facilities_en?: string;
  facilities_tc?: string;
}

export interface WeeklyClosureOutput {
  weekday: number | null;
  alt_weekday: number | null;
}

export interface OpeningOutput {
  start_time: string;
  end_time: string;
}

export const defaultScrapeOption: ScrapeOption = {
  extractMethod: ExtractMethod.Cheerio,
  withllm: false,
  lang: Lang.En,
};
