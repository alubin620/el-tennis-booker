import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "./logger.js";

const AUTH_DIR = resolve(".auth");
export const STORAGE_PATH = resolve(AUTH_DIR, "storage.json");

export function materializeStorageFromEnv() {
  const encoded = process.env.PBP_STORAGE_STATE;
  if (!encoded?.trim()) {
    log("storage: no PBP_STORAGE_STATE secret (optional)");
    return false;
  }
  mkdirSync(AUTH_DIR, { recursive: true });
  const json = Buffer.from(encoded.trim(), "base64").toString("utf8");
  JSON.parse(json);
  writeFileSync(STORAGE_PATH, json, "utf8");
  log(`storage: wrote .auth/storage.json from PBP_STORAGE_STATE (${json.length} bytes)`);
  return true;
}

export function encodeStorageFile(filePath = STORAGE_PATH) {
  const json = readFileSync(filePath);
  return Buffer.from(json).toString("base64");
}
