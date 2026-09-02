import { importLocalRawData } from "@/server/ingestion/import-service";

const result = await importLocalRawData();
console.log(JSON.stringify(result, null, 2));
