import { readFileSync } from "node:fs";
import path from "node:path";
import { FolioError } from "./errors.js";
import { readFdx } from "./fdx/read.js";
import { readFountain } from "./fountain/parse.js";
import type { Script } from "./model.js";

export function loadScript(file: string): Script {
  const source = readFileSync(file, "utf8");
  const extension = path.extname(file).toLowerCase();
  if (extension === ".fdx" || extension === ".fdxt") return readFdx(source);
  if (extension === ".fountain" || extension === ".spmd" || extension === ".txt") return readFountain(source);
  throw new FolioError(`Unsupported file type "${extension}". Use .fdx, .fdxt, .fountain, or .txt.`);
}
