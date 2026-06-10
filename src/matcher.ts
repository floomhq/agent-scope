import micromatch from "micromatch";

export function matchAny(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return micromatch.isMatch(filePath, patterns, { dot: true });
}

export function normalizePath(filePath: string): string {
  // Remove leading ./ and normalize slashes
  return filePath.replace(/^\.\//, "").replace(/\\/g, "/");
}
