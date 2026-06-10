import pc from "picocolors";
import type { CheckResult, ScopeDecision } from "./types.js";
import type { RunResult } from "./runner.js";

export function printReport(result: CheckResult, format: "pretty" | "json" = "pretty"): void {
  if (format === "json") {
    console.log(JSON.stringify(toJson(result), null, 2));
    return;
  }

  console.log(pc.bold("Agent Scope Check\n"));

  console.log(pc.bold("Task:"));
  console.log(`${result.taskTitle}\n`);

  if (result.allowed.length > 0) {
    console.log(pc.bold("Allowed changes:"));
    for (const item of result.allowed) {
      console.log(`${pc.green("✓")} ${item.file}`);
    }
    console.log();
  }

  if (result.approvalRequired.length > 0) {
    console.log(pc.bold("Approval required:"));
    for (const item of result.approvalRequired) {
      console.log(`${pc.yellow("?")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
    }
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(pc.bold("Warnings:"));
    for (const item of result.warnings) {
      console.log(`${pc.yellow("!")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
    }
    console.log();
  }

  if (result.violations.length > 0) {
    console.log(pc.bold("Blocked changes:"));
    for (const item of result.violations) {
      console.log(`${pc.red("✕")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
    }
    console.log();
  }

  if (result.violations.length === 0 && result.approvalRequired.length === 0) {
    console.log(pc.green("Result: Clean. All changes are in scope.\n"));
  } else if (result.violations.length > 0) {
    console.log(pc.red("Result: Scope violation found.\n"));
    console.log(pc.bold("Next:"));
    console.log("- revert blocked files");
    console.log("- request scope expansion: agent-scope request <path> --reason ...");
    console.log("- approve specific file change: agent-scope approve <path>");
    console.log();
  } else {
    console.log(pc.yellow("Result: Approval required for some files.\n"));
  }
}

export function printCheckResults(results: RunResult[]): void {
  console.log(pc.bold("Running checks...\n"));
  for (const result of results) {
    const icon = result.success ? pc.green("✓") : pc.red("✕");
    console.log(`${icon} ${result.command}`);
    if (!result.success) {
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(pc.red(result.stderr));
    }
  }
  console.log();
}

export function toJson(result: CheckResult) {
  return {
    status: result.violations.length > 0 ? "blocked" : result.approvalRequired.length > 0 ? "approval_required" : "clean",
    task_id: result.taskId,
    violations: result.violations.map((v) => ({
      file: v.file,
      reason: v.reason,
      action: "request_scope_expansion",
    })),
    approval_required: result.approvalRequired.map((v) => ({
      file: v.file,
      reason: v.reason,
    })),
    allowed: result.allowed.map((v) => v.file),
    warnings: result.warnings.map((v) => v.file),
  };
}

export function exitCode(result: CheckResult): number {
  if (result.violations.length > 0) return 1;
  if (result.approvalRequired.length > 0) return 1;
  return 0;
}
