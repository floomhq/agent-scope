#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { loadConfig, defaultConfig } from "./config.js";
import { getChangedFiles, isGitRepo } from "./git.js";
import { evaluateAll } from "./policy.js";
import { readApprovals, writeApproval } from "./approvals.js";
import { createRequest } from "./requests.js";
import { printReport, exitCode, toJson, printCheckResults } from "./reporter.js";
import pc from "picocolors";
import { runCheckList, runCommand } from "./runner.js";

function showHelp(): void {
  console.log(`
agent-scope — scoped write access for AI coding agents

Commands:
  init                    Create agent.scope.yml and .agent-scope/ directory
  check [options]         Validate current git diff against scope
  run [command]           Validate scope, then run checks or a command
  request <path>          Create a scope expansion request
  approve <path>          Approve a file or path for the current task

Check options:
  --base <branch>         Diff against a base branch (default: HEAD)
  --staged                Only check staged changes
  --unstaged              Only check unstaged changes
  --json                  Output results as JSON
  --run-checks            Also run checks.before_done from config

Run options:
  If no command is given, runs checks.before_done from config.
  If a command is given, validates scope then runs it.

Request options:
  --reason <text>         Why the expansion is needed
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
): { result: ReturnType<typeof evaluateAll> & { taskId: string; taskTitle: string }; isJson: boolean } {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    console.error(`Error loading config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const isJson = args.includes("--json");
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

  return {
    result: {
      taskId: config.task.id,
      taskTitle: config.task.title,
      ...evaluation,
    },
    isJson,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  const cwd = process.cwd();

  switch (command) {
    case "init": {
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

      // Create a .gitignore so requests don't clutter git status
      const gitignorePath = path.join(approvalsDir, ".gitignore");
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, "requests/\n", "utf-8");
      }

      console.log("Created agent.scope.yml and .agent-scope/");
      process.exit(0);
      break;
    }

    case "check": {
      if (!isGitRepo(cwd)) {
        console.error("Error: not a git repository");
        process.exit(2);
      }

      const { result, isJson } = performCheck(cwd, args);
      printReport(result, isJson ? "json" : "pretty");

      const code = exitCode(result);

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

      // If a command is provided, run it; otherwise run before_done checks
      const userCommand = args.slice(1).find((a) => !a.startsWith("-"));

      if (userCommand) {
        const runResult = runCommand(userCommand, cwd);
        if (runResult.stdout) console.log(runResult.stdout);
        if (runResult.stderr) console.error(runResult.stderr);
        process.exit(runResult.exitCode);
      } else {
        const config = loadConfig(cwd);
        const commands = config.checks?.before_done ?? [];
        if (commands.length === 0) {
          console.log("No checks configured. Use checks.before_done in agent.scope.yml or pass a command.");
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

      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: agent-scope request <path> --reason <reason>");
        process.exit(2);
      }

      const reason = parseFlag(args, "--reason") ?? "No reason provided";
      const riskLevel = parseFlag(args, "--risk-level");
      const agentSummary = parseFlag(args, "--agent-summary");
      const suggestedChecksRaw = parseFlag(args, "--suggested-checks");
      const suggestedChecks = suggestedChecksRaw ? suggestedChecksRaw.split(",").map((s) => s.trim()) : undefined;

      const requestPath = createRequest(config.task.id, [filePath], reason, {
        cwd,
        riskLevel,
        agentSummary,
        suggestedChecks,
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
      console.log(`Approved ${filePath} for task ${config.task.id}`);
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
