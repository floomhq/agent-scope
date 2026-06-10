import { execSync } from "node:child_process";

export interface RunResult {
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCommand(command: string, cwd: string = process.cwd()): RunResult {
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { command, success: true, stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer; status?: number; message: string };
    return {
      command,
      success: false,
      stdout: error.stdout ? error.stdout.toString() : "",
      stderr: error.stderr ? error.stderr.toString() : "",
      exitCode: error.status ?? 1,
    };
  }
}

export function runCheckList(commands: string[], cwd: string = process.cwd()): RunResult[] {
  const results: RunResult[] = [];
  for (const command of commands) {
    const result = runCommand(command, cwd);
    results.push(result);
    if (!result.success) {
      break; // Fail fast
    }
  }
  return results;
}
