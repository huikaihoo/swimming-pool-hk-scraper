import type {
  AnnualClosureOutput,
  OpeningOutput,
  TempClosureOutput,
  WeeklyClosureOutput,
} from "./scrape/types";

export type AdmissionDetails = {
  district: string;
  name_en: string;
  status: string;
  maximumCapacity?: number;
  currentAdmission?: number;
  allowedAdmission?: number;
};

export interface AdmissionData {
  timestamp: number;
  data: AdmissionDetails[];
}

export interface BasicData {
  name_en: string;
  name_tc: string;
  address_en: string;
  address_tc: string;
  district_en: string;
  district_tc: string;
  url_en: string;
  url_tc: string;
  coordinates: [number, number] | null;
}

export interface ScheduleData {
  name_en: string;
  opening: OpeningOutput[];
  weekly_closure: WeeklyClosureOutput;
  annual_closure: AnnualClosureOutput[];
  temp_closure: TempClosureOutput[];
}
