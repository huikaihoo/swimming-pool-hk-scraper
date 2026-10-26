import * as fs from "fs";
import * as path from "path";

interface Venue {
  Name_en: string;
  Name_cn: string;
  Address_en: string;
  Address_cn: string;
  District_en: string;
  District_cn: string;
  URL_en: string;
  URL_cn: string;
  [key: string]: any;
}

interface Feature {
  properties: {
    NameEN: string;
    NameTC: string;
    [key: string]: any;
  };
  geometry: {
    type: string;
    coordinates: [number, number]; // [longitude, latitude]
  };
}

interface GeoJSON {
  features: Feature[];
}

interface FinalPool {
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

export async function fetchAndMergeSwimmingPools(): Promise<void> {
  const venuesUrl = "http://www.lcsd.gov.hk/datagovhk/venue/venue.json";
  const geojsonUrl =
    "https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=lcsd_rcd_1634540558875_77434&format=geojson&layer_name=SP";

  try {
    console.log("Fetching datasets...");

    // Fetch both datasets concurrently for better performance
    const [venuesResponse, geojsonResponse] = await Promise.all([
      fetch(venuesUrl),
      fetch(geojsonUrl),
    ]);

    if (!venuesResponse.ok || !geojsonResponse.ok) {
      throw new Error("Failed to fetch one or both datasets.");
    }

    const venues = (await venuesResponse.json()) as Venue[];
    const geoData = (await geojsonResponse.json()) as GeoJSON;

    // 1. Filter venues where Name_en ends with "Swimming Pool"
    const swimmingPools = venues.filter(
      (venue) =>
        venue.Name_en && venue.Name_en.trim().endsWith("Swimming Pool"),
    );

    // 2. Join the data with the GeoJSON features to grab the coordinates
    const finalData: FinalPool[] = swimmingPools.map((venue) => {
      // Normalize names for comparison (handles case differences like "Swimming pool" vs "Swimming Pool")
      const normalizedVenueName = venue.Name_en.trim().toLowerCase();

      const matchingFeature = geoData.features.find((feature) => {
        const featureName = feature.properties.NameEN || "";
        return featureName.trim().toLowerCase() === normalizedVenueName;
      });

      // Map to the requested output format (_en and _tc suffixes)
      return {
        name_en: venue.Name_en.trim(),
        name_tc: venue.Name_cn.trim(),
        address_en: venue.Address_en.trim(),
        address_tc: venue.Address_cn.trim(),
        district_en: venue.District_en.trim(),
        district_tc: venue.District_cn.trim(),
        url_en: venue.URL_en.trim(),
        url_tc: venue.URL_cn.trim(),
        coordinates: matchingFeature
          ? matchingFeature.geometry.coordinates
          : null,
      };
    });

    const dataDir = path.join(process.cwd(), "data", "basic");
    fs.mkdirSync(dataDir, { recursive: true });

    // Write the current result to one file, overwriting the previous result.
    const dataPath = path.join(dataDir, "latest.json");
    fs.writeFileSync(dataPath, `${JSON.stringify(finalData, null, 2)}\n`);

    console.log(
      `Successfully saved ${finalData.length} swimming pools to data/basic/latest.json`,
    );
  } catch (error) {
    console.error("Error processing swimming pool data:", error);
  }
}
