import type { AgentScopeConfig, ScopeDecision, ApprovalEntry } from "./types.js";
import { matchAny, normalizePath } from "./matcher.js";

export function evaluateFile(
  filePath: string,
  config: AgentScopeConfig,
  approvals: ApprovalEntry[]
): ScopeDecision {
  const normalized = normalizePath(filePath);

  const protectedPatterns = config.scope.protected ?? [];
  const approvalRequiredPatterns = config.scope.approval_required ?? [];
  const writePatterns = config.scope.write ?? [];

  // Priority: protected > approved > approval_required > write > blocked

  const isProtected = matchAny(normalized, protectedPatterns);
  const isApprovalRequired = matchAny(normalized, approvalRequiredPatterns);
  const isWrite = matchAny(normalized, writePatterns);

  const approvedEntry = approvals.find((a) => matchAny(normalized, [a.path]));

  if (isProtected) {
    if (approvedEntry) {
      return {
        file: normalized,
        status: "approved",
        reason: `Approved by ${approvedEntry.approved_by} for task ${approvedEntry.task_id}`,
        matchedRule: approvedEntry.path,
      };
    }
    return {
      file: normalized,
      status: "blocked",
      reason: "protected path",
      matchedRule: protectedPatterns.find((p) => matchAny(normalized, [p])),
    };
  }

  if (approvedEntry) {
    return {
      file: normalized,
      status: "approved",
      reason: `Approved by ${approvedEntry.approved_by} for task ${approvedEntry.task_id}`,
      matchedRule: approvedEntry.path,
    };
  }

  if (isApprovalRequired) {
    return {
      file: normalized,
      status: "approval_required",
      reason: "approval required",
      matchedRule: approvalRequiredPatterns.find((p) => matchAny(normalized, [p])),
    };
  }

  if (isWrite) {
    return {
      file: normalized,
      status: "allowed",
      reason: "in write scope",
      matchedRule: writePatterns.find((p) => matchAny(normalized, [p])),
    };
  }

  if (config.mode === "warn") {
    return {
      file: normalized,
      status: "warning",
      reason: "out of scope (warn mode)",
    };
  }

  return {
    file: normalized,
    status: "blocked",
    reason: "not in write scope",
  };
}

export function evaluateAll(
  files: string[],
  config: AgentScopeConfig,
  approvals: ApprovalEntry[]
) {
  const allowed: ScopeDecision[] = [];
  const warnings: ScopeDecision[] = [];
  const violations: ScopeDecision[] = [];
  const approvalRequired: ScopeDecision[] = [];

  for (const file of files) {
    const decision = evaluateFile(file, config, approvals);
    switch (decision.status) {
      case "allowed":
      case "approved":
        allowed.push(decision);
        break;
      case "warning":
        warnings.push(decision);
        break;
      case "approval_required":
        approvalRequired.push(decision);
        break;
      case "blocked":
        violations.push(decision);
        break;
    }
  }

  return { allowed, warnings, violations, approvalRequired };
}
