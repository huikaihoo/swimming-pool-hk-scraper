import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { JSONFilePreset } from "lowdb/node";
import { formatInTimeZone } from "date-fns-tz";

interface SwimmingPool {
  district: string;
  name: string;
  status: string;
  maximumCapacity?: number;
  currentAdmission?: number;
  allowedAdmission?: number;
}

interface PoolDataResponse {
  timestamp: number;
  data: SwimmingPool[];
}

async function fetchSwimmingPoolData(): Promise<PoolDataResponse | null> {
  const url = "https://lcsd-swimming.xports.cn/swimming-pool-page?language=en";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Try to get the timestamp from the HTTP response headers in milliseconds
    // Fallback to current time if the header is missing
    const dateHeader = response.headers.get("date");
    const timestamp = dateHeader ? new Date(dateHeader).getTime() : Date.now();

    const html = await response.text();
    const $ = cheerio.load(html);

    const pools: SwimmingPool[] = [];
    let currentDistrict = "";
    let districtRowsLeft = 0;

    // Loop through every row in the table body
    $("tbody tr").each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length === 0) return;

      let startIndex = 0;

      // Handle the merged "District" cells (rowspan)
      if (districtRowsLeft === 0) {
        const districtTd = $(tds[0]);
        // Clean up newlines and extra spaces from the HTML labels
        currentDistrict = districtTd.text().replace(/\s+/g, " ").trim();

        const rowspan = districtTd.attr("rowspan");
        districtRowsLeft = rowspan ? parseInt(rowspan, 10) : 1;

        // Because the district took up the first cell, the pool name is in the second cell
        startIndex = 1;
      } else {
        // District cell is missing in this row because it was merged with the row above
        startIndex = 0;
      }

      districtRowsLeft--;

      const name = $(tds[startIndex]).text().replace(/\s+/g, " ").trim();
      const status = $(tds[startIndex + 1])
        .text()
        .replace(/\s+/g, " ")
        .trim();

      const pool: SwimmingPool = {
        district: currentDistrict,
        name,
        status,
      };

      // Only parse the numerical data if the pool is actually Open
      if (status.toLowerCase() === "open") {
        pool.maximumCapacity =
          parseInt(
            $(tds[startIndex + 2])
              .text()
              .trim(),
            10,
          ) || 0;
        pool.currentAdmission =
          parseInt(
            $(tds[startIndex + 3])
              .text()
              .trim(),
            10,
          ) || 0;
        pool.allowedAdmission =
          parseInt(
            $(tds[startIndex + 4])
              .text()
              .trim(),
            10,
          ) || 0;
      }
      // If it is closed, the message in the colspan is naturally ignored
      // because we don't add the capacity keys to the object.

      pools.push(pool);
    });

    // Construct the final structured response
    const result: PoolDataResponse = {
      timestamp,
      data: pools,
    };

    return result;
  } catch (error) {
    console.error("Failed to fetch or parse pool data:", error);
    return null;
  }
}

export async function saveAdmissionData(): Promise<void> {
  const result = await fetchSwimmingPoolData();

  if (!result) {
    console.error("No data fetched to save.");
    return;
  }

  // --- lowdb File Writing Logic ---

  // Calculate UTC+8 date components based on the timestamp using date-fns-tz
  const YYYY = formatInTimeZone(result.timestamp, "Asia/Hong_Kong", "yyyy");
  const YYYY_MM_DD = formatInTimeZone(
    result.timestamp,
    "Asia/Hong_Kong",
    "yyyy-MM-dd",
  );

  // Ensure the data directories exist
  const baseDir = path.join(process.cwd(), "data", "admission");
  const yearDir = path.join(baseDir, YYYY);
  if (!fs.existsSync(yearDir)) {
    fs.mkdirSync(yearDir, { recursive: true });
  }

  // Write to data/admission/latest.json (overwrites with the exact latest format)
  const latestDbPath = path.join(baseDir, "latest.json");
  const latestDb = await JSONFilePreset<PoolDataResponse | {}>(
    latestDbPath,
    {},
  );
  latestDb.data = result;
  await latestDb.write();

  // Write to data/admission/YYYY/YYYY-MM-DD.json (appends to an array of fetches for that day)
  const dailyDbPath = path.join(yearDir, `${YYYY_MM_DD}.json`);
  const dailyDb = await JSONFilePreset<PoolDataResponse[]>(dailyDbPath, []);
  dailyDb.data.push(result);
  await dailyDb.write();

  console.log(
    `Successfully saved data to data/admission/latest.json and data/admission/${YYYY}/${YYYY_MM_DD}.json`,
  );
}
