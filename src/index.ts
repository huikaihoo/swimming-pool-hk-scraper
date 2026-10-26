import { saveAdmissionData } from "./admission";
import { fetchAndMergeSwimmingPools } from "./basic";

const command = process.argv[2];

switch (command) {
  case "admission":
    await saveAdmissionData();
    break;
  case "basic":
    await fetchAndMergeSwimmingPools();
    break;
  default:
    console.error(
      "Usage: swimming-pool-hk-scraper <admission|basic>",
    );
    process.exitCode = 1;
}
