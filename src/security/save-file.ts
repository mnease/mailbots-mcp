import { join, basename } from "node:path";
import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { DEFAULT_DOWNLOAD_DIR, validateSavePath } from "./save-path.js";

/**
 * Write bytes into an allowed download directory. The stored name is always
 * basename(filename), so a provider-supplied path cannot escape the dir.
 */
export function writeDownload(dir: string | undefined, filename: string, data: Buffer): string {
  const targetDir = dir ?? DEFAULT_DOWNLOAD_DIR;
  validateSavePath(targetDir);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }
  const safeName = basename(filename);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error("Invalid attachment filename: empty or reserved name");
  }
  const filePath = join(targetDir, safeName);
  writeFileSync(filePath, data, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return filePath;
}
