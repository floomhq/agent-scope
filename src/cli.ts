#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import yaml from "js-yaml";
import pc from "picocolors";
import { loadConfig, defaultConfig } from "./config.js";
import { getChangedFiles, getFileDiff, getFullDiff, isGitRepo } from "./git.js";
import { evaluateAll } from "./policy.js";
import { readApprovals, writeApproval, removeApproval } from "./approvals.js";
import { createRequest, listRequests, readRequest } from "./requests.js";
import { printReport, exitCode, toJson, printCheckResults, printReviewResult } from "./reporter.js";
import { runCheckList, runCommand } from "./runner.js";
import { reviewDiff, hasBlockingConcerns, hasHighSeverityConcerns } from "./review.js";

function showHelp(): void {
  console.log(`
${pc.bold("agent-scope")} — scoped write access for AI coding agents

${pc.bold("Commands:")}
  init                    Create agent.scope.yml and .agent-scope/ directory
  check [options]         Validate current git diff against scope
  run [command]           Validate scope, then run checks or a command
  status                  Show current task, scope, and pending items
  scope                   Display the current scope configuration
  request <path...>       Create a scope expansion request
  approve <path>          Approve a file or path for the current task
  unapprove <path>        Remove an approval for a path
  pending                 List pending scope expansion requests
  approvals               List current approvals

${pc.bold("Check options:")}
  --base <branch>         Diff against a base branch (default: HEAD)
  --staged                Only check staged changes
  --unstaged              Only check unstaged changes
  --json                  Output results as JSON
  --run-checks            Also run checks.before_done from config
  --review                Also run checks.review (LLM diff review)

${pc.bold("Review config example:")}
  checks:
    review:
      provider:
        base_url: https://openrouter.ai/api/v1
        api_key_env: OPENROUTER_API_KEY
      model: qwen/qwen3-coder-480b-a35b-instruct:free

${pc.bold("Request options:")}
  --reason <text>         Why the expansion is needed
  --required-by <file>    Allowed file that requires this protected change
  --risk-level <level>    low | medium | high
  --agent-summary <text>  Multi-line summary of the change
  --suggested-checks <cmds> Comma-separated list of suggested checks
`);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function performCheck(
  cwd: string,
  args: string[]
): { result: ReturnType<typeof evaluateAll> & { taskId: string; taskTitle: string }; isJson: boolean; files: string[]; diffs?: Record<string, string> } {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const isJson = args.includes("--json");
  const withDiff = args.includes("--with-diff");
  const base = parseFlag(args, "--base");
  const staged = args.includes("--staged");
  const unstaged = args.includes("--unstaged");

  let files: string[];
  try {
    files = getChangedFiles({ base, staged, unstaged, cwd });
  } catch (err) {
    console.error(`Error reading git diff: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  if (files.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ status: "clean", task_id: config.task.id, files: [] }, null, 2));
    } else {
      console.log("No changes detected.");
    }
    process.exit(0);
  }

  const approvals = readApprovals(cwd);
  const evaluation = evaluateAll(files, config, approvals);

  const result = {
    taskId: config.task.id,
    taskTitle: config.task.title,
    ...evaluation,
  };

  if (withDiff) {
    const diffs: Record<string, string> = {};
    for (const file of files) {
      diffs[file] = getFileDiff(file, { base, staged, unstaged, cwd });
    }
    return { result, isJson, files, diffs };
  }

  return { result, isJson, files };
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function interactiveInit(cwd: string): Promise<void> {
  const configPath = path.join(cwd, "agent.scope.yml");
  if (fs.existsSync(configPath)) {
    console.error("agent.scope.yml already exists.");
    process.exit(2);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(pc.bold("\n🛡️  agent-scope init\n"));
  console.log("Let's set up your first scope guard.\n");

  const taskId = await askQuestion(rl, "Task ID (e.g., settings-email-v1): ");
  const title = await askQuestion(rl, "Task title (e.g., Add onboarding email settings): ");

  console.log("\nWhich paths can you write to? (comma-separated, e.g., apps/web/settings/**,packages/email/**)");
  const writePaths = await askQuestion(rl, "Write paths: ");

  console.log("\nWhich paths are protected? (comma-separated, e.g., packages/auth/**,db/migrations/**)");
  const protectedPaths = await askQuestion(rl, "Protected paths (optional): ");

  console.log("\nWhich files require approval? (comma-separated, e.g., package.json,pnpm-lock.yaml)");
  const approvalPaths = await askQuestion(rl, "Approval required (optional): ");

  rl.close();

  const config = defaultConfig(taskId.trim() || "my-task-id", title.trim() || "My task title");

  if (writePaths.trim()) {
    config.scope.write = writePaths.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (protectedPaths.trim()) {
    config.scope.protected = protectedPaths.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (approvalPaths.trim()) {
    config.scope.approval_required = approvalPaths.split(",").map((s) => s.trim()).filter(Boolean);
  }

  fs.writeFileSync(configPath, yaml.dump(config), "utf-8");

  const approvalsDir = path.join(cwd, ".agent-scope");
  if (!fs.existsSync(approvalsDir)) {
    fs.mkdirSync(approvalsDir, { recursive: true });
  }

  const approvalsPath = path.join(approvalsDir, "approvals.yml");
  if (!fs.existsSync(approvalsPath)) {
    fs.writeFileSync(approvalsPath, yaml.dump({ approved: [] }), "utf-8");
  }

  const requestsDir = path.join(approvalsDir, "requests");
  if (!fs.existsSync(requestsDir)) {
    fs.mkdirSync(requestsDir, { recursive: true });
  }

  const gitignorePath = path.join(approvalsDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "requests/\nreview-cache.json\n", "utf-8");
  }

  console.log(pc.green("\n✓ Created agent.scope.yml and .agent-scope/\n"));
  console.log("Next:");
  console.log("  1. Review agent.scope.yml");
  console.log("  2. Make changes");
  console.log("  3. Run: agent-scope check\n");
}

function showStatus(cwd: string): void {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  console.log(pc.bold("\n🛡️  Agent Scope Status\n"));

  console.log(pc.bold("Task:"));
  console.log(`  ID:    ${config.task.id}`);
  console.log(`  Title: ${config.task.title}`);
  if (config.task.description) {
    console.log(`  Desc:  ${config.task.description}`);
  }
  console.log();

  console.log(pc.bold("Mode:"));
  console.log(`  ${config.mode || "strict"}`);
  console.log();

  const writePaths = config.scope.write ?? [];
  const protectedPaths = config.scope.protected ?? [];
  const approvalPaths = config.scope.approval_required ?? [];

  if (writePaths.length > 0) {
    console.log(pc.bold("Write paths:"));
    for (const p of writePaths) {
      console.log(`  ${pc.green("✓")} ${p}`);
    }
    console.log();
  }

  if (protectedPaths.length > 0) {
    console.log(pc.bold("Protected paths:"));
    for (const p of protectedPaths) {
      console.log(`  ${pc.red("✕")} ${p}`);
    }
    console.log();
  }

  if (approvalPaths.length > 0) {
    console.log(pc.bold("Approval required:"));
    for (const p of approvalPaths) {
      console.log(`  ${pc.yellow("?")} ${p}`);
    }
    console.log();
  }

  const approvals = readApprovals(cwd);
  if (approvals.length > 0) {
    console.log(pc.bold("Active approvals:"));
    for (const a of approvals) {
      console.log(`  ${pc.green("✓")} ${a.path} — ${a.approved_by} (${a.task_id})`);
    }
    console.log();
  }

  const requestFiles = listRequests(cwd);
  if (requestFiles.length > 0) {
    console.log(pc.bold("Pending requests:"));
    for (const f of requestFiles) {
      const req = readRequest(f, cwd);
      if (req) {
        console.log(`  ${pc.yellow("?")} ${f}`);
        console.log(`    Paths: ${req.requested_paths.join(", ")}`);
        console.log(`    Reason: ${req.reason}`);
      }
    }
    console.log();
  }

  if (isGitRepo(cwd)) {
    try {
      const files = getChangedFiles({ cwd });
      if (files.length > 0) {
        console.log(pc.bold("Current changes:"));
        for (const f of files) {
          console.log(`  • ${f}`);
        }
        console.log();
        console.log("Run 'agent-scope check' to validate.\n");
      } else {
        console.log("No changes detected.\n");
      }
    } catch {
      // ignore
    }
  }
}

function showScope(cwd: string): void {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  console.log(yaml.dump(config));
}

function showPending(cwd: string): void {
  const files = listRequests(cwd);
  if (files.length === 0) {
    console.log("No pending requests.\n");
    return;
  }

  console.log(pc.bold("\nPending scope requests:\n"));
  for (const f of files) {
    const req = readRequest(f, cwd);
    if (req) {
      console.log(pc.bold(f));
      console.log(`  Task:     ${req.task_id}`);
      console.log(`  Paths:    ${req.requested_paths.join(", ")}`);
      console.log(`  Reason:   ${req.reason}`);
      if (req.risk) {
        console.log(`  Risk:     ${req.risk.level} — ${req.risk.why || "N/A"}`);
      }
      if (req.suggested_checks) {
        console.log(`  Checks:   ${req.suggested_checks.join(", ")}`);
      }
      console.log();
    }
  }
}

function showApprovals(cwd: string): void {
  const approvals = readApprovals(cwd);
  if (approvals.length === 0) {
    console.log("No active approvals.\n");
    return;
  }

  console.log(pc.bold("\nActive approvals:\n"));
  for (const a of approvals) {
    console.log(`${pc.green("✓")} ${a.path}`);
    console.log(`  Task:      ${a.task_id}`);
    console.log(`  Approved:  ${a.approved_by}`);
    console.log(`  Date:      ${a.created_at}`);
    console.log();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  const cwd = process.cwd();

  switch (command) {
    case "init": {
      if (args.includes("--interactive") || args.includes("-i")) {
        await interactiveInit(cwd);
      } else {
        const configPath = path.join(cwd, "agent.scope.yml");
        if (fs.existsSync(configPath)) {
          console.error("agent.scope.yml already exists.");
          process.exit(2);
        }

        const config = defaultConfig("my-task-id", "My task title");
        fs.writeFileSync(configPath, yaml.dump(config), "utf-8");

        const approvalsDir = path.join(cwd, ".agent-scope");
        if (!fs.existsSync(approvalsDir)) {
          fs.mkdirSync(approvalsDir, { recursive: true });
        }

        const approvalsPath = path.join(approvalsDir, "approvals.yml");
        if (!fs.existsSync(approvalsPath)) {
          fs.writeFileSync(approvalsPath, yaml.dump({ approved: [] }), "utf-8");
        }

        const requestsDir = path.join(approvalsDir, "requests");
        if (!fs.existsSync(requestsDir)) {
          fs.mkdirSync(requestsDir, { recursive: true });
        }

        const gitignorePath = path.join(approvalsDir, ".gitignore");
        if (!fs.existsSync(gitignorePath)) {
          fs.writeFileSync(gitignorePath, "requests/\nreview-cache.json\n", "utf-8");
        }

        console.log("Created agent.scope.yml and .agent-scope/");
        console.log("\nTip: run 'agent-scope init --interactive' for a guided setup.\n");
      }
      process.exit(0);
      break;
    }

    case "status": {
      showStatus(cwd);
      process.exit(0);
      break;
    }

    case "scope": {
      showScope(cwd);
      process.exit(0);
      break;
    }

    case "pending": {
      showPending(cwd);
      process.exit(0);
      break;
    }

    case "approvals": {
      showApprovals(cwd);
      process.exit(0);
      break;
    }

    case "check": {
      if (!isGitRepo(cwd)) {
        console.error("Error: not a git repository");
        process.exit(2);
      }

      const { result, isJson, diffs } = performCheck(cwd, args);
      printReport(result, isJson ? "json" : "pretty", diffs);

      let code = exitCode(result);

      if (code === 0 && args.includes("--review")) {
        const config = loadConfig(cwd);
        if (config.checks?.review) {
          try {
            const base = parseFlag(args, "--base");
            const staged = args.includes("--staged");
            const unstaged = args.includes("--unstaged");
            const fullDiff = getFullDiff({ base, staged, unstaged, cwd });

            const reviewResult = await reviewDiff({ diff: fullDiff, config });
            printReviewResult(reviewResult);
            if (hasBlockingConcerns(reviewResult)) {
              code = 1;
            }
          } catch (err) {
            console.error(pc.red(`\nReview failed: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(2);
          }
        }
      }

      if (code === 0 && args.includes("--run-checks")) {
        const config = loadConfig(cwd);
        const commands = config.checks?.before_done ?? [];
        if (commands.length > 0) {
          const checkResults = runCheckList(commands, cwd);
          printCheckResults(checkResults);
          const failed = checkResults.find((r) => !r.success);
          if (failed) {
            process.exit(failed.exitCode || 1);
          }
        }
      }

      process.exit(code);
      break;
    }

    case "run": {
      if (!isGitRepo(cwd)) {
        console.error("Error: not a git repository");
        process.exit(2);
      }

      const { result, isJson } = performCheck(cwd, args);
      const code = exitCode(result);

      if (code !== 0) {
        printReport(result, isJson ? "json" : "pretty");
        process.exit(code);
      }

      const config = loadConfig(cwd);

      if (config.checks?.review) {
        try {
          const base = parseFlag(args, "--base");
          const staged = args.includes("--staged");
          const unstaged = args.includes("--unstaged");
          const fullDiff = getFullDiff({ base, staged, unstaged, cwd });

          const reviewResult = await reviewDiff({ diff: fullDiff, config });
          printReviewResult(reviewResult);
          if (hasBlockingConcerns(reviewResult)) {
            process.exit(1);
          }
        } catch (err) {
          console.error(pc.red(`\nReview failed: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(2);
        }
      }

      const userCommand = args.slice(1).find((a) => !a.startsWith("-"));

      if (userCommand) {
        const runResult = runCommand(userCommand, cwd);
        if (runResult.stdout) console.log(runResult.stdout);
        if (runResult.stderr) console.error(runResult.stderr);
        process.exit(runResult.exitCode);
      } else {
        const commands = config.checks?.before_done ?? [];
        if (commands.length === 0 && !config.checks?.review) {
          console.log("No checks configured. Use checks.before_done or checks.review in agent.scope.yml or pass a command.");
          process.exit(0);
        }
        const checkResults = runCheckList(commands, cwd);
        printCheckResults(checkResults);
        const failed = checkResults.find((r) => !r.success);
        if (failed) {
          process.exit(failed.exitCode || 1);
        }
        console.log(pc.green("All checks passed."));
        process.exit(0);
      }
      break;
    }

    case "request": {
      let config;
      try {
        config = loadConfig(cwd);
      } catch (err) {
        console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
      }

      const paths: string[] = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) break;
        paths.push(args[i]);
      }

      if (paths.length === 0) {
        console.error("Usage: agent-scope request <path...> --reason <reason>");
        process.exit(2);
      }

      const reason = parseFlag(args, "--reason") ?? "No reason provided";
      const riskLevel = parseFlag(args, "--risk-level");
      const agentSummary = parseFlag(args, "--agent-summary");
      const suggestedChecksRaw = parseFlag(args, "--suggested-checks");
      const suggestedChecks = suggestedChecksRaw ? suggestedChecksRaw.split(",").map((s) => s.trim()) : undefined;
      const requiredBy = parseFlag(args, "--required-by");

      const requestPath = createRequest(config.task.id, paths, reason, {
        cwd,
        riskLevel,
        agentSummary,
        suggestedChecks,
        requiredBy,
      });
      console.log(`Created scope request: ${requestPath}`);
      process.exit(0);
      break;
    }

    case "approve": {
      let config;
      try {
        config = loadConfig(cwd);
      } catch (err) {
        console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
      }

      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: agent-scope approve <path>");
        process.exit(2);
      }

      writeApproval(filePath, config.task.id, "human", cwd);
      console.log(pc.green(`✓ Approved ${filePath} for task ${config.task.id}`));
      process.exit(0);
      break;
    }

    case "unapprove": {
      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: agent-scope unapprove <path>");
        process.exit(2);
      }

      const removed = removeApproval(filePath, cwd);
      if (removed) {
        console.log(pc.green(`✓ Removed approval for ${filePath}`));
      } else {
        console.log(`No approval found for ${filePath}`);
      }
      process.exit(0);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(2);
    }
  }
}

main();
