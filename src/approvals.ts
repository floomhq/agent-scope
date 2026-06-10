import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ApprovalEntry, ApprovalsFile } from "./types.js";

export function getApprovalsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".agent-scope");
}

export function getApprovalsPath(cwd: string = process.cwd()): string {
  return path.join(getApprovalsDir(cwd), "approvals.yml");
}

export function readApprovals(cwd: string = process.cwd()): ApprovalEntry[] {
  const approvalsPath = getApprovalsPath(cwd);
  if (!fs.existsSync(approvalsPath)) {
    return [];
  }

  const raw = fs.readFileSync(approvalsPath, "utf-8");
  const parsed = yaml.load(raw) as ApprovalsFile | null;

  if (!parsed || !Array.isArray(parsed.approved)) {
    return [];
  }

  return parsed.approved;
}

export function writeApproval(
  filePath: string,
  taskId: string,
  approvedBy: string = "human",
  cwd: string = process.cwd()
): void {
  const approvalsPath = getApprovalsPath(cwd);
  const existing = readApprovals(cwd);

  const entry: ApprovalEntry = {
    path: filePath,
    task_id: taskId,
    approved_by: approvedBy,
    created_at: new Date().toISOString(),
  };

  const updated = existing.filter((a) => a.path !== filePath);
  updated.push(entry);

  const dir = path.dirname(approvalsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(approvalsPath, yaml.dump({ approved: updated }), "utf-8");
}
