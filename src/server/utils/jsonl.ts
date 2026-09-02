import fs from "node:fs/promises";
import path from "node:path";

export async function writeJsonl<T>(filePath: string, records: T[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  const body = await fs.readFile(filePath, "utf8");
  return body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
