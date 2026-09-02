import { createHash } from "node:crypto";

export function stableId(parts: Array<string | number | undefined>): string {
  return createHash("sha1")
    .update(parts.filter((part) => part !== undefined).join("::"))
    .digest("hex")
    .slice(0, 16);
}

export function slugifyProjectName(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return ascii || "unassigned";
}
