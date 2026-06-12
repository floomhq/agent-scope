import { execSync } from "node:child_process";

export interface GitDiffOptions {
  base?: string;
  staged?: boolean;
  unstaged?: boolean;
  cwd?: string;
}

export function getChangedFiles(options: GitDiffOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const files = new Set<string>();

  // Tracked changes
  let command: string;
  if (options.base) {
    command = `git diff --name-only ${options.base}...HEAD`;
  } else if (options.staged) {
    command = "git diff --name-only --cached";
  } else if (options.unstaged) {
    command = "git diff --name-only";
  } else {
    command = "git diff --name-only HEAD";
  }

  try {
    const result = execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    for (const line of result.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get changed files: ${message}`);
  }

  // Untracked files (only when not diffing against a base branch)
  if (!options.base) {
    try {
      const untracked = execSync("git ls-files --others --exclude-standard", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      for (const line of untracked.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) files.add(trimmed);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(files);
}

export function getFileDiff(filePath: string, options: GitDiffOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  let command: string;

  if (options.base) {
    command = `git diff ${options.base}...HEAD -- ${filePath}`;
  } else if (options.staged) {
    command = `git diff --cached -- ${filePath}`;
  } else if (options.unstaged) {
    command = `git diff -- ${filePath}`;
  } else {
    command = `git diff HEAD -- ${filePath}`;
  }

  try {
    return execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
  } catch {
    // For untracked files, show the whole file content as "diff"
    try {
      const content = execSync(`cat ${filePath}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      return content
        .split("\n")
        .map((line) => `+ ${line}`)
        .join("\n");
    } catch {
      return "(diff unavailable)";
    }
  }
}

export function getFullDiff(options: GitDiffOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  let command: string;

  if (options.base) {
    command = `git diff ${options.base}...HEAD`;
  } else if (options.staged) {
    command = "git diff --cached";
  } else if (options.unstaged) {
    command = "git diff";
  } else {
    command = "git diff HEAD";
  }

  try {
    return execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get diff: ${message}`);
  }
}

export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
