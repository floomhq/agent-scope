import pc from "picocolors";
import type { CheckResult, ScopeDecision, ReviewResult } from "./types.js";
import type { RunResult } from "./runner.js";

export function printReport(
  result: CheckResult,
  format: "pretty" | "json" = "pretty",
  diffs?: Record<string, string>
): void {
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
      if (diffs?.[item.file]) {
        printDiff(diffs[item.file]);
      }
    }
    console.log();
  }

  if (result.approvalRequired.length > 0) {
    console.log(pc.bold("Approval required:"));
    for (const item of result.approvalRequired) {
      console.log(`${pc.yellow("?")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
      if (diffs?.[item.file]) {
        printDiff(diffs[item.file]);
      }
    }
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(pc.bold("Warnings:"));
    for (const item of result.warnings) {
      console.log(`${pc.yellow("!")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
      if (diffs?.[item.file]) {
        printDiff(diffs[item.file]);
      }
    }
    console.log();
  }

  if (result.violations.length > 0) {
    console.log(pc.bold("Blocked changes:"));
    for (const item of result.violations) {
      console.log(`${pc.red("✕")} ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
      if (diffs?.[item.file]) {
        printDiff(diffs[item.file]);
      }
    }
    console.log();
  }

  if (result.violations.length === 0 && result.approvalRequired.length === 0) {
    console.log(pc.green("Result: Clean. All changes are in scope.\n"));
  } else if (result.violations.length > 0) {
    console.log(pc.red("Result: Scope violation found.\n"));
    console.log(pc.bold("Next steps:"));
    console.log("");
    for (const v of result.violations) {
      console.log(`  ${pc.bold(v.file)}`);
      console.log(`    Revert:           git checkout -- ${v.file}`);
      console.log(`    Request access:   agent-scope request ${v.file} --reason "..."`);
      console.log(`    Approve:          agent-scope approve ${v.file}`);
      console.log("");
    }
  } else {
    console.log(pc.yellow("Result: Approval required for some files.\n"));
    console.log(pc.bold("Next steps:"));
    console.log("");
    for (const a of result.approvalRequired) {
      console.log(`  ${pc.bold(a.file)}`);
      console.log(`    Approve:  agent-scope approve ${a.file}`);
      console.log("");
    }
  }
}

function printDiff(diff: string): void {
  const lines = diff.split("\n").slice(0, 12);
  for (const line of lines) {
    if (line.startsWith("+")) {
      console.log(pc.green(`    ${line}`));
    } else if (line.startsWith("-")) {
      console.log(pc.red(`    ${line}`));
    } else {
      console.log(pc.gray(`    ${line}`));
    }
  }
  if (diff.split("\n").length > 12) {
    console.log(pc.gray(`    ... (${diff.split("\n").length - 12} more lines)`));
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


export function printReviewResult(result: ReviewResult): void {
  console.log(pc.bold("\n🤖 Agent Review\n"));
  console.log(`${result.summary}\n`);

  if (result.concerns.length === 0) {
    console.log(pc.green("✓ No concerns raised."));
    return;
  }

  for (const concern of result.concerns) {
    const color = concern.severity === "high" ? pc.red : concern.severity === "medium" ? pc.yellow : pc.gray;
    const icon = concern.severity === "high" ? "✕" : concern.severity === "medium" ? "!" : "•";
    console.log(`${color(icon)} ${color(pc.bold(concern.severity.toUpperCase()))}${concern.file ? ` — ${concern.file}` : ""}`);
    console.log(`  ${concern.description}`);
    if (concern.suggested_checks && concern.suggested_checks.length > 0) {
      console.log(`  Suggested checks: ${concern.suggested_checks.join(", ")}`);
    }
    console.log();
  }
}

