import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ScopeRequest } from "./types.js";

export function getRequestsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".agent-scope", "requests");
}

export function createRequest(
  taskId: string,
  paths: string[],
  reason: string,
  options: {
    agentSummary?: string;
    riskLevel?: string;
    riskWhy?: string;
    suggestedChecks?: string[];
    cwd?: string;
  } = {}
): string {
  const requestsDir = getRequestsDir(options.cwd);
  if (!fs.existsSync(requestsDir)) {
    fs.mkdirSync(requestsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${timestamp}-${safeTaskId}.yml`;
  const filePath = path.join(requestsDir, filename);

  const request: ScopeRequest = {
    task_id: taskId,
    requested_paths: paths,
    reason,
    created_at: new Date().toISOString(),
  };

  if (options.agentSummary) {
    request.agent_summary = options.agentSummary;
  }

  if (options.riskLevel || options.riskWhy) {
    request.risk = {
      level: options.riskLevel ?? "medium",
      why: options.riskWhy ?? "",
    };
  }

  if (options.suggestedChecks) {
    request.suggested_checks = options.suggestedChecks;
  }

  fs.writeFileSync(filePath, yaml.dump(request), "utf-8");
  return filePath;
}
