import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ReviewConfig, ReviewResult } from "./types.js";

export interface CacheEntry {
  diffHash: string;
  configHash: string;
  result: ReviewResult;
  createdAt: string;
}

export interface ReviewCache {
  entries: CacheEntry[];
}

const MAX_CACHE_ENTRIES = 50;

export function getCachePath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".agent-scope", "review-cache.json");
}

export function readCache(cwd: string = process.cwd()): ReviewCache {
  const cachePath = getCachePath(cwd);
  if (!fs.existsSync(cachePath)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as ReviewCache;
    if (!parsed.entries || !Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    return parsed;
  } catch {
    return { entries: [] };
  }
}

export function writeCache(cache: ReviewCache, cwd: string = process.cwd()): void {
  const cachePath = getCachePath(cwd);
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

export function hashDiff(diff: string): string {
  return crypto.createHash("sha256").update(diff).digest("hex").slice(0, 16);
}

export function hashConfig(config: ReviewConfig | undefined): string {
  const normalized = JSON.stringify(config || {});
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function getCachedResult(
  diff: string,
  config: ReviewConfig | undefined,
  cwd: string = process.cwd()
): ReviewResult | undefined {
  const cache = readCache(cwd);
  const diffHash = hashDiff(diff);
  const configHash = hashConfig(config);
  return cache.entries.find((e) => e.diffHash === diffHash && e.configHash === configHash)?.result;
}

export function setCachedResult(
  diff: string,
  config: ReviewConfig | undefined,
  result: ReviewResult,
  cwd: string = process.cwd()
): void {
  const cache = readCache(cwd);
  const diffHash = hashDiff(diff);
  const configHash = hashConfig(config);

  const existingIndex = cache.entries.findIndex(
    (e) => e.diffHash === diffHash && e.configHash === configHash
  );

  const entry: CacheEntry = {
    diffHash,
    configHash,
    result,
    createdAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    cache.entries[existingIndex] = entry;
  } else {
    cache.entries.push(entry);
  }

  // Keep only the most recent entries
  if (cache.entries.length > MAX_CACHE_ENTRIES) {
    cache.entries = cache.entries.slice(-MAX_CACHE_ENTRIES);
  }

  writeCache(cache, cwd);
}

export function clearCache(cwd: string = process.cwd()): void {
  const cachePath = getCachePath(cwd);
  if (fs.existsSync(cachePath)) {
    fs.writeFileSync(cachePath, JSON.stringify({ entries: [] }, null, 2), "utf-8");
  }
}
