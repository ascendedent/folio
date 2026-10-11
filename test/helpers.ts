import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(name: string): string {
  return readFileSync(path.join(root, "fixtures", name), "utf8");
}

export const fixturePath = (name: string): string => path.join(root, "fixtures", name);
